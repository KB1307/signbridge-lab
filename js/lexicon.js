// Sign list helpers for the Teach tab: look a word up in lab/data/lexicon.json, describe
// its ASL-LEX coding in plain words, and list the signs it is easily confused with
// (minimal pairs: same in every coded part except one). Pure functions, tested in Node.
(function (root) {
  const LOC = {
    Neutral: 'in front of the body', HeadTop: 'top of the head', Forehead: 'at the forehead',
    Eye: 'by the eye', CheekNose: 'at the cheek or nose', UpperLip: 'at the upper lip', Mouth: 'at the mouth',
    Chin: 'at the chin', UnderChin: 'under the chin', HeadAway: 'beside the head', Neck: 'at the neck',
    Shoulder: 'at the shoulder', Clavicle: 'at the collarbone', TorsoTop: 'at the upper chest',
    TorsoMid: 'at the middle of the chest', TorsoBottom: 'at the stomach', Waist: 'at the waist', Hips: 'at the hips',
    BodyAway: 'away from the body', UpperArm: 'on the upper arm', ElbowFront: 'at the elbow',
    ElbowBack: 'at the back of the elbow', ForearmFront: 'on the forearm', ForearmBack: 'on the back of the forearm',
    ForearmUlnar: 'on the edge of the forearm', WristFront: 'at the inside of the wrist', WristBack: 'at the back of the wrist',
    Palm: 'on the other palm', PalmBack: 'on the back of the other hand', FingerFront: 'on the other fingers',
    FingerBack: 'on the back of the other fingers', FingerTip: 'at the other fingertips', FingerUlnar: 'on the edge of the other fingers',
    FingerRadial: 'on the thumb side of the other fingers', Heel: 'on the heel of the other hand',
    HandAway: 'near the other hand', ArmAway: 'near the other arm', Other: 'elsewhere',
  };
  const MOVE = {
    Straight: 'moves in a straight line', Curved: 'moves in an arc', Circular: 'moves in a circle',
    BackAndForth: 'moves back and forth', 'Z-shaped': 'moves in a zigzag', 'X-shaped': 'moves in a cross',
    None: 'no path movement', Other: 'other movement',
  };
  const TYPE = {
    OneHanded: 'one hand', SymmetricalOrAlternating: 'two hands moving together or alternately',
    AsymmetricalSameHandshape: 'two hands, same shape, one still',
    AsymmetricalDifferentHandshape: 'two hands, the other hand a still base',
    DominanceViolation: 'two hands (irregular)', SymmetryViolation: 'two hands (irregular)',
  };
  const PARAM = {
    handshape: 'handshape', location: 'location', movement: 'movement', repetition: 'repetition',
    contact: 'contact with the body', sign_type: 'number of hands', nondominant_handshape: 'other hand’s shape',
  };

  function norm(w) { return String(w || '').trim().toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' '); }

  function handshapeName(hs) {
    if (!hs) return '';
    if (hs === '1') return '1 (index finger)';
    if (hs === 'ily') return 'I-love-you';
    return hs.split('_').map(p => (p.length === 1 ? p.toUpperCase() : p)).join(' ');
  }

  function index(data) {
    const conf = new Map();
    for (const [a, b, p] of data.pairs) {
      if (!conf.has(a)) conf.set(a, []);
      if (!conf.has(b)) conf.set(b, []);
      conf.get(a).push({ key: b, param: p });
      conf.get(b).push({ key: a, param: p });
    }
    return { data, conf };
  }

  function lookup(lex, word) {
    const k = norm(word);
    return lex && lex.data.signs[k] ? { key: k, sign: lex.data.signs[k] } : null;
  }

  function describe(sign) {
    if (!sign || !sign.hs) return null;
    const parts = [`${handshapeName(sign.hs)} handshape`, LOC[sign.loc] || sign.loc, MOVE[sign.mv] || sign.mv];
    if (sign.rep) parts.push('repeated');
    parts.push(sign.contact ? 'touches' : 'no contact');
    parts.push(TYPE[sign.type] || sign.type);
    if (sign.nd) parts.push(`other hand: ${handshapeName(sign.nd)}`);
    if (sign.seg > 1) parts.push(`${sign.seg} parts`);
    return parts.join(' · ');
  }

  function frequencyWord(f) {
    if (f == null) return '';
    return f >= 6 ? 'very common' : f >= 5 ? 'common' : f >= 4 ? 'fairly common' : 'less common';
  }

  // Confusable signs for `key`, those in `taught` first, then by frequency.
  function confusables(lex, key, taught = new Set(), limit = 6) {
    const list = (lex && lex.conf.get(norm(key))) || [];
    const f = k => (lex.data.signs[k] && lex.data.signs[k].f) || 0;
    return list
      .map(c => ({ key: c.key, param: c.param, why: PARAM[c.param] || c.param, taught: taught.has(c.key) }))
      .sort((a, b) => (b.taught - a.taught) || (f(b.key) - f(a.key)))
      .slice(0, limit);
  }

  // Pairs among the taught words: these are the mix-ups to expect.
  function taughtPairs(lex, taught) {
    if (!lex) return [];
    return lex.data.pairs.filter(([a, b]) => taught.has(a) && taught.has(b))
      .map(([a, b, p]) => ({ a, b, param: p, why: PARAM[p] || p }));
  }

  const api = { norm, index, lookup, describe, confusables, taughtPairs, handshapeName, frequencyWord, LOC, MOVE, TYPE, PARAM };
  root.SBLexicon = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
