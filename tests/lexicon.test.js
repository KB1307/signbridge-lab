// node lab/tests/lexicon.test.js
// PRE-REGISTERED GATES (written before the first run) for lab/data/lexicon.json + js/lexicon.js:
//   L1 public-safety: no book-derived, Kezar, MS-ASL, OpenASL or SignWriting fields anywhere;
//      the ASL-LEX CC BY-NC attribution is present
//   L2 every pair names two signs that exist and differ in EXACTLY its named parameter
//   L3 known answers: mother/father = location, bird/duck = handshape; describe(mother)
//      says 5 handshape, chin, repeated, touches, one hand
//   L4 sets: starter has 50 keys, islr 250, wlasl100 100; every key is a sign in the file
//   L5 helpers: confusables lists taught partners first; taughtPairs finds exactly the
//      taught pairs; unknown words return null; file <= 300 KB
const fs = require('fs'), path = require('path');
const X = require('../js/lexicon.js');
const file = path.join(__dirname, '..', 'data', 'lexicon.json');
const raw = fs.readFileSync(file, 'utf8'), data = JSON.parse(raw), lex = X.index(data);
const FIELD = { handshape: 'hs', location: 'loc', movement: 'mv', repetition: 'rep', contact: 'contact', sign_type: 'type', nondominant_handshape: 'nd' };
const gates = {};
const fail = [];
const check = (g, ok, msg) => { if (!ok) fail.push(`${g}: ${msg}`); gates[g] = gates[g] !== false && ok; };

// L1
const banned = /book|dk_|hurry|kezar|msasl|openasl|signwriting|fsw|signpuddle/i;
// Field names are checked everywhere except the keys of `signs`, which are sign words
// (BOOK and HURRY are real signs, not fields).
const walk = (o, at) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!Array.isArray(o) && at !== '$.signs') check('L1', !banned.test(k), `banned key ${at}.${k}`); walk(v, `${at}.${k}`); } };
walk(data, '$');
check('L1', /ASL-LEX 2\.0/.test(data.about) && /CC BY-NC 4\.0/.test(data.about), 'attribution missing');

// L2
let nPairs = 0;
for (const [a, b, p] of data.pairs) {
  nPairs++;
  const A = data.signs[a], B = data.signs[b];
  check('L2', A && B && A.hs && B.hs, `pair ${a}/${b} missing sign`);
  if (!(A && B)) continue;
  const diff = Object.entries(FIELD).filter(([, f]) => A[f] !== B[f]).map(([n]) => n);
  check('L2', diff.length === 1 && diff[0] === p, `${a}/${b} named ${p}, differs in ${diff}`);
}
check('L2', nPairs > 100, `only ${nPairs} pairs`);

// L3
const has = (a, b, p) => data.pairs.some(([x, y, q]) => q === p && ((x === a && y === b) || (x === b && y === a)));
check('L3', has('mother', 'father', 'location'), 'mother/father location pair missing');
check('L3', has('bird', 'duck', 'handshape'), 'bird/duck handshape pair missing');
const dm = X.describe(data.signs.mother);
check('L3', /^5 handshape/.test(dm) && /chin/.test(dm) && /repeated/.test(dm) && /touches/.test(dm) && /one hand/.test(dm), `describe(mother) = ${dm}`);

// L4
const sz = { starter: 50, islr: 250, wlasl100: 100 };
for (const [k, n] of Object.entries(sz)) {
  check('L4', data.sets[k] && data.sets[k].keys.length === n, `${k} has ${data.sets[k] && data.sets[k].keys.length}`);
  for (const key of (data.sets[k] || { keys: [] }).keys) check('L4', !!data.signs[key], `${k}: ${key} not a sign`);
}

// L5
const conf = X.confusables(lex, 'mother', new Set(['father']));
check('L5', conf.length > 0 && conf[0].key === 'father' && conf[0].taught && conf[0].param === 'location', `confusables(mother) = ${JSON.stringify(conf[0])}`);
const tp = X.taughtPairs(lex, new Set(['mother', 'father', 'hello']));
check('L5', tp.length === 1 && tp[0].param === 'location', `taughtPairs = ${JSON.stringify(tp)}`);
check('L5', X.lookup(lex, 'zzqx') === null && X.lookup(lex, '  Mother ') && X.lookup(lex, '  Mother ').key === 'mother', 'lookup normalisation');
check('L5', Buffer.byteLength(raw) <= 300 * 1024, `file ${Buffer.byteLength(raw)} bytes`);

const report = { signs: Object.keys(data.signs).length, with_phonology: Object.values(data.signs).filter(s => s.hs).length, pairs: nPairs, describe_mother: dm, gates };
console.log(JSON.stringify(report, null, 1));
if (fail.length) { console.log('FAILURES:\n  ' + fail.slice(0, 20).join('\n  ')); process.exit(1); }
console.log('all lexicon gates pass');
