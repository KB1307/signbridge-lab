// node lab/tests/personal.test.js
// PRE-REGISTERED GATES (written 2026-10-16 before the first run) for js/personal.js ("My words only"):
//   P1 on the planted fixture (tests/personal_fixture.json: 4 taught words incl. one with two model classes and one
//      the model does not know), every word score and probability equals the NumPy reference of the study formula
//      within 1e-9, and the answer is the reference word, for all 5 queries
//   P2 with beta = 0 the ranking of the known taught words equals the model's own ranking of those words, and the
//      unknown word's model term equals the lowest known term
//   P3 one taught word is not enough (ready = false); 2 words are; status follows the thresholds (ok >= 0.99,
//      unsure >= 0.84, else reject) on every query
//   P4 self-test: well-separated planted clusters give n correct of n; NEGATIVE CONTROL: the same examples with
//      their labels rotated between words score fewer than n/2 correct
const S = require('../js/personal.js');
const fs = require('fs'), path = require('path');
const fail = [], gates = {};
const check = (g, ok, msg) => { if (!ok) fail.push(`${g}: ${msg}`); gates[g] = gates[g] !== false && !!ok; };
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'personal_fixture.json')));
const model = { words: fx.model_words };
const asEx = x => ({ label: x.label, emb: Float64Array.from(x.emb), p: Float64Array.from(x.p) });
const asQ = q => ({ emb: Float64Array.from(q.emb), p: Float64Array.from(q.p) });

// P1
const P = new S.Personal(); P.fit(model, fx.examples.map(asEx));
let worst = 0, labels = true;
fx.queries.forEach((q, i) => {
  const sc = P.score(asQ(q)), r = P.classify(asQ(q)), ref = fx.reference[i];
  check('P1', JSON.stringify(P.words) === JSON.stringify(fx.words), 'word order');
  sc.forEach((x, j) => { worst = Math.max(worst, Math.abs(x.s - ref.scores[j])); });
  const byWord = new Map(r.top.map(t => [t.word, t.p]));
  fx.words.forEach((w, j) => { worst = Math.max(worst, Math.abs(byWord.get(w) - ref.probs[j])); });
  if (r.label !== ref.label) labels = false;
});
check('P1', worst <= 1e-9 && labels, `worst ${worst} labels ${labels}`);

// P2
const P0 = new S.Personal({ beta: 0 }); P0.fit(model, fx.examples.map(asEx), { test: false });
fx.queries.forEach(q => {
  const a = asQ(q), sc = P0.score(a), known = sc.filter((x, i) => P0.cols[i].length);
  const modelScore = w => Math.max(...P0.cols[P0.words.indexOf(w)].map(k => a.p[k]));
  const byS = known.slice().sort((x, y) => y.s - x.s).map(x => x.word), byP = known.slice().sort((x, y) => modelScore(y.word) - modelScore(x.word)).map(x => x.word);
  check('P2', JSON.stringify(byS) === JSON.stringify(byP), `${byS} vs ${byP}`);
  const unk = sc.find((x, i) => !P0.cols[i].length);
  check('P2', unk && Math.abs(unk.lp - Math.min(...known.map(x => x.lp))) < 1e-12, 'unknown-word term');
});

// P3
const one = new S.Personal(); one.fit(model, fx.examples.filter(e => e.label === 'milk').map(asEx));
const two = new S.Personal(); two.fit(model, fx.examples.filter(e => e.label === 'milk' || e.label === 'dog').map(asEx));
check('P3', !one.ready && two.ready, `one ${one.ready} two ${two.ready}`);
fx.queries.forEach(q => { const r = P.classify(asQ(q)), t = S.TH;
  check('P3', r.status === (r.p >= t.ok ? 'ok' : r.p >= t.unsure ? 'uncertain' : 'reject'), `${r.p} -> ${r.status}`); });

// P4
const st = P.stats;
check('P4', st && st.n === fx.examples.length && st.correct === st.n, JSON.stringify(st && { n: st.n, correct: st.correct }));
const ws = [...new Set(fx.examples.map(e => e.label))];
const rot = fx.examples.map((e, i) => Object.assign({}, e, { label: ws[(ws.indexOf(e.label) + (i % 3)) % ws.length] }));
const Pr = new S.Personal(); Pr.fit(model, rot.map(asEx));
check('P4', Pr.stats && Pr.stats.correct < Pr.stats.n / 2, JSON.stringify(Pr.stats && { n: Pr.stats.n, correct: Pr.stats.correct }));

console.log(JSON.stringify({ worst_diff: worst, self_test: st && [st.correct, st.n], control: Pr.stats && [Pr.stats.correct, Pr.stats.n], gates }, null, 1));
if (fail.length) { console.log('FAILURES:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('all personal gates pass');
