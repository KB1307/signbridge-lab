// "My words only": recognition among the words this user has taught, using the loaded model and the
// user's own examples together (method M5 in models/PREREG_PERSONAL.md, chosen on DEV people, gated on
// CONFIRM people the model never saw).
//
//   centre  = mean embedding of all taught examples
//   proto_w = unit( mean over w's examples of unit(emb - centre) )
//   cos_w   = unit(emb - centre) . proto_w
//   lp_w    = log of the model's probability for w (best of its classes, renormalised over the classes of the
//             taught words); a word the model does not know gets the lowest lp of the known words (0 if none)
//   score_w = lp_w + BETA * (cos_w - M0)                     BETA = 32, M0 = 0.5 (from DEV)
//   p_w     = softmax(score)_w; status ok >= 0.99, unsure >= 0.84, else reject (thresholds from DEV)
// Measured on 8 unseen PopSign signers, 96 words, 3 examples each: model alone 29.6%, this 52.5%
// (+15.6 to +30.1 points); the app's DTW recogniser 38.1%. Answered as ok: 36.8% of signs at 84.9% precision.
// With 10 extra words the model does not know, those words were right only 18.7% of the time (known words 52.4%).
(function (root) {
  const BETA = 32, M0 = 0.5, TH = { ok: 0.99, unsure: 0.84 };
  const norm = w => String(w || '').toLowerCase().replace(/[^a-z]/g, '');

  function unit(v) {
    let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    const inv = 1 / Math.max(Math.sqrt(s), 1e-12), o = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) o[i] = v[i] * inv;
    return o;
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const sub = (a, b) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]; return o; };
  function meanOf(vs, dim) { const m = new Float64Array(dim); for (const v of vs) for (let i = 0; i < dim; i++) m[i] += v[i] / vs.length; return m; }

  class Personal {
    constructor(o = {}) { this.o = Object.assign({ beta: BETA, m0: M0, thresholds: TH }, o); this.ready = false; this.stats = null; }

    // model: anything with .words (one English word per class); examples: [{label, p: Float64Array(K), emb}]
    // centre: optional fixed centre (used by the leave-one-out self-test); test: run the self-test.
    fit(model, examples, { centre = null, test = true } = {}) {
      this.model = model;
      this.ex = examples.filter(e => e && e.emb && e.p && norm(e.label));
      this.words = [...new Set(this.ex.map(e => e.label))].sort();
      this.ready = this.words.length >= 2;
      this.stats = null;
      if (!this.ex.length) return null;
      const dim = this.ex[0].emb.length;
      this.centre = centre || meanOf(this.ex.map(e => e.emb), dim);
      this.proto = this.words.map(w => unit(meanOf(this.ex.filter(e => e.label === w).map(e => unit(sub(e.emb, this.centre))), dim)));
      this.cols = this.words.map(w => model.words.map((mw, k) => (norm(mw) === norm(w) ? k : -1)).filter(k => k >= 0));
      this.known = this.cols.filter(c => c.length).length;
      if (test && this.ready) this.stats = this.selfTest();
      return this.stats;
    }

    // scores for one analysed segment {p, emb} -> [{word, s, cos, lp}] in the order of this.words
    score(a) {
      const allowed = [...new Set(this.cols.flat())];
      let tot = 0; for (const k of allowed) tot += a.p[k];
      const lp = this.cols.map(cs => cs.length ? Math.log(Math.max(Math.max(...cs.map(k => a.p[k])) / (tot || 1), 1e-30)) : null);
      const known = lp.filter(v => v !== null), floor = known.length ? Math.min(...known) : 0;
      const q = unit(sub(a.emb, this.centre));
      return this.words.map((w, i) => { const cos = dot(q, this.proto[i]), l = lp[i] === null ? floor : lp[i];
        return { word: w, cos, lp: l, s: l + this.o.beta * (cos - this.o.m0) }; });
    }

    classify(a) {
      const sc = this.score(a), mx = Math.max(...sc.map(x => x.s));
      let z = 0; const pr = sc.map(x => { const e = Math.exp(x.s - mx); z += e; return e; });
      const ranked = sc.map((x, i) => ({ word: x.word, label: x.word, p: pr[i] / z })).sort((x, y) => y.p - x.p);
      const best = ranked[0], th = this.o.thresholds;
      const status = best.p >= th.ok ? 'ok' : best.p >= th.unsure ? 'uncertain' : 'reject';
      return { label: best.word, status, p: best.p, top: ranked.slice(0, 5), source: 'personal' };
    }

    // Leave-one-out on the taught examples: each example is scored against prototypes built without it
    // (the centre stays the mean of all examples). Same signer as the examples: a best case, not a field estimate.
    selfTest() {
      const rows = [];
      for (let j = 0; j < this.ex.length; j++) {
        const e = this.ex[j], rest = this.ex.filter((_, i) => i !== j);
        if (!rest.some(r => r.label === e.label)) continue;           // its word has no other example
        const P = new Personal(this.o); P.fit(this.model, rest, { centre: this.centre, test: false });
        if (!P.ready) continue;
        const r = P.classify(e);
        rows.push({ truth: e.label, pred: r.label, status: r.status, correct: r.label === e.label });
      }
      return { n: rows.length, correct: rows.filter(r => r.correct).length, ok: rows.filter(r => r.status === 'ok').length,
               okCorrect: rows.filter(r => r.status === 'ok' && r.correct).length,
               perWord: this.words.map(w => { const rs = rows.filter(r => r.truth === w);
                 return { label: w, n: rs.length, correct: rs.filter(r => r.correct).length, confusedWith: [...new Set(rs.filter(r => !r.correct).map(r => r.pred))] }; }) };
    }
  }

  const api = { Personal, BETA, M0, TH, norm };
  root.SBPersonal = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
