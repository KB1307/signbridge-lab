// Visual "what to sign" demos for the Teach tab.
//  1. Diagram: an animated figure built from a sign's ASL-LEX coding (handshape, location,
//     movement, repetition, contact, one or two hands). ASL-LEX does not code palm direction
//     or which way a path goes, so the diagram shows where and how, not every detail.
//  2. Replay: the hand and body landmarks of a taught example, played back.
// Both are drawn "like a mirror": the signer's dominant hand is on the screen side of the
// viewer's own dominant hand. Geometry is pure and tested in Node (lab/tests/demo.test.js).
(function (root) {
  // ---------------------------------------------------------------- handshape glyphs
  // Finger states, index..pinky: x extended, b bent 90deg at the knuckle, c curved,
  // h hooked (tip curled), f folded into the palm, t tip touching the thumb.
  // Thumb: out (to the side), up (alongside, A), across (over the fingers, S), touch
  // (meets the touching fingers), tuck (hidden), between (T, K/P).
  const G = (f, thumb, spread = false, note = '') => ({ f, thumb, spread, note });
  const GLYPH = {
    '5': G('xxxx', 'out', true, 'open hand, fingers spread (5)'), open_b: G('xxxx', 'out', false, 'flat hand, fingers together, thumb out'), closed_b: G('xxxx', 'tuck', false, 'flat hand, thumb across the palm (letter B)'), B: G('xxxx', 'tuck', false, 'flat hand'),
    flat_b: G('bbbb', 'out', false, 'fingers bent flat at the knuckles'), flatspread_5: G('bbbb', 'out', true, 'spread fingers bent at the knuckles'),
    curved_5: G('cccc', 'out', true, 'claw'), Lax: G('cccc', 'out', true, 'relaxed'), stacked_5: G('xxxx', 'out', true, 'fingers fanned'),
    c: G('cccc', 'out', false, 'like the letter C'), C: G('cccc', 'out', false, 'like the letter C'),
    o: G('tttt', 'touch', false, 'like the letter O'), flat_o: G('tttt', 'touch', false, 'flattened O, fingertips on the thumb'),
    baby_o: G('tfff', 'touch', false, 'index tip on the thumb'),
    '1': G('xfff', 'across', false, 'index finger up'), bent_1: G('bfff', 'across', false, 'index bent at the knuckle'),
    flat_1: G('bfff', 'out', false, 'index bent flat'), curved_1: G('hfff', 'across', false, 'hooked index, like X'),
    a: G('ffff', 'up', false, 'fist, thumb alongside (letter A)'), s: G('ffff', 'across', false, 'fist, thumb across (letter S)'),
    S: G('ffff', 'across', false, 'fist'), t: G('ffff', 'between', false, 'thumb tucked under the index (letter T)'),
    e: G('hhhh', 'tuck', false, 'fingertips curled down (letter E)'), spread_open_e: G('hhhh', 'out', true, 'fingertips curled, spread'),
    flat_m: G('bbbf', 'tuck', false, 'three fingers over the thumb (M)'),
    y: G('fffx', 'out', false, 'thumb and little finger out (letter Y)'), i: G('fffx', 'across', false, 'little finger up (letter I)'),
    ily: G('xffx', 'out', false, 'I-love-you'), horns: G('xffx', 'across', false, 'horns'),
    f: G('txxx', 'touch', true, 'index tip on the thumb, others up (letter F)'), d: G('xttt', 'touch', false, 'index up, others on the thumb (letter D)'),
    open_8: G('xbxx', 'out', true, 'middle finger bent forward'), '8': G('xtxx', 'touch', true, 'middle tip on the thumb'),
    h: G('xxff', 'across', false, 'index and middle together (letter H/U)'), flat_h: G('bbff', 'across', false, 'H bent at the knuckles'),
    open_h: G('xxff', 'out', false, 'index and middle together, thumb out'), curved_h: G('ccff', 'across', false, 'H curved'),
    l: G('xfff', 'out', false, 'thumb and index out (letter L)'), curved_l: G('cfff', 'out', false, 'curved L'),
    bent_l: G('bfff', 'out', false, 'L bent at the knuckle'), g: G('xfff', 'out', false, 'index and thumb parallel (letter G)'),
    v: G('xxff', 'across', true, 'index and middle spread (letter V)'), bent_v: G('hhff', 'across', true, 'bent V'),
    curved_v: G('ccff', 'across', true, 'curved V'), flat_v: G('bbff', 'across', true, 'V bent at the knuckles'),
    r: G('xxff', 'across', false, 'index and middle crossed (letter R)'), '3': G('xxff', 'out', true, 'thumb, index, middle (3)'),
    '4': G('xxxx', 'tuck', true, 'four fingers spread (4)'), flat_4: G('bbbb', 'tuck', true, 'four fingers bent at the knuckles'),
    w: G('xxxt', 'touch', true, 'three fingers spread (letter W)'),
    p: G('xxff', 'between', true, 'like K, pointing down (letter P)'), k: G('xxff', 'between', true, 'letter K'),
  };
  const FALLBACK_GLYPH = G('xxxx', 'out', false, 'flat hand');
  function glyphFor(name) {
    if (!name) return null;
    return GLYPH[name] || null;
  }

  // ---------------------------------------------------------------- body map
  // Unit square, figure facing the viewer, mirror view. d = +1 puts the dominant hand on
  // screen right. Positions are (dx from centre, y); dx is multiplied by d.
  const BODY = { head: [0.5, 0.2, 0.085], chinY: 0.29, neckY: 0.34, shoulderY: 0.41, shoulderDx: 0.24, hipY: 1.0, waistDx: 0.18 };
  const LOCS = {
    Neutral: [0.07, 0.62], HeadTop: [0, 0.105], Forehead: [0.01, 0.15], Eye: [0.035, 0.19], CheekNose: [0.055, 0.225],
    UpperLip: [0, 0.245], Mouth: [0, 0.258], Chin: [0, 0.285], UnderChin: [0, 0.31], HeadAway: [0.14, 0.2], Neck: [0, 0.345],
    Shoulder: [0.17, 0.41], Clavicle: [0.08, 0.42], TorsoTop: [0.02, 0.5], TorsoMid: [0.02, 0.6], TorsoBottom: [0.02, 0.7],
    Waist: [0.06, 0.8], Hips: [0.15, 0.86], BodyAway: [0.3, 0.6], ArmAway: [-0.32, 0.62],
    // on the other arm / hand (dx negative = the non-dominant side)
    UpperArm: [-0.21, 0.5], ElbowFront: [-0.23, 0.62], ElbowBack: [-0.24, 0.63], ForearmFront: [-0.15, 0.68],
    ForearmBack: [-0.15, 0.67], ForearmUlnar: [-0.15, 0.69], WristFront: [-0.08, 0.71], WristBack: [-0.08, 0.7],
    Palm: [-0.03, 0.68], PalmBack: [-0.03, 0.67], FingerFront: [-0.01, 0.63], FingerBack: [-0.01, 0.62],
    FingerTip: [0.0, 0.59], FingerUlnar: [-0.06, 0.63], FingerRadial: [0.02, 0.63], Heel: [-0.04, 0.72], HandAway: [0.03, 0.6],
    Other: [0.07, 0.62],
  };
  const ON_OTHER_ARM = new Set(['UpperArm', 'ElbowFront', 'ElbowBack', 'ForearmFront', 'ForearmBack', 'ForearmUlnar',
    'WristFront', 'WristBack', 'Palm', 'PalmBack', 'FingerFront', 'FingerBack', 'FingerTip', 'FingerUlnar', 'FingerRadial', 'Heel', 'HandAway']);
  const BASE_HAND = [-0.03, 0.66];                 // where the still hand sits for hand locations
  const REST = [0.13, 0.95];                       // dominant hand at rest, low

  const at = (dx, y, d) => [0.5 + dx * d, y];

  // ---------------------------------------------------------------- motion plan
  const AMP = 0.07, CIRC_R = 0.045;
  const SURFACE_PATHS = new Set(['Circular', 'BackAndForth', 'Z-shaped', 'X-shaped', 'Other']);
  function pathPoint(mv, u, T, d) {   // u in [0,1] across one movement; returns [x,y]
    const [tx, ty] = T;
    switch (mv) {
      case 'Straight': return [tx + d * AMP * 0.6 * (1 - u), ty + AMP * 0.5 * (1 - u)];          // ends on the target
      case 'Curved': {                                                                            // arc that ends on the target
        const sx = tx + d * AMP * 1.2, sy = ty + AMP * 0.2;
        return [sx + (tx - sx) * u, sy + (ty - sy) * u - AMP * 0.6 * Math.sin(Math.PI * u)]; }
      case 'Circular': { const a = 2 * Math.PI * u; return [tx + d * CIRC_R * Math.cos(a), ty + CIRC_R * Math.sin(a)]; }
      case 'BackAndForth': return [tx + d * AMP * 0.5 * Math.sin(4 * Math.PI * u), ty];
      case 'Z-shaped': { const k = Math.min(2, Math.floor(u * 3)), v = u * 3 - k;
        const P = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [tx + d * a * AMP * 0.6, ty + b * AMP * 0.45]);
        return [P[k][0] + (P[k + 1][0] - P[k][0]) * v, P[k][1] + (P[k + 1][1] - P[k][1]) * v]; }
      case 'X-shaped': { const s = u < 0.5 ? 1 : -1, v = (u % 0.5) * 2;
        return [tx + d * AMP * 0.5 * (2 * v - 1), ty + s * AMP * 0.5 * (2 * v - 1)]; }
      case 'Other': return [tx + d * 0.015 * Math.sin(6 * Math.PI * u), ty + 0.015 * Math.cos(6 * Math.PI * u)];
      default: return [tx, ty - 0.012 * Math.sin(Math.PI * u)];                                   // None: small hold / tap
    }
  }

  // plan(sign, {handed}) -> everything needed to draw the diagram at any time t (seconds)
  function plan(sign, { handed = 'right' } = {}) {
    if (!sign || !sign.hs) return null;
    const d = handed === 'left' ? -1 : 1;
    const loc = LOCS[sign.loc] ? sign.loc : 'Neutral';
    const target = at(LOCS[loc][0], LOCS[loc][1], d);
    const twoHanded = sign.type && sign.type !== 'OneHanded';
    const symmetric = sign.type === 'SymmetricalOrAlternating' || sign.type === 'SymmetryViolation';
    const needsBase = ON_OTHER_ARM.has(loc) || (twoHanded && !symmetric);
    const reps = sign.rep ? 2 : 1;
    const T = { approach: 0.6, move: 0.85, hold: 0.35, back: 0.55 };
    const cycle = T.approach + T.move * reps + T.hold + T.back;
    let baseShape = null;
    if (needsBase) {
      const nd = sign.type === 'AsymmetricalSameHandshape' ? sign.hs : sign.nd;
      baseShape = glyphFor(nd) ? nd : 'B';
    }
    // symmetric signs centred on the body midline are made with the hands side by side
    const symOffset = symmetric && Math.abs(target[0] - 0.5) < 0.04 ? 0.06 : 0;
    const domTarget = [target[0] + d * symOffset, target[1]];
    return {
      d, loc, target: domTarget, mv: sign.mv || 'None', reps, contact: !!sign.contact, cycle, T,
      dom: { shape: sign.hs, glyph: glyphFor(sign.hs) || FALLBACK_GLYPH },
      second: symmetric ? { shape: sign.hs, glyph: glyphFor(sign.hs) || FALLBACK_GLYPH } : null,
      base: needsBase ? { shape: baseShape, glyph: glyphFor(baseShape) || FALLBACK_GLYPH, pos: at(BASE_HAND[0], BASE_HAND[1], d) } : null,
      rest: at(REST[0], REST[1], d),
      alternating: false,
    };
  }

  const mirrorX = p => [1 - p[0], p[1]];
  function lerp(a, b, u) { const s = u * u * (3 - 2 * u); return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]; }

  // state(p, t) -> { dom:[x,y], second:[x,y]|null, base:[x,y]|null, touching:bool, phase, rep }
  function state(p, t) {
    const T = p.T, tt = ((t % p.cycle) + p.cycle) % p.cycle;
    const start = pathPoint(p.mv, 0, p.target, p.d);
    let pos, phase, rep = 0, u = 0;
    if (tt < T.approach) { pos = lerp(p.rest, start, tt / T.approach); phase = 'approach'; }
    else if (tt < T.approach + T.move * p.reps) {
      const m = tt - T.approach; rep = Math.floor(m / T.move); u = (m % T.move) / T.move;
      pos = pathPoint(p.mv, u, p.target, p.d); phase = 'move';
    } else if (tt < T.approach + T.move * p.reps + T.hold) { pos = pathPoint(p.mv, 1, p.target, p.d); phase = 'hold'; }
    else { const v = (tt - T.approach - T.move * p.reps - T.hold) / T.back; pos = lerp(pathPoint(p.mv, 1, p.target, p.d), p.rest, v); phase = 'back'; }
    // contact flashes when the hand reaches the target at the end of each movement
    // (paths that trace a shape on the body stay in contact while they move)
    const surface = SURFACE_PATHS.has(p.mv);
    const touching = p.contact && (phase === 'hold'
      || (phase === 'move' && (surface || (u > 0.82 && distance(pos, p.target) < 0.02))));
    return { dom: pos, second: p.second ? mirrorX(pos) : null, base: p.base ? p.base.pos : null, touching, phase, rep, u };
  }
  function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // Count distinct contacts in one cycle (sampled), used by the tests and the caption.
  function contactsPerCycle(p, steps = 600) {
    let n = 0, prev = false;
    for (let i = 0; i < steps; i++) {
      const s = state(p, (i / steps) * p.cycle);
      const on = s.touching && s.phase === 'move';
      if (on && !prev) n++;
      prev = on;
    }
    return n;
  }

  // ---------------------------------------------------------------- caption
  const MOVE_WORDS = { Straight: 'move in a straight line', Curved: 'move in an arc', Circular: 'move in a circle',
    BackAndForth: 'move back and forth', 'Z-shaped': 'move in a zigzag', 'X-shaped': 'draw a cross', None: 'hold the position', Other: 'small movement' };
  function caption(sign, p, locWords) {
    if (!p) return '';
    const g = p.dom.glyph, steps = [];
    steps.push(`Hand shape: ${g.note || p.dom.shape}`);
    if (p.base) steps.push(`Hands: two. The other hand stays still: ${p.base.glyph.note || p.base.shape}`);
    else if (p.second) steps.push('Hands: two, both doing the same, mirrored');
    else steps.push('Hands: one, your dominant hand');
    steps.push(`Place: ${locWords || p.loc}`);
    steps.push(`Move: ${MOVE_WORDS[p.mv] || p.mv}${p.reps > 1 ? ', twice' : ''}${p.contact ? ', touching' : ''}`);
    return steps;
  }

  // ---------------------------------------------------------------- drawing (browser only)
  function drawGlyph(ctx, x, y, s, g, thumbDir, col, flip) {
    // palm faces the viewer, fingers up; thumbDir = -1 thumb on screen left, +1 right
    const pw = s * 0.52, ph = s * 0.48, top = y - ph * 0.5, left = x - pw / 2;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = col.fill; ctx.strokeStyle = col.line; ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(left, top, pw, ph, s * 0.12) : ctx.rect(left, top, pw, ph); ctx.fill(); ctx.stroke();
    const order = thumbDir < 0 ? [3, 2, 1, 0] : [0, 1, 2, 3];        // index nearest the thumb
    const gap = g.spread ? pw * 0.42 : pw * 0.27, span = gap * 3, x0 = x - span / 2 * (thumbDir < 0 ? -1 : 1);
    const L = s * 0.5, fw = Math.max(2, s * 0.11);
    ctx.lineWidth = fw;
    for (let k = 0; k < 4; k++) {
      const st = g.f[k], fx = x0 + (thumbDir < 0 ? -1 : 1) * gap * k * (k === 0 ? 1 : 1), fy = top + fw * 0.2;
      const lean = g.spread ? (k - 1.5) * (thumbDir < 0 ? -1 : 1) * 0.18 : 0;
      ctx.beginPath(); ctx.moveTo(fx, fy);
      if (st === 'x') ctx.lineTo(fx + lean * L, fy - L * (k === 3 ? 0.8 : k === 1 ? 1.05 : 0.95));
      else if (st === 'b') { ctx.lineTo(fx, fy - L * 0.18); }
      else if (st === 'c') ctx.quadraticCurveTo(fx + lean * L, fy - L * 0.8, fx - thumbDir * L * 0.28, fy - L * 0.55);
      else if (st === 'h') { ctx.lineTo(fx, fy - L * 0.45); ctx.lineTo(fx, fy - L * 0.25); }
      else if (st === 't') ctx.quadraticCurveTo(fx, fy - L * 0.5, x + thumbDir * pw * 0.55, top + ph * 0.05 - L * 0.15);
      else ctx.lineTo(fx, fy - L * 0.06);                               // folded: a knuckle only
      ctx.stroke();
      if (st === 'b') { ctx.beginPath(); ctx.arc(fx, fy - L * 0.2, fw * 0.75, 0, 7); ctx.fillStyle = col.line; ctx.fill(); ctx.fillStyle = col.fill; }
    }
    // thumb
    const tx = x + thumbDir * pw * 0.5, ty = top + ph * 0.62;
    ctx.beginPath(); ctx.moveTo(tx, ty);
    if (g.thumb === 'out') ctx.lineTo(tx + thumbDir * L * 0.55, ty - L * 0.35);
    else if (g.thumb === 'up') ctx.lineTo(tx + thumbDir * L * 0.06, ty - L * 0.55);
    else if (g.thumb === 'across') ctx.lineTo(x - thumbDir * pw * 0.25, top + ph * 0.25);
    else if (g.thumb === 'touch') ctx.quadraticCurveTo(tx + thumbDir * L * 0.35, ty - L * 0.4, x + thumbDir * pw * 0.55, top + ph * 0.05 - L * 0.15);
    else if (g.thumb === 'between') ctx.lineTo(x + thumbDir * pw * 0.05, top - L * 0.08);
    else ctx.lineTo(tx - thumbDir * pw * 0.12, ty - ph * 0.1);      // tucked
    ctx.stroke();
    ctx.restore();
  }

  function drawFigure(ctx, w, h, col) {
    // one uniform scale: the unit square maps to an S x S box centred horizontally, top-aligned
    const S = Math.min(w, h), X = u => (w - S) / 2 + u * S, Y = v => (h - S) * 0.15 + v * S;
    ctx.save(); ctx.fillStyle = col.body; ctx.strokeStyle = col.bodyLine; ctx.lineWidth = Math.max(1, S / 160);
    ctx.beginPath();     // shoulders and torso
    ctx.moveTo(X(0.5 - BODY.shoulderDx), Y(BODY.shoulderY + 0.03));
    ctx.quadraticCurveTo(X(0.5 - BODY.shoulderDx), Y(BODY.shoulderY - 0.02), X(0.5 - 0.06), Y(BODY.shoulderY - 0.035));
    ctx.lineTo(X(0.5 + 0.06), Y(BODY.shoulderY - 0.035));
    ctx.quadraticCurveTo(X(0.5 + BODY.shoulderDx), Y(BODY.shoulderY - 0.02), X(0.5 + BODY.shoulderDx), Y(BODY.shoulderY + 0.03));
    ctx.lineTo(X(0.5 + BODY.waistDx), Y(BODY.hipY + 0.1)); ctx.lineTo(X(0.5 - BODY.waistDx), Y(BODY.hipY + 0.1)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(X(0.47), Y(BODY.chinY - 0.01), S * 0.06, (BODY.shoulderY - BODY.chinY) * S); ctx.fill();
    ctx.beginPath(); ctx.ellipse(X(BODY.head[0]), Y(BODY.head[1]), S * BODY.head[2], S * BODY.head[2] * 1.22, 0, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col.bodyLine;                                     // face marks: eyes, mouth
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(X(0.5 + sx * 0.032), Y(0.19), Math.max(1.5, S / 120), 0, 7); ctx.fill(); }
    ctx.fillRect(X(0.485), Y(0.257), S * 0.03, Math.max(1, h / 220));
    ctx.restore();
    return { X, Y, S };
  }

  // shoulder -> elbow -> wrist; the elbow hangs low and out to the side, the wrist sits under the hand
  function drawArm(ctx, from, hand, F, col, width, handS) {
    const side = Math.sign(from[0] - 0.5) || 1;
    const wrist = [hand[0], hand[1] + (handS * 0.42) / F.S];
    const elbow = [from[0] + side * 0.05, Math.max(wrist[1] + 0.16, from[1] + 0.2)];
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(F.X(from[0]), F.Y(from[1])); ctx.lineTo(F.X(elbow[0]), F.Y(elbow[1])); ctx.lineTo(F.X(wrist[0]), F.Y(wrist[1])); ctx.stroke();
    ctx.restore();
  }

  function drawDiagram(ctx, w, h, p, t, col) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    const F = drawFigure(ctx, w, h, col), st = state(p, t), d = p.d;
    const shoulder = s => [0.5 + s * BODY.shoulderDx * 0.92, BODY.shoulderY + 0.01];
    const armW = Math.max(3, F.S / 28), handS = F.S * 0.15;
    // path trace
    ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = col.path; ctx.lineWidth = Math.max(1.5, F.S / 140);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) { const q = pathPoint(p.mv, i / 48, p.target, d); i ? ctx.lineTo(F.X(q[0]), F.Y(q[1])) : ctx.moveTo(F.X(q[0]), F.Y(q[1])); }
    ctx.stroke(); ctx.restore();
    // target
    ctx.save(); ctx.strokeStyle = col.target; ctx.lineWidth = Math.max(1.5, F.S / 120);
    ctx.beginPath(); ctx.arc(F.X(p.target[0]), F.Y(p.target[1]), F.S * 0.028, 0, 7); ctx.stroke(); ctx.restore();
    if (st.base) { drawArm(ctx, shoulder(-d), st.base, F, col.base, armW, handS); drawGlyph(ctx, F.X(st.base[0]), F.Y(st.base[1]), handS, p.base.glyph, d, { fill: col.baseFill, line: col.base }); }
    if (st.second) { drawArm(ctx, shoulder(-d), st.second, F, col.hand2, armW, handS); drawGlyph(ctx, F.X(st.second[0]), F.Y(st.second[1]), handS, p.second.glyph, d, { fill: col.hand2Fill, line: col.hand2 }); }
    drawArm(ctx, shoulder(d), st.dom, F, col.hand, armW, handS);
    drawGlyph(ctx, F.X(st.dom[0]), F.Y(st.dom[1]), handS, p.dom.glyph, -d, { fill: col.handFill, line: col.hand });
    if (st.touching) {
      ctx.save(); ctx.strokeStyle = col.contact; ctx.lineWidth = Math.max(2, F.S / 90);
      ctx.beginPath(); ctx.arc(F.X(p.target[0]), F.Y(p.target[1]), F.S * 0.05, 0, 7); ctx.stroke(); ctx.restore();
    }
    if (p.reps > 1 && st.phase === 'move') {
      ctx.save(); ctx.fillStyle = col.text; ctx.font = `700 ${Math.round(F.S / 14)}px system-ui, sans-serif`;
      ctx.fillText(`${st.rep + 1}×`, 8, h - 10); ctx.restore();
    }
  }

  // Replay of a taught example: raw MediaPipe frames (Float32Array, 1629 per frame).
  const POSE_ARMS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24]];
  const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176,
    149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
  const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];
  const FACE_DOTS = [...FACE_OVAL, ...LIPS, 33, 133, 159, 145, 263, 362, 386, 374, 70, 63, 105, 66, 107, 300, 293, 334, 296, 336, 1, 2, 98, 327];
  function frameBox(raw, nFrames, W = 1629) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let f = 0; f < nFrames; f++) {
      const o = f * W;
      for (const i of [...FACE_OVAL, 489 + 11, 489 + 12, 489 + 13, 489 + 14, 489 + 15, 489 + 16, 489 + 23, 489 + 24]) {
        const x = raw[o + i * 3], y = raw[o + i * 3 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      for (const off of [468, 522]) for (let j = 0; j < 21; j++) {
        const x = raw[o + (off + j) * 3], y = raw[o + (off + j) * 3 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
    }
    return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
  }
  function drawReplay(ctx, w, h, ex, frame, col) {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = col.bg; ctx.fillRect(0, 0, w, h);
    const W = 1629, n = ex.raw.length / W;
    if (!ex.box) ex.box = frameBox(ex.raw, n);
    const b = ex.box; if (!b) return;
    const a = ex.aspect || 4 / 3, bw = (b.x1 - b.x0) * a, bh = b.y1 - b.y0;
    const sc = Math.min((w * 0.9) / Math.max(bw, 1e-3), (h * 0.92) / Math.max(bh, 1e-3));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const o = Math.min(n - 1, Math.max(0, frame)) * W;
    // mirror view: flip x
    const P = i => [w / 2 - (ex.raw[o + i * 3] - cx) * a * sc, h / 2 + (ex.raw[o + i * 3 + 1] - cy) * sc];
    const ok = i => Number.isFinite(ex.raw[o + i * 3]) && Number.isFinite(ex.raw[o + i * 3 + 1]);
    const line = (pts, colr, lw) => { ctx.strokeStyle = colr; ctx.lineWidth = lw; ctx.beginPath(); let started = false;
      for (const i of pts) { if (!ok(i)) { started = false; continue; } const [x, y] = P(i); started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true; } ctx.stroke(); };
    const lw = Math.max(2, Math.min(w, h) / 90);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = col.bodyLine;                                   // face as dots: robust to partial meshes
    for (const i of FACE_DOTS) if (ok(i)) { const [x, y] = P(i); ctx.fillRect(x - lw * 0.4, y - lw * 0.4, lw * 0.8, lw * 0.8); }
    for (const [p1, p2] of POSE_ARMS) line([489 + p1, 489 + p2], col.bodyLine, lw * 1.4);
    [[522, col.hand], [468, col.hand2]].forEach(([off, c]) => {
      if (!ok(off)) return;
      for (const [p1, p2] of HAND_LINKS) line([off + p1, off + p2], c, lw);
      ctx.fillStyle = c;
      for (let j = 0; j < 21; j++) if (ok(off + j)) { const [x, y] = P(off + j); ctx.beginPath(); ctx.arc(x, y, lw * 0.9, 0, 7); ctx.fill(); }
    });
  }

  // ---------------------------------------------------------------- player
  class Player {
    constructor(canvases, colours) { this.canvases = canvases; this.colours = colours; this.mode = null; this.t0 = 0; this.raf = 0; }
    showDiagram(p) { this.mode = p ? 'diagram' : null; this.plan = p; this.ex = null; this.restart(); }
    showReplay(ex) { this.mode = ex ? 'replay' : null; this.ex = ex; this.plan = null; this.restart(); }
    clear() { this.mode = null; this.restart(); }
    restart() { this.t0 = (typeof performance !== 'undefined' ? performance.now() : 0); if (!this.raf && typeof requestAnimationFrame !== 'undefined') this.raf = requestAnimationFrame(ts => this.tick(ts)); }
    frameAt(t) {   // replay frame index at time t, with a short pause at the end
      const n = this.ex.raw.length / 1629, fps = this.ex.fps || 15, dur = n / fps + 0.8;
      return Math.min(n - 1, Math.floor(((t % dur)) * fps));
    }
    tick(ts) {
      this.raf = 0;
      if (!this.mode) { for (const c of this.canvases()) { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); } return; }
      const t = (ts - this.t0) / 1000, col = this.colours();
      let drawn = 0;
      for (const c of this.canvases()) {
        if (!c.offsetParent) continue;                                  // hidden: skip
        const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const g = c.getContext('2d');
        if (this.mode === 'diagram') drawDiagram(g, w, h, this.plan, t, col);
        else drawReplay(g, w, h, this.ex, this.frameAt(t), col);
        drawn++;
      }
      this.lastDrawn = drawn;
      if (!document.hidden) this.raf = requestAnimationFrame(x => this.tick(x));
      else document.addEventListener('visibilitychange', () => this.restart(), { once: true });
    }
  }

  const api = { GLYPH, FALLBACK_GLYPH, glyphFor, LOCS, ON_OTHER_ARM, BODY, plan, state, pathPoint, contactsPerCycle, caption,
    frameBox, drawDiagram, drawReplay, Player, AMP, CIRC_R };
  root.SBDemo = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
