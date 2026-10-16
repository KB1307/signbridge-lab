// Trained sign classifier for the Lab: reads a .sbm model file and classifies one signing
// segment into a word. The model is trained offline (lab/tools/train_signmodel.py) on
// landmark features from this same pipeline, so the phone computes exactly what training saw.
//
// .sbm layout: "SBM1" | uint32 header length (LE) | UTF-8 JSON header | padding to 4 | float32 blob.
// Header: { name, labels[], words[], fps, L, D, C, K, kernel, blocks, tensors: {name: [offset, shape]},
//           thresholds: {ok, unsure}, metrics, attribution, licence }
// Network (all plain arithmetic, mirrored exactly in the trainer and in lab/tools/sbnet.py):
//   x = resample(segment features, L frames); x = (x - mean) / std  [- shift, when adapting to a signer]
//   h = gelu(LN(x W0 + b0))
//   repeat `blocks`: y = depthwise_conv_time(h, kernel) ; y = gelu(y Wp + bp) ; h = LN(h + y)
//   z = [mean_t h, max_t h]  (the embedding used by "My words only") ; logits = z Wc + bc ; softmax
(function (root) {
  const P = root.SBPipeline || (typeof require !== 'undefined' ? require('./pipeline.js') : null);

  function parse(buf) {
    const u8 = new Uint8Array(buf);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== 'SBM1') throw new Error('Not a SignBridge model file (.sbm).');
    const hlen = new DataView(buf, 4, 4).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen)));
    const start = 8 + hlen + ((4 - ((8 + hlen) % 4)) % 4);
    const blob = new Float32Array(buf.slice(start));
    const T = {};
    for (const [name, [off, shape]] of Object.entries(header.tensors)) {
      const n = shape.reduce((a, b) => a * b, 1);
      if (off + n > blob.length) throw new Error(`Model file is truncated (${name}).`);
      T[name] = blob.subarray(off, off + n);
    }
    for (const k of ['labels', 'L', 'D', 'C', 'K', 'kernel', 'blocks']) if (header[k] === undefined) throw new Error(`Model header is missing ${k}.`);
    if (header.labels.length !== header.K) throw new Error('Model labels do not match its size.');
    if (Array.isArray(header.members) && header.members.length) {       // several networks, probabilities averaged
      const members = header.members.map(mh => {
        const Tm = {};
        for (const [name, [off, shape]] of Object.entries(mh.tensors)) {
          const n = shape.reduce((a, b) => a * b, 1);
          if (off + n > blob.length) throw new Error(`Model file is truncated (${mh.name || 'member'} ${name}).`);
          Tm[name] = blob.subarray(off, off + n);
        }
        return new Model(Object.assign({}, header, mh, { members: undefined }), Tm);
      });
      return new Ensemble(header, members);
    }
    return new Model(header, T);
  }

  const GELU_C = Math.sqrt(2 / Math.PI);
  const gelu = v => 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v)));

  // Linear time resampling of rows (each Float32Array of equal length) to n rows.
  function resampleRows(rows, n) {
    const T = rows.length, D = rows[0].length, out = [];
    for (let i = 0; i < n; i++) {
      const pos = T === 1 ? 0 : (i * (T - 1)) / (n - 1), a = Math.floor(pos), b = Math.min(T - 1, a + 1), w = pos - a;
      const r = new Float32Array(D), ra = rows[a], rb = rows[b];
      for (let d = 0; d < D; d++) r[d] = ra[d] * (1 - w) + rb[d] * w;
      out.push(r);
    }
    return out;
  }

  // Raw landmark frames captured at `fromFps` -> frames at `toFps` (nearest frame: NaN-safe,
  // so a missing hand stays missing instead of being blended with a present one).
  function resampleRaw(raws, fromFps, toFps) {
    if (!raws.length || !fromFps || Math.abs(fromFps - toFps) < 0.5) return raws.slice();
    const n = Math.max(1, Math.round((raws.length * toFps) / fromFps)), out = [];
    for (let i = 0; i < n; i++) out.push(raws[Math.min(raws.length - 1, Math.round((i * fromFps) / toFps))]);
    return out;
  }

  function unit(v) {
    let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    const inv = 1 / Math.max(Math.sqrt(s), 1e-12), out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
    return out;
  }
  function softmaxInto(lg) {
    const K = lg.length, p = new Float64Array(K); let mx = -Infinity;
    for (let k = 0; k < K; k++) if (lg[k] > mx) mx = lg[k];
    let s = 0; for (let k = 0; k < K; k++) { p[k] = Math.exp(lg[k] - mx); s += p[k]; }
    for (let k = 0; k < K; k++) p[k] /= s;
    return p;
  }

  // ---- adapting to the signer (experimental): running mean of the normalised network input of the
  // segments this signer has signed. Once `minSegments` are seen, that mean is subtracted from each new
  // segment's normalised input. Measured offline (models/PREREG_PERSONAL.md, Study I3): +1.2 points on
  // ASL Citizen val (p 0.025, missed its 0.0125 gate) and +3.8 points on unseen PopSign signers. Off by default.
  class Adapter {
    constructor(D, minSegments = 20) { this.D = D; this.minSegments = minSegments; this.reset(); }
    reset() { this.sum = new Float64Array(this.D); this.n = 0; }
    add(meanFrame) { for (let d = 0; d < this.D; d++) this.sum[d] += meanFrame[d]; this.n++; }
    get active() { return this.n >= this.minSegments; }
    shift() { if (!this.active) return null; const s = new Float64Array(this.D); for (let d = 0; d < this.D; d++) s[d] = this.sum[d] / this.n; return s; }
  }

  class Model {
    constructor(h, T) { this.h = h; this.T = T; this.labels = h.labels; this.words = h.words || h.labels; this.adapter = new Adapter(h.D); this.adapting = false; }
    get size() { return this.h.K; }

    // normalised input [L][D] (resampled, then (x - mean) / std)
    normalised(rows) {
      const { L, D } = this.h, x = resampleRows(rows, L), mean = this.T.mean, std = this.T.std, out = [];
      for (let t = 0; t < L; t++) { const r = new Float64Array(D); for (let d = 0; d < D; d++) r[d] = (x[t][d] - mean[d]) / std[d]; out.push(r); }
      return out;
    }
    meanFrame(xn) {
      const D = this.h.D, m = new Float64Array(D);
      for (const r of xn) for (let d = 0; d < D; d++) m[d] += r[d];
      for (let d = 0; d < D; d++) m[d] /= xn.length;
      return m;
    }

    // rows: segment feature rows [T][D]; shift: optional Float64Array(D) subtracted from the normalised input.
    // Returns { z: Float32Array(2C) pooled embedding, logits: Float32Array(K) }.
    forward(rows, shift = null, xn = null) {
      const { L, D, C, K, kernel, blocks } = this.h, T = this.T;
      xn = xn || this.normalised(rows);
      const h = new Float32Array(L * C), tmp = new Float32Array(L * C);
      const W0 = T.W0, b0 = T.b0, v = new Float64Array(D);
      for (let t = 0; t < L; t++) {
        const r = xn[t];
        for (let d = 0; d < D; d++) v[d] = shift ? r[d] - shift[d] : r[d];
        for (let c = 0; c < C; c++) {
          let s = b0[c];
          for (let d = 0; d < D; d++) s += v[d] * W0[d * C + c];
          h[t * C + c] = s;
        }
      }
      layerNorm(h, L, C, T.g0, T.be0); for (let i = 0; i < h.length; i++) h[i] = gelu(h[i]);
      const pad = (kernel - 1) >> 1;
      for (let b = 0; b < blocks; b++) {
        const dw = T[`dw${b}`], db = T[`db${b}`], Wp = T[`Wp${b}`], bp = T[`bp${b}`];
        for (let t = 0; t < L; t++) for (let c = 0; c < C; c++) {
          let s = db[c];
          for (let k = 0; k < kernel; k++) { const tt = t + k - pad; if (tt >= 0 && tt < L) s += dw[k * C + c] * h[tt * C + c]; }
          tmp[t * C + c] = s;
        }
        const y = new Float32Array(C);
        for (let t = 0; t < L; t++) {
          for (let c = 0; c < C; c++) {
            let s = bp[c];
            for (let e = 0; e < C; e++) s += tmp[t * C + e] * Wp[e * C + c];
            y[c] = gelu(s);
          }
          for (let c = 0; c < C; c++) h[t * C + c] += y[c];
        }
        layerNorm(h, L, C, T[`g${b + 1}`], T[`be${b + 1}`]);
      }
      const z = new Float32Array(2 * C);
      for (let c = 0; c < C; c++) {
        let s = 0, m = -Infinity;
        for (let t = 0; t < L; t++) { const val = h[t * C + c]; s += val; if (val > m) m = val; }
        z[c] = s / L; z[C + c] = m;
      }
      const out = new Float32Array(K), Wc = T.Wc, bc = T.bc;
      for (let k = 0; k < K; k++) out[k] = bc[k];
      for (let j = 0; j < 2 * C; j++) { const val = z[j]; if (!val) continue; for (let k = 0; k < K; k++) out[k] += val * Wc[j * K + k]; }
      return { z, logits: out };
    }
    logits(rows, shift = null) { return this.forward(rows, shift).logits; }

    // One pass: class probabilities and the unit embedding. Uses (and with learn = true, updates) the signer
    // adapter when adapting is on.
    // adapt = false skips the shift for this call (e.g. a recorded video of someone else, or "My words only").
    analyse(rows, { learn = false, adapt = true } = {}) {
      const xn = this.normalised(rows), shift = this.adapting && adapt ? this.adapter.shift() : null;
      const { z, logits } = this.forward(rows, shift, xn);
      if (this.adapting && learn) this.adapter.add(this.meanFrame(xn));
      return { p: softmaxInto(logits), emb: unit(z) };
    }
    setAdapting(on) { this.adapting = !!on; }
    get adaptCount() { return this.adapter.n; }
    get adaptActive() { return this.adapting && this.adapter.active; }
    resetAdapting() { this.adapter.reset(); }

    // allow: optional Set of class indices; the softmax is then taken over those classes only
    // (limiting a model to a smaller vocabulary, e.g. the childcare words).
    predict(rows, topk = 5, allow = null) { return ranked(this, this.analyse(rows).p, topk, allow); }

    classifySegment(seg, opts) { return classify(this, seg, opts); }
  }

  // Probabilities (summing to 1 over all classes) -> top-k, renormalised over `allow` when given.
  function ranked(model, p, topk, allow) {
    const K = p.length, ok = k => !allow || allow.has(k);
    let s = 0; for (let k = 0; k < K; k++) if (ok(k)) s += p[k];
    const idx = [...Array(K).keys()].filter(ok).sort((a, b) => p[b] - p[a]).slice(0, topk);
    return idx.map(i => ({ index: i, label: model.labels[i], word: model.words[i], p: p[i] / s }));
  }

  // Several member networks over the same labels; class probabilities are averaged, then (with allow)
  // limited to the allowed classes and renormalised - the same order of operations as the trainer's export_ens.
  // Embedding: each member's z made unit length, concatenated, made unit length (sbnet.embedding).
  class Ensemble {
    constructor(h, members) { this.h = h; this.members = members; this.labels = h.labels; this.words = h.words || h.labels; }
    get size() { return this.h.K; }
    analyse(rows, opts = {}) {
      const K = this.h.K, p = new Float64Array(K), parts = [];
      for (const m of this.members) {
        const a = m.analyse(rows, opts);
        for (let k = 0; k < K; k++) p[k] += a.p[k] / this.members.length;
        parts.push(a.emb);
      }
      const n = parts[0].length, cat = new Float64Array(n * parts.length);
      parts.forEach((e, i) => cat.set(e, i * n));
      return { p, emb: unit(cat) };
    }
    probs(rows) { return this.analyse(rows).p; }
    predict(rows, topk = 5, allow = null) { return ranked(this, this.analyse(rows).p, topk, allow); }
    setAdapting(on) { this.members.forEach(m => m.setAdapting(on)); }
    get adapting() { return this.members[0].adapting; }
    get adaptCount() { return this.members[0].adaptCount; }
    get adaptActive() { return this.members[0].adaptActive; }
    resetAdapting() { this.members.forEach(m => m.resetAdapting()); }
    classifySegment(seg, opts) { return classify(this, seg, opts); }
  }

  // A Lab segment (or a stored example: {pre, raw, mirrored}) -> feature rows at the model's frame rate.
  function segmentRows(model, seg, { fps, aspect }) {
    const h = model.h;
    const raws = resampleRaw([...seg.pre, ...seg.raw], fps, h.fps);
    const pre = Math.round((seg.pre.length * h.fps) / (fps || h.fps));
    return P.featurise(raws, Math.min(pre, raws.length - 1), aspect, seg.mirrored);
  }

  // A closed Lab segment -> one caption word. Re-featurises at the model's frame rate.
  // personal: an SBPersonal.Personal fitted on this model -> answer only among the taught words ("My words only";
  //   its examples are analysed without the signer shift, so the segment is too).
  // learn: update the signer adapter with this segment; adapt: apply the adapter's shift (both only when adapting is on).
  function classify(model, seg, { fps, aspect, allow = null, personal = null, learn = false, adapt = true }) {
    const h = model.h;
    const rows = segmentRows(model, seg, { fps, aspect });
    if (!rows.length) return null;
    const a = model.analyse(rows, { learn, adapt: adapt && !personal });
    if (personal) return personal.classify(a);
    const top = ranked(model, a.p, 5, allow);
    const th = (allow && h.thresholds_childcare) || h.thresholds || { ok: 0.5, unsure: 0.15 };
    const best = top[0];
    const status = best.p >= th.ok ? 'ok' : best.p >= th.unsure ? 'uncertain' : 'reject';
    return { label: best.word, status, p: best.p, top, source: 'model' };
  }

  function layerNorm(h, L, C, g, b) {
    for (let t = 0; t < L; t++) {
      let mu = 0; for (let c = 0; c < C; c++) mu += h[t * C + c]; mu /= C;
      let v = 0; for (let c = 0; c < C; c++) { const d = h[t * C + c] - mu; v += d * d; } v /= C;
      const inv = 1 / Math.sqrt(v + 1e-5);
      for (let c = 0; c < C; c++) h[t * C + c] = (h[t * C + c] - mu) * inv * g[c] + b[c];
    }
  }

  const api = { parse, resampleRows, resampleRaw, gelu, Ensemble, Adapter, segmentRows, unit, ranked };
  root.SBSignModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
