// Port of signbridge/features.py (compute_features + FeatureStream).
// Parity with Python is enforced by lab/tests/parity.test.js (max |diff| <= 1e-4).
(function (root) {
  const L = root.SBLayout || (typeof require !== 'undefined' ? require('./layout.gen.js') : null);
  const P = L.N_SEL, NH = L.N_HAND, D = L.FEATURE_DIM, CLIP = 10.0;
  const LH = L.GROUPS.lhand, RH = L.GROUPS.rhand, POSE = L.GROUPS.pose, FACE = L.FACE;
  const fin = Number.isFinite;

  // raw frame: Float32Array(543*3), NaN = missing. Returns Float64Array(P*3) selected, x*aspect.
  function select(raw, aspect) {
    const s = new Float64Array(P * 3);
    for (let i = 0; i < P; i++) {
      const r = L.SEL_RAW[i] * 3;
      s[i * 3] = raw[r] * aspect; s[i * 3 + 1] = raw[r + 1]; s[i * 3 + 2] = raw[r + 2];
    }
    return s;
  }

  function mirror(sel) {
    const o = new Float64Array(P * 3);
    for (let i = 0; i < P; i++) {
      const m = L.SEL_MIRROR[i] * 3;
      o[i * 3] = -sel[m]; o[i * 3 + 1] = sel[m + 1]; o[i * 3 + 2] = sel[m + 2];
    }
    return o;
  }

  function present(sel, a, b) {           // at least half the block's points have finite x,y
    let ok = 0;
    for (let i = a; i < b; i++) if (fin(sel[i * 3]) && fin(sel[i * 3 + 1])) ok++;
    return ok / (b - a) >= 0.5;
  }

  function median(v) {                      // numpy.median semantics (NaN-free input)
    if (!v.length) return NaN;
    const s = Float64Array.from(v).sort();
    const n = s.length, h = n >> 1;
    return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  const nanmedian = v => median(v.filter(fin));

  // sels: array of selected frames (already mirrored if needed). Returns {cx,cy,scale} or null.
  function estimateReference(sels) {
    const mx = [], my = [], w = [];
    for (const s of sels) {
      const lx = s[L.I_LSH * 3], ly = s[L.I_LSH * 3 + 1], rx = s[L.I_RSH * 3], ry = s[L.I_RSH * 3 + 1];
      if (fin(lx) && fin(ly) && fin(rx) && fin(ry)) {
        mx.push((lx + rx) / 2); my.push((ly + ry) / 2); w.push(Math.hypot(lx - rx, ly - ry));
      }
    }
    if (w.length) {
      const width = median(w);
      if (width > 1e-4) return { cx: median(mx), cy: median(my), scale: width };
    }
    const spans = [], nx = [], ny = [];
    for (const s of sels) {
      let ok = 0, lo = Infinity, hi = -Infinity;
      for (let i = FACE[0]; i < FACE[1]; i++) {
        const x = s[i * 3], y = s[i * 3 + 1];
        if (fin(x) && fin(y)) ok++;
        if (fin(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
      }
      if (ok / (FACE[1] - FACE[0]) > 0.8) {
        spans.push(hi - lo); nx.push(s[L.I_NOSE * 3]); ny.push(s[L.I_NOSE * 3 + 1]);
      }
    }
    if (spans.length) {
      const scale = median(spans) * 2.0;
      if (scale > 1e-4) return { cx: nanmedian(nx), cy: nanmedian(ny) + scale * 0.5, scale };
    }
    return null;
  }

  function handLocal(sel, g, out, oLocal, oTips) {
    const w = g[0] * 3, m = (g[0] + L.MIDDLE_MCP) * 3;
    let size = Math.hypot(sel[m] - sel[w], sel[m + 1] - sel[w + 1]);
    if (!(fin(size) && size > 1e-6)) size = NaN;
    for (let j = 0; j < NH; j++) {
      const p = (g[0] + j) * 3;
      out[oLocal + j * 2] = (sel[p] - sel[w]) / size;
      out[oLocal + j * 2 + 1] = (sel[p + 1] - sel[w + 1]) / size;
    }
    L.TIP_PAIRS.forEach(([a, b], k) => {
      const pa = (g[0] + a) * 3, pb = (g[0] + b) * 3;
      out[oTips + k] = Math.hypot(sel[pa] - sel[pb], sel[pa + 1] - sel[pb + 1]) / size;
    });
  }

  // One frame. Returns {feat: Float32Array(D), hands: Float64Array(84)} (hands = normalised xy for velocity).
  function computeFrame(sel, ref, prevHands) {
    const f = new Float64Array(D);
    let o = 0;
    for (let i = 0; i < P; i++) {
      f[o++] = (sel[i * 3] - ref.cx) / ref.scale;
      f[o++] = (sel[i * 3 + 1] - ref.cy) / ref.scale;
    }
    for (const g of [LH, RH]) for (let i = g[0]; i < g[1]; i++) f[o++] = sel[i * 3 + 2] / ref.scale;
    const oLocal = o, oTips = o + 4 * NH;
    handLocal(sel, LH, f, oLocal, oTips);
    handLocal(sel, RH, f, oLocal + 2 * NH, oTips + L.TIP_PAIRS.length);
    o = oTips + 2 * L.TIP_PAIRS.length;
    const hands = new Float64Array(4 * NH);
    let h = 0;
    for (const g of [LH, RH]) for (let i = g[0]; i < g[1]; i++) {
      hands[h++] = (sel[i * 3] - ref.cx) / ref.scale;
      hands[h++] = (sel[i * 3 + 1] - ref.cy) / ref.scale;
    }
    for (let k = 0; k < hands.length; k++) f[o++] = hands[k] - (prevHands ? prevHands[k] : NaN);
    f[o++] = present(sel, LH[0], LH[1]) ? 1 : 0;
    f[o++] = present(sel, RH[0], RH[1]) ? 1 : 0;
    f[o++] = present(sel, FACE[0], FACE[1]) ? 1 : 0;
    f[o++] = present(sel, POSE[0], POSE[1]) ? 1 : 0;
    if (o !== D) throw new Error(`feature layout mismatch ${o} != ${D}`);
    const out = new Float32Array(D);
    for (let k = 0; k < D; k++) {
      const v = f[k];
      out[k] = fin(v) ? Math.max(-CLIP, Math.min(CLIP, v)) : 0;
    }
    return { feat: out, hands };
  }

  class FeatureStream {
    // forceMirror: null = automatic sticky decision (identical to Python); true/false = fixed
    // (Lab extension used to re-featurise a finished segment with a known handedness).
    constructor(aspect = 1.0, refFrames = 90, refEvery = 15, forceMirror = null) {
      this.aspect = aspect; this.refFrames = refFrames; this.refEvery = refEvery; this.forceMirror = forceMirror;
      this.reset();
    }
    reset() { this.t = -1; this.hist = []; this.mirrored = false; this.ref = null; this.prevHands = null; }
    // raw: Float32Array(543*3). allowFlip: true between segments only.
    push(raw, allowFlip = true) {
      if (raw.length !== L.N_RAW * 3) throw new Error(`expected ${L.N_RAW * 3} values`);
      this.t++;
      this.hist.push(select(raw, this.aspect));
      if (this.hist.length > this.refFrames) this.hist.shift();
      if (this.forceMirror !== null) this.mirrored = this.forceMirror;
      else if (allowFlip) {
        let nl = 0, nr = 0;
        for (const s of this.hist) { if (present(s, LH[0], LH[1])) nl++; if (present(s, RH[0], RH[1])) nr++; }
        if (this.mirrored && nr > 1.5 * nl + 5) this.mirrored = false;
        else if (!this.mirrored && nl > 1.5 * nr + 5) this.mirrored = true;
      }
      if (this.t % this.refEvery === 0 || this.ref === null) {
        const r = estimateReference(this.mirrored ? this.hist.map(mirror) : this.hist);
        if (r) this.ref = r;
      }
      let sel = this.hist[this.hist.length - 1];
      if (this.mirrored) sel = mirror(sel);
      const ref = this.ref || estimateReference([sel]) || { cx: 0.5 * this.aspect, cy: 0.6, scale: 0.35 };
      const { feat, hands } = computeFrame(sel, ref, this.prevHands);
      this.prevHands = hands;
      return feat;
    }
  }

  // Index sets used by the recogniser (computed from the same layout).
  const IDX = (() => {
    const loc = [], shape = [], tips = [];
    for (const g of [LH, RH]) for (let i = g[0]; i < g[1]; i++) loc.push(2 * i, 2 * i + 1);
    const oLocal = 2 * P + 2 * NH;
    for (let k = 0; k < 4 * NH; k++) shape.push(oLocal + k);
    const oTips = oLocal + 4 * NH;
    for (let k = 0; k < 2 * L.TIP_PAIRS.length; k++) tips.push(oTips + k);
    const pres = [D - 4, D - 3];
    // wrists in body frame, for the rest/active segmenter
    return { loc, shape, tips, pres, lwristY: 2 * LH[0] + 1, rwristY: 2 * RH[0] + 1 };
  })();

  const api = { select, mirror, estimateReference, computeFrame, FeatureStream, IDX, D };
  root.SBFeatures = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
