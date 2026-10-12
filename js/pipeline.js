// Lab pipeline: raw landmark frames in, finished segments out (with consistent features).
// Shared by the page and by lab/tests/recognizer.test.js so both run the same code.
//
// Handedness: a live stream can only switch to "left-dominant" between signs, so the
// first sign of a left-handed signer would be featurised un-mirrored. When a segment
// closes, the pipeline decides handedness from that segment's own frames and
// re-featurises it (with up to 90 frames of pre-roll for the body frame), so taught
// examples and live signs are always encoded the same way.
(function (root) {
  const F = root.SBFeatures || require('./features.js');
  const R = root.SBRecognizer || require('./recognizer.js');
  const L = root.SBLayout || require('./layout.gen.js');
  const PRE = 90;

  function handPresent(raw, off) {
    let ok = 0;
    for (let j = 0; j < L.N_HAND; j++) {
      const p = (off + j) * 3;
      if (Number.isFinite(raw[p]) && Number.isFinite(raw[p + 1])) ok++;
    }
    return ok / L.N_HAND >= 0.5;
  }

  // Features for a stored example: run pre-roll + segment through a fresh stream with
  // fixed handedness and keep the segment rows. Used at capture time and on import,
  // so an exported and re-imported example is encoded exactly as when it was taught.
  function featurise(raws, preCount, aspect, mirrored) {
    const fs = new F.FeatureStream(aspect, 90, 15, mirrored), out = [];
    raws.forEach((r, i) => { const f = fs.push(r, false); if (i >= preCount) out.push(f); });
    return out;
  }

  class LabPipeline {
    constructor(o = {}) {
      this.o = Object.assign({ aspect: 1.0, handedness: 'auto', restY: 1.0, onFrames: 3, offFrames: 6, minLen: 8, maxLen: 150 }, o);
      this.reset();
    }
    forced() { return this.o.handedness === 'left' ? true : this.o.handedness === 'right' ? false : null; }
    reset() {
      const o = this.o;
      this.stream = new F.FeatureStream(o.aspect, 90, 15, this.forced());
      this.seg = new R.Segmenter({ onFrames: o.onFrames, offFrames: o.offFrames, minLen: o.minLen, maxLen: o.maxLen, restY: o.restY });
      this.buf = [];               // {t, raw}
      this.t = -1;
      this.lastActive = false;
    }
    configure(patch) { Object.assign(this.o, patch); this.reset(); }

    push(raw) {
      this.t++;
      this.buf.push({ t: this.t, raw });
      const cap = PRE + this.o.maxLen + this.o.offFrames + 8;
      if (this.buf.length > cap) this.buf.shift();
      const feat = this.stream.push(raw, this.seg.state === 'idle');
      this.lastActive = this.seg.isActive(feat);
      const s = this.seg.push(feat);
      return { t: this.t, feat, active: this.lastActive, state: this.seg.state, closed: s ? this._build(s) : null };
    }
    flush() { const s = this.seg.flush(); return s ? this._build(s) : null; }

    // true = signer's left hand dominant, false = right, null = cannot tell.
    // Presence decides when one hand is clearly visible more often; in two-handed signs
    // both are visible, so the hand whose wrist travels further is the dominant one.
    _dominantIsLeft(frames) {
      const a = this.o.aspect;
      let nl = 0, nr = 0, ml = 0, mr = 0, pl = null, pr = null;
      for (const b of frames) {
        const l = handPresent(b.raw, L.OFF.lhand), r = handPresent(b.raw, L.OFF.rhand);
        if (l) { nl++; const w = [b.raw[L.OFF.lhand * 3] * a, b.raw[L.OFF.lhand * 3 + 1]]; if (pl) ml += Math.hypot(w[0] - pl[0], w[1] - pl[1]); pl = w; } else pl = null;
        if (r) { nr++; const w = [b.raw[L.OFF.rhand * 3] * a, b.raw[L.OFF.rhand * 3 + 1]]; if (pr) mr += Math.hypot(w[0] - pr[0], w[1] - pr[1]); pr = w; } else pr = null;
      }
      if (Math.abs(nl - nr) > 0.15 * frames.length) return nl > nr;
      if (ml > 1.3 * mr) return true;
      if (mr > 1.3 * ml) return false;
      // Same visibility and same travel (symmetric movement): the dominant hand is the
      // one that changes handshape; in real symmetric signs both match and we abstain.
      const sl = this._shapeChange(frames, L.OFF.lhand), sr = this._shapeChange(frames, L.OFF.rhand);
      if (sl > 1.5 * sr + 0.05) return true;
      if (sr > 1.5 * sl + 0.05) return false;
      return null;
    }

    // Total change in fingertip-to-wrist distances (in hand units) across the segment.
    _shapeChange(frames, off) {
      const a = this.o.aspect, tips = [4, 8, 12, 16, 20];
      let prev = null, tot = 0;
      for (const b of frames) {
        const r = b.raw, w = off * 3, m = (off + 9) * 3;
        const size = Math.hypot((r[m] - r[w]) * a, r[m + 1] - r[w + 1]);
        if (!(Number.isFinite(size) && size > 1e-6)) { prev = null; continue; }
        const cur = tips.map(k => Math.hypot((r[(off + k) * 3] - r[w]) * a, r[(off + k) * 3 + 1] - r[w + 1]) / size);
        if (prev) tot += cur.reduce((s, v, i) => s + Math.abs(v - prev[i]), 0);
        prev = cur;
      }
      return tot;
    }

    _build(s) {
      const inSeg = this.buf.filter(b => b.t >= s.start && b.t <= s.end);
      let mir = this.forced();
      if (mir === null) {
        mir = this._dominantIsLeft(inSeg);
        if (mir === null) mir = this.stream.mirrored;   // symmetric sign: keep the sticky state
        this.stream.mirrored = mir;                     // keep the live stream in step
      }
      const used = this.buf.filter(b => b.t >= s.start - PRE && b.t <= s.end);
      const preCount = used.filter(b => b.t < s.start).length;
      const frames = featurise(used.map(b => b.raw), preCount, this.o.aspect, mir);
      return { start: s.start, end: s.end, mirrored: mir, frames, raw: inSeg.map(b => b.raw),
               pre: used.slice(0, preCount).map(b => b.raw) };
    }
  }

  const api = { LabPipeline, handPresent, featurise };
  root.SBPipeline = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
