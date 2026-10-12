// Few-shot sign recogniser for the Lab: segmenter + DTW nearest-neighbour + spotting.
// Works on SignBridge feature rows (features.js), so it exercises the production
// front end (landmarks -> body frame -> features) with no trained network.
(function (root) {
  const F = root.SBFeatures || (typeof require !== 'undefined' ? require('./features.js') : null);
  const IDX = F.IDX;
  const DIMS = [...IDX.loc, ...IDX.shape, ...IDX.tips, ...IDX.pres];
  const GROUPS = [
    { name: 'location', n: IDX.loc.length },
    { name: 'handshape', n: IDX.shape.length },
    { name: 'fingertips', n: IDX.tips.length },
    { name: 'presence', n: IDX.pres.length },
  ];
  const fin = Number.isFinite;

  // ------------------------------------------------------------ segmenter
  // A frame is "active" when a detected hand's wrist is above the rest line (body
  // frame, y down, unit = shoulder width, 0 = shoulder line). Hysteresis opens a
  // segment after `onFrames` active frames and closes it after `offFrames` rest frames.
  class Segmenter {
    constructor(o = {}) {
      this.o = Object.assign({ onFrames: 3, offFrames: 6, minLen: 8, maxLen: 150, restY: 1.0 }, o);
      this.reset();
    }
    reset() { this.t = -1; this.state = 'idle'; this.runOn = 0; this.runOff = 0; this.start = null; }
    isActive(f) {
      const l = f[IDX.pres[0]] > 0.5 && f[IDX.lwristY] < this.o.restY;
      const r = f[IDX.pres[1]] > 0.5 && f[IDX.rwristY] < this.o.restY;
      return l || r;
    }
    // Returns null or {start, end} (inclusive absolute frame indices) when a segment closes.
    push(f) {
      this.t++;
      const a = this.isActive(f), o = this.o;
      if (this.state === 'idle') {
        this.runOn = a ? this.runOn + 1 : 0;
        if (this.runOn >= o.onFrames) { this.state = 'active'; this.start = this.t - this.runOn + 1; this.runOff = 0; }
        return null;
      }
      this.runOff = a ? 0 : this.runOff + 1;
      const len = this.t - this.start + 1;
      if (this.runOff >= o.offFrames || len >= o.maxLen) {
        const end = this.runOff >= o.offFrames ? this.t - this.runOff : this.t;
        const seg = { start: this.start, end };
        this.state = 'idle'; this.runOn = 0; this.start = null;
        return end - seg.start + 1 >= o.minLen ? seg : null;
      }
      return null;
    }
    flush() {
      if (this.state !== 'active') return null;
      const seg = { start: this.start, end: this.t };
      this.state = 'idle'; this.start = null;
      return seg.end - seg.start + 1 >= this.o.minLen ? seg : null;
    }
  }

  // ------------------------------------------------------------ maths
  function median(v) {
    if (!v.length) return NaN;
    const s = Float64Array.from(v).sort(), h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  function quantile(v, q) {
    const s = Float64Array.from(v).sort();
    if (!s.length) return NaN;
    const p = (s.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return s[lo] + (s[hi] - s[lo]) * (p - lo);
  }

  // frames: array of Float32Array(D). Returns Float64Array(L * d) resampled + normalised.
  function prepare(frames, L, norm) {
    const n = frames.length, d = DIMS.length, out = new Float64Array(L * d);
    for (let i = 0; i < L; i++) {
      const src = n === 1 ? 0 : (i * (n - 1)) / (L - 1);
      const a = Math.floor(src), b = Math.min(a + 1, n - 1), w = src - a;
      for (let k = 0; k < d; k++) {
        const j = DIMS[k];
        const v = frames[a][j] * (1 - w) + frames[b][j] * w;
        out[i * d + k] = ((v - norm.mean[k]) / norm.std[k]) * norm.w[k];
      }
    }
    return out;
  }

  // DTW with a Sakoe-Chiba band; equal-length inputs; mean cost along the path.
  function dtw(A, B, L, d, band) {
    const INF = Infinity, acc = new Float64Array(L * L).fill(INF), len = new Int32Array(L * L);
    for (let i = 0; i < L; i++) {
      const j0 = Math.max(0, i - band), j1 = Math.min(L - 1, i + band);
      for (let j = j0; j <= j1; j++) {
        let s = 0;
        for (let k = 0, ia = i * d, jb = j * d; k < d; k++) { const t = A[ia + k] - B[jb + k]; s += t * t; }
        const c = Math.sqrt(s);
        if (i === 0 && j === 0) { acc[0] = c; len[0] = 1; continue; }
        let best = INF, bl = 0;
        if (i > 0 && acc[(i - 1) * L + j] < best) { best = acc[(i - 1) * L + j]; bl = len[(i - 1) * L + j]; }
        if (j > 0 && acc[i * L + j - 1] < best) { best = acc[i * L + j - 1]; bl = len[i * L + j - 1]; }
        if (i > 0 && j > 0 && acc[(i - 1) * L + j - 1] <= best) { best = acc[(i - 1) * L + j - 1]; bl = len[(i - 1) * L + j - 1]; }
        acc[i * L + j] = best + c; len[i * L + j] = bl + 1;
      }
    }
    return acc[L * L - 1] / len[L * L - 1];
  }

  // ------------------------------------------------------------ recogniser
  class FewShot {
    constructor(o = {}) {
      this.o = Object.assign({ L: 24, band: 6, tauQuantile: 0.9, tauSlack: 1.25, minMargin: 0.1, stdFloor: 0.05 }, o);
      this.templates = []; this.ready = false;
    }

    // templates: [{label, frames: Float32Array[]}]
    fit(templates) {
      const o = this.o, d = DIMS.length;
      this.templates = templates.filter(t => t.frames.length >= 2);
      this.labels = [...new Set(this.templates.map(t => t.label))];
      if (!this.templates.length) { this.ready = false; return this.stats = null; }
      // per-dimension normalisation over all template frames, then equal weight per feature group
      const mean = new Float64Array(d), sq = new Float64Array(d);
      let n = 0;
      for (const t of this.templates) for (const f of t.frames) {
        n++;
        for (let k = 0; k < d; k++) { const v = f[DIMS[k]]; mean[k] += v; sq[k] += v * v; }
      }
      const std = new Float64Array(d), w = new Float64Array(d);
      for (let k = 0; k < d; k++) {
        mean[k] /= n;
        std[k] = Math.max(o.stdFloor, Math.sqrt(Math.max(0, sq[k] / n - mean[k] * mean[k])));
      }
      let k0 = 0;
      for (const g of GROUPS) { for (let k = k0; k < k0 + g.n; k++) w[k] = 1 / Math.sqrt(g.n); k0 += g.n; }
      this.norm = { mean, std, w };
      this.seqs = this.templates.map(t => prepare(t.frames, o.L, this.norm));
      this.medLen = median(this.templates.map(t => t.frames.length));
      // pairwise distances (templates are few: tens to a few hundred)
      const N = this.templates.length;
      this.pair = new Float64Array(N * N);
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
        const v = dtw(this.seqs[i], this.seqs[j], o.L, d, o.band);
        this.pair[i * N + j] = this.pair[j * N + i] = v;
      }
      // class medoids for fast screening during spotting
      this.medoid = {};
      for (const lab of this.labels) {
        const ids = this.templates.map((t, i) => (t.label === lab ? i : -1)).filter(i => i >= 0);
        let best = ids[0], bs = Infinity;
        for (const i of ids) { const s = ids.reduce((a, j) => a + this.pair[i * N + j], 0); if (s < bs) { bs = s; best = i; } }
        this.medoid[lab] = best;
      }
      // acceptance threshold from within-class nearest-neighbour distances
      const dIn = [];
      for (let i = 0; i < N; i++) {
        let m = Infinity;
        for (let j = 0; j < N; j++) if (j !== i && this.templates[j].label === this.templates[i].label) m = Math.min(m, this.pair[i * N + j]);
        if (fin(m)) dIn.push(m);
      }
      this.tau = dIn.length ? quantile(dIn, o.tauQuantile) * o.tauSlack : Infinity;
      this.ready = true;
      return (this.stats = this.selfTest());
    }

    _decide(perClass) {                 // perClass: Map label -> best distance
      const ranked = [...perClass.entries()].sort((a, b) => a[1] - b[1]);
      const [l1, d1] = ranked[0], d2 = ranked.length > 1 ? ranked[1][1] : Infinity;
      const margin = fin(d2) ? (d2 - d1) / d2 : 1;
      const status = d1 > this.tau ? 'reject' : margin < this.o.minMargin ? 'uncertain' : 'ok';
      return { label: l1, d1, d2, margin, status, strength: Math.max(0, Math.min(1, margin / 0.3)),
               top: ranked.slice(0, 3).map(([l, d]) => ({ label: l, d })) };
    }

    _scoreSeq(seq, exclude = -1, onlyLabels = null) {
      const per = new Map(), d = DIMS.length;
      this.templates.forEach((t, i) => {
        if (i === exclude || (onlyLabels && !onlyLabels.has(t.label))) return;
        const v = exclude >= 0 && this.pair ? this.pair[exclude * this.templates.length + i] : dtw(seq, this.seqs[i], this.o.L, d, this.o.band);
        if (!per.has(t.label) || v < per.get(t.label)) per.set(t.label, v);
      });
      return per;
    }

    classify(frames) {
      if (!this.ready) return null;
      const seq = prepare(frames, this.o.L, this.norm);
      return this._decide(this._scoreSeq(seq));
    }

    // Leave-one-out on the taught examples (same signer: an upper bound, not a field estimate).
    selfTest() {
      const N = this.templates.length, rows = [];
      for (let i = 0; i < N; i++) {
        const per = this._scoreSeq(null, i);
        if (!per.size) continue;
        const r = this._decide(per);
        rows.push({ truth: this.templates[i].label, pred: r.label, status: r.status, correct: r.label === this.templates[i].label });
      }
      const answered = rows.filter(r => r.status !== 'reject');
      return {
        n: rows.length, correct: rows.filter(r => r.correct).length,
        answered: answered.length, answeredCorrect: answered.filter(r => r.correct).length,
        uncertain: rows.filter(r => r.status === 'uncertain').length,
        perClass: this.labels.map(l => {
          const rs = rows.filter(r => r.truth === l);
          return { label: l, n: rs.length, correct: rs.filter(r => r.correct).length,
                   confusedWith: [...new Set(rs.filter(r => !r.correct).map(r => r.pred))] };
        }),
        tau: this.tau,
      };
    }

    // A segment may hold several signs with no rest between them: slide windows of the
    // typical sign length, screen with class medoids, refine the best classes, then keep
    // non-overlapping accepted matches in time order.
    spot(frames) {
      if (!this.ready) return [];
      const n = frames.length, m = this.medLen;
      if (n < 1.6 * m) return [{ start: 0, end: n - 1, ...this.classify(frames) }];
      const d = DIMS.length, L = this.o.L, cands = [];
      const stride = Math.max(2, Math.round(m / 6));
      for (const sc of [0.8, 1.0, 1.25]) {
        const w = Math.max(4, Math.round(m * sc));
        for (let s = 0; s + w <= n; s += stride) {
          const seq = prepare(frames.slice(s, s + w), L, this.norm);
          const screen = this.labels.map(l => [l, dtw(seq, this.seqs[this.medoid[l]], L, d, this.o.band)])
            .sort((a, b) => a[1] - b[1]).slice(0, 3).map(x => x[0]);
          const per = this._scoreSeq(seq, -1, new Set(screen));
          for (const l of this.labels) if (!per.has(l)) per.set(l, Infinity);
          const r = this._decide(per);
          if (r.status !== 'reject') cands.push({ start: s, end: s + w - 1, ...r });
        }
      }
      cands.sort((a, b) => a.d1 - b.d1);
      const keep = [];
      for (const c of cands) {
        const clash = keep.some(k => {
          const inter = Math.min(k.end, c.end) - Math.max(k.start, c.start) + 1;
          return inter > 0.3 * Math.min(k.end - k.start + 1, c.end - c.start + 1);
        });
        if (!clash) keep.push(c);
      }
      if (!keep.length) return [{ start: 0, end: n - 1, ...this.classify(frames) }];
      return keep.sort((a, b) => a.start - b.start);
    }
  }

  // ------------------------------------------------------------ captions
  // Words from recognised segments -> caption text. Unsure words keep a visible flag.
  function wordText(r) {
    if (r.status === 'reject') return '[?]';
    return r.status === 'uncertain' ? `[${r.label}?]` : r.label;
  }
  function sentenceText(words) {
    const t = words.join(' ').trim();
    return t ? t[0].toUpperCase() + t.slice(1) + '.' : '';
  }

  const api = { Segmenter, FewShot, dtw, prepare, DIMS, GROUPS, wordText, sentenceText, median, quantile };
  root.SBRecognizer = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
