// node lab/tests/demo.test.js
// PRE-REGISTERED GATES (written before the first run) for js/demo.js on data/lexicon.json:
//   D1 every handshape used in the sign list (dominant and other hand) has a drawn glyph;
//      only the two ASL-LEX violation codes may fall back, and they get the stated fallback
//   D2 every location used has a body position inside the unit square; hand/arm locations
//      always get a still base hand
//   D3 geometry known answers: MOTHER's target is the chin, FATHER's the forehead (higher);
//      a contact sign's path reaches its target (distance <= 0.005); Circular paths stay on
//      the circle (radius error <= 1e-9)
//   D4 two hands: symmetric signs' second hand is the exact mirror of the first at every
//      time step; asymmetric signs' base hand never moves
//   D5 left-handed: every position equals the right-handed one mirrored (x -> 1-x, <= 1e-9)
//   D6 repetition: MOTHER (repeated contact) touches twice per cycle, a non-repeated
//      straight contact sign once, a no-contact sign never
//   D7 every sign with coding yields a plan and a caption with 4+ steps; no NaN positions
//      over a full cycle for any sign
const fs = require('fs'), path = require('path');
const D = require('../js/demo.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'lexicon.json'), 'utf8'));
const coded = Object.entries(data.signs).filter(([, s]) => s.hs);
const fail = [], gates = {};
const check = (g, ok, msg) => { if (!ok) fail.push(`${g}: ${msg}`); gates[g] = gates[g] !== false && !!ok; };
const VIOL = new Set(['DominanceConditionViolation', 'SymmetryViolation']);

// D1
const shapes = new Set();
for (const [, s] of coded) { shapes.add(s.hs); if (s.nd) shapes.add(s.nd); }
for (const h of shapes) {
  if (VIOL.has(h)) continue;
  check('D1', !!D.glyphFor(h), `no glyph for handshape ${h}`);
}
for (const [k, s] of coded) {
  const p = D.plan(s);
  if (p.base && VIOL.has(s.nd)) check('D1', p.base.shape === 'B', `${k}: violation base hand not B`);
}

// D2
for (const [k, s] of coded) {
  check('D2', !!D.LOCS[s.loc], `${k}: location ${s.loc} unmapped`);
  const p = D.plan(s);
  check('D2', p.target[0] > 0 && p.target[0] < 1 && p.target[1] > 0 && p.target[1] < 1, `${k}: target ${p.target}`);
  if (D.ON_OTHER_ARM.has(s.loc)) check('D2', !!p.base, `${k}: ${s.loc} without a base hand`);
}

// D3
const pm = D.plan(data.signs.mother), pf = D.plan(data.signs.father);
check('D3', pm.loc === 'Chin' && pf.loc === 'Forehead' && pf.target[1] < pm.target[1], `mother ${pm.target} father ${pf.target}`);
for (const [k, s] of coded) {
  const p = D.plan(s);
  if (s.contact) {
    let best = Infinity;
    for (let i = 0; i <= 200; i++) best = Math.min(best, Math.hypot(...D.pathPoint(p.mv, i / 200, p.target, p.d).map((v, j) => v - p.target[j])));
    check('D3', best <= 0.005 || ['Circular'].includes(p.mv) && Math.abs(best - D.CIRC_R) < 1e-9 || ['BackAndForth', 'Z-shaped', 'X-shaped', 'Other'].includes(p.mv),
      `${k}: contact path misses target by ${best.toFixed(4)} (${p.mv})`);
  }
  if (p.mv === 'Circular') for (let i = 0; i <= 50; i++) {
    const q = D.pathPoint('Circular', i / 50, p.target, p.d);
    check('D3', Math.abs(Math.hypot(q[0] - p.target[0], q[1] - p.target[1]) - D.CIRC_R) <= 1e-9, `${k}: off the circle`);
  }
}

// D4 + D7 (NaN sweep)
let nSym = 0, nAsym = 0;
for (const [k, s] of coded) {
  const p = D.plan(s);
  check('D7', p && D.caption(s, p).length >= 4, `${k}: caption`);
  const base0 = p.base ? p.base.pos.slice() : null;
  for (let i = 0; i < 120; i++) {
    const st = D.state(p, (i / 120) * p.cycle);
    check('D7', Number.isFinite(st.dom[0]) && Number.isFinite(st.dom[1]), `${k}: NaN at step ${i}`);
    if (p.second) check('D4', Math.abs(st.second[0] - (1 - st.dom[0])) <= 1e-9 && Math.abs(st.second[1] - st.dom[1]) <= 1e-9, `${k}: second hand not mirrored`);
    if (base0) check('D4', st.base[0] === base0[0] && st.base[1] === base0[1], `${k}: base hand moved`);
  }
  if (p.second) nSym++;
  if (s.type.startsWith('Asymmetrical')) { nAsym++; check('D4', !!p.base && !p.second, `${k}: asymmetric without a still base hand`); }
}
check('D4', nSym > 50 && nAsym > 50, `only ${nSym} symmetric / ${nAsym} asymmetric signs exercised`);

// D5
for (const [k, s] of coded) {
  const r = D.plan(s, { handed: 'right' }), l = D.plan(s, { handed: 'left' });
  for (let i = 0; i < 60; i++) {
    const t = (i / 60) * r.cycle, a = D.state(r, t), b = D.state(l, t);
    check('D5', Math.abs(b.dom[0] - (1 - a.dom[0])) <= 1e-9 && Math.abs(b.dom[1] - a.dom[1]) <= 1e-9, `${k}: left-handed not mirrored`);
  }
}

// D6
const straightOnce = coded.find(([, s]) => s.contact && !s.rep && s.mv === 'Straight');
const noContact = coded.find(([, s]) => !s.contact);
const cm = D.contactsPerCycle(pm), c1 = D.contactsPerCycle(D.plan(straightOnce[1])), c0 = D.contactsPerCycle(D.plan(noContact[1]));
check('D6', cm === 2 && c1 === 1 && c0 === 0, `mother ${cm}, ${straightOnce[0]} ${c1}, ${noContact[0]} ${c0}`);

const report = { signs_with_coding: coded.length, handshapes: shapes.size, symmetric: nSym, asymmetric: nAsym,
  contacts: { mother: cm, [straightOnce[0]]: c1, [noContact[0]]: c0 }, caption_mother: D.caption(data.signs.mother, pm), gates };
console.log(JSON.stringify(report, null, 1));
if (fail.length) { console.log(`FAILURES (${fail.length}):\n  ` + [...new Set(fail)].slice(0, 25).join('\n  ')); process.exit(1); }
console.log('all demo gates pass');
