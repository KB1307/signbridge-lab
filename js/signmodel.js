// Trained sign classifier for the Lab: reads a .sbm model file and classifies one signing
// segment into a word. The model is trained offline (lab/tools/train_signmodel.py) on
// landmark features from this same pipeline, so the phone computes exactly what training saw.
//
// .sbm layout: "SBM1" | uint32 header length (LE) | UTF-8 JSON header | padding to 4 | float32 blob.
// Header: { name, labels[], words[], fps, L, D, C, K, kernel, blocks, tensors: {name: [offset, shape]},
//           thresholds: {ok, unsure}, metrics, attribution, licence }
// Network (all plain arithmetic, mirrored exactly in the trainer):
//   x = resample(segment features, L frames); x = (x - mean) / std
//   h = gelu(LN(x W0 + b0))
//   repeat `blocks`: y = depthwise_conv_time(h, kernel) ; y = gelu(y Wp + bp) ; h = LN(h + y)
//   z = [mean_t h, max_t h] ; logits = z Wc + bc ; softmax
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

  class Model {
    constructor(h, T) { this.h = h; this.T = T; this.labels = h.labels; this.words = h.words || h.labels; }
    get size() { return this.h.K; }

    logits(rows) {                                   // rows: segment feature rows [T][D]
      const { L, D, C, K, kernel, blocks } = this.h, T = this.T;
      const x = resampleRows(rows, L);
      const h = new Float32Array(L * C), tmp = new Float32Array(L * C);
      const mean = T.mean, std = T.std, W0 = T.W0, b0 = T.b0;
      const xn = new Float32Array(D);
      for (let t = 0; t < L; t++) {
        for (let d = 0; d < D; d++) xn[d] = (x[t][d] - mean[d]) / std[d];
        for (let c = 0; c < C; c++) {
          let s = b0[c];
          for (let d = 0; d < D; d++) s += xn[d] * W0[d * C + c];
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
        for (let t = 0; t < L; t++) { const v = h[t * C + c]; s += v; if (v > m) m = v; }
        z[c] = s / L; z[C + c] = m;
      }
      const out = new Float32Array(K), Wc = T.Wc, bc = T.bc;
      for (let k = 0; k < K; k++) out[k] = bc[k];
      for (let j = 0; j < 2 * C; j++) { const v = z[j]; if (!v) continue; for (let k = 0; k < K; k++) out[k] += v * Wc[j * K + k]; }
      return out;
    }

    // allow: optional Set of class indices; the softmax is then taken over those classes only
    // (limiting a model to a smaller vocabulary, e.g. the childcare words).
    predict(rows, topk = 5, allow = null) {
      const lg = this.logits(rows), K = lg.length;
      const ok = k => !allow || allow.has(k);
      let m = -Infinity; for (let k = 0; k < K; k++) if (ok(k) && lg[k] > m) m = lg[k];
      let s = 0; const p = new Float32Array(K); for (let k = 0; k < K; k++) { p[k] = ok(k) ? Math.exp(lg[k] - m) : 0; s += p[k]; }
      for (let k = 0; k < K; k++) p[k] /= s;
      const idx = [...p.keys()].filter(ok).sort((a, b) => p[b] - p[a]).slice(0, topk);
      return idx.map(i => ({ index: i, label: this.labels[i], word: this.words[i], p: p[i] }));
    }

    classifySegment(seg, opts) { return classify(this, seg, opts); }
  }

  // Several member networks over the same labels; class probabilities are averaged, then (with allow)
  // limited to the allowed classes and renormalised - the same order of operations as the trainer's export_ens.
  class Ensemble {
    constructor(h, members) { this.h = h; this.members = members; this.labels = h.labels; this.words = h.words || h.labels; }
    get size() { return this.h.K; }
    probs(rows) {
      const K = this.h.K, p = new Float64Array(K);
      for (const m of this.members) {
        const lg = m.logits(rows); let mx = -Infinity; for (let k = 0; k < K; k++) if (lg[k] > mx) mx = lg[k];
        let s = 0; const e = new Float64Array(K); for (let k = 0; k < K; k++) { e[k] = Math.exp(lg[k] - mx); s += e[k]; }
        for (let k = 0; k < K; k++) p[k] += e[k] / s / this.members.length;
      }
      return p;
    }
    predict(rows, topk = 5, allow = null) {
      const p = this.probs(rows), K = p.length, ok = k => !allow || allow.has(k);
      let s = 0; for (let k = 0; k < K; k++) if (ok(k)) s += p[k];
      const idx = [...Array(K).keys()].filter(ok).sort((a, b) => p[b] - p[a]).slice(0, topk);
      return idx.map(i => ({ index: i, label: this.labels[i], word: this.words[i], p: p[i] / s }));
    }
    classifySegment(seg, opts) { return classify(this, seg, opts); }
  }

  // A closed Lab segment -> one caption word. Re-featurises at the model's frame rate.
  function classify(model, seg, { fps, aspect, allow = null }) {
    const h = model.h;
    const raws = resampleRaw([...seg.pre, ...seg.raw], fps, h.fps);
    const pre = Math.round((seg.pre.length * h.fps) / (fps || h.fps));
    const rows = P.featurise(raws, Math.min(pre, raws.length - 1), aspect, seg.mirrored);
    if (!rows.length) return null;
    const top = model.predict(rows, 5, allow);
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

  const api = { parse, resampleRows, resampleRaw, gelu, Ensemble };
  root.SBSignModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
