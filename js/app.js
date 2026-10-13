// SignBridge Lab - page logic. Pipeline maths lives in features.js / recognizer.js /
// pipeline.js (tested in Node); this file wires camera, MediaPipe, storage and UI.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const L = window.SBLayout, F = window.SBFeatures, R = window.SBRecognizer, P = window.SBPipeline, X = window.SBLexicon, DM = window.SBDemo, SM = window.SBSignModel;
  const D = F.D, W = L.N_RAW * 3;

  // ------------------------------------------------------------ settings (per-viewer convenience)
  const DEFAULTS = { restY: 1.0, sens: 1.25, handed: 'auto', speak: 'sentence', fast: '1', signer: '', facing: 'user', sugSet: 'starter' };
  const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('sb-lab-settings') || '{}'); } catch { return {}; } })());
  const saveSettings = () => { try { localStorage.setItem('sb-lab-settings', JSON.stringify(settings)); } catch {} };

  // ------------------------------------------------------------ storage (IndexedDB, memory fallback)
  const store = (() => {
    let db = null; const mem = new Map();
    const open = () => new Promise(res => {
      try {
        const r = indexedDB.open('signbridge-lab', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('examples', { keyPath: 'id' });
        r.onsuccess = () => { db = r.result; res(); };
        r.onerror = () => res();
      } catch { res(); }
    });
    const tx = (mode, fn) => new Promise((res, rej) => {
      const t = db.transaction('examples', mode), s = t.objectStore('examples'), out = fn(s);
      t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error);
    });
    return {
      ready: open(),
      async all() { await this.ready; return db ? (await tx('readonly', s => s.getAll())) || [] : [...mem.values()]; },
      async put(e) { await this.ready; if (db) await tx('readwrite', s => s.put(e)); else mem.set(e.id, e); },
      async del(id) { await this.ready; if (db) await tx('readwrite', s => s.delete(id)); else mem.delete(id); },
      async clear() { await this.ready; if (db) await tx('readwrite', s => s.clear()); else mem.clear(); },
      get persistent() { return !!db; },
    };
  })();

  // ------------------------------------------------------------ model file storage (this browser only)
  const modelStore = (() => {
    const open = () => new Promise(res => {
      try {
        const r = indexedDB.open('signbridge-models', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch { res(null); }
    });
    const db = open();
    const op = async (mode, fn) => { const d = await db; if (!d) return null;
      return new Promise((res, rej) => { const t = d.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
    return { get: () => op('readonly', s => s.get('current')), put: v => op('readwrite', s => s.put(v, 'current')), clear: () => op('readwrite', s => s.delete('current')) };
  })();

  // ------------------------------------------------------------ state
  const S = {
    holistic: null, ready: false, running: false, source: null, stream: null,
    video: document.createElement('video'), aspect: 4 / 3, lastRes: null,
    pipe: null, model: new R.FewShot({ tauSlack: settings.sens }), examples: [],
    times: { lm: [], pipe: [] }, frameTimes: [], presence: [], light: null,
    teach: null, words: [], lastWordAt: 0, past: [], videoJob: null, videoFrames: null, lex: null, lastStats: null, signModel: null,
  };
  S.video.playsInline = true; S.video.muted = true;
  const canvas = $('#view'), ctx = canvas.getContext('2d');

  function toast(msg, ms = 3200) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms);
  }
  const push = (arr, v, n = 120) => { arr.push(v); if (arr.length > n) arr.shift(); };
  // Wall clock, replaceable by the test hook so timed steps (rest pauses, sentence ends) can be simulated.
  const clock = () => (S.fakeNow !== undefined ? S.fakeNow : performance.now());
  const pct = (v, q) => R.quantile(v, q);

  // ------------------------------------------------------------ MediaPipe -> 543-point raw frame
  function toRaw(res, aspect) {
    const raw = new Float32Array(W).fill(NaN);
    const put = (lms, off, n) => { for (let i = 0; i < n; i++) { const p = lms[i], k = (off + i) * 3; raw[k] = p.x; raw[k + 1] = p.y; raw[k + 2] = p.z; } };
    if (res.poseLandmarks) put(res.poseLandmarks, L.OFF.pose, 33);
    if (res.faceLandmarks) put(res.faceLandmarks, L.OFF.face, 468);
    const hands = [res.leftHandLandmarks, res.rightHandLandmarks]
      .map((h, i) => (h ? { h, slot: i ? L.OFF.rhand : L.OFF.lhand } : null)).filter(Boolean);
    const pw = res.poseLandmarks, lw = pw && pw[15], rw = pw && pw[16];
    if (lw && rw && hands.length) {    // assign hands to the nearest pose wrist (signer's left = 15)
      const d = (h, w) => Math.hypot((h[0].x - w.x) * aspect, h[0].y - w.y);
      if (hands.length === 2) {
        const [a, b] = hands, keep = d(a.h, lw) + d(b.h, rw) <= d(a.h, rw) + d(b.h, lw);
        a.slot = keep ? L.OFF.lhand : L.OFF.rhand; b.slot = keep ? L.OFF.rhand : L.OFF.lhand;
      } else hands[0].slot = d(hands[0].h, lw) < d(hands[0].h, rw) ? L.OFF.lhand : L.OFF.rhand;
    }
    for (const { h, slot } of hands) put(h, slot, 21);
    return raw;
  }

  async function initHolistic() {
    const h = new window.Holistic({ locateFile: f => `vendor/holistic/${f}` });
    h.setOptions({ modelComplexity: Number(settings.fast), smoothLandmarks: true, enableSegmentation: false,
                   refineFaceLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false });
    h.onResults(r => { S.lastRes = r; });
    await h.initialize();
    S.holistic = h; S.ready = true;
  }
  async function detect(image) {
    const t0 = performance.now();
    S.lastRes = null;
    await S.holistic.send({ image });
    push(S.times.lm, performance.now() - t0);
    return S.lastRes;
  }

  // ------------------------------------------------------------ drawing
  const HAND = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
  const ARMS = [[11,12],[11,13],[13,15],[12,14],[14,16]];
  const FACE_PTS = L.SEL_RAW.filter(i => i < 468);
  let colours = null;
  const css = n => { if (!colours) { const cs = getComputedStyle(document.documentElement); colours = {}; for (const k of ['--body', '--face', '--hand', '--hand2']) colours[k] = cs.getPropertyValue(k).trim(); } return colours[n]; };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { colours = null; }); } catch {}
  function draw(image, raw, w, h) {
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(image, 0, 0, w, h);
    ctx.fillStyle = 'rgba(6,20,22,.25)'; ctx.fillRect(0, 0, w, h);
    const pt = i => [raw[i * 3] * w, raw[i * 3 + 1] * h], ok = i => Number.isFinite(raw[i * 3]);
    const lw = Math.max(2, w / 260);
    ctx.lineWidth = lw; ctx.strokeStyle = css('--body');
    for (const [a, b] of ARMS) { const i = L.OFF.pose + a, j = L.OFF.pose + b; if (ok(i) && ok(j)) { ctx.beginPath(); ctx.moveTo(...pt(i)); ctx.lineTo(...pt(j)); ctx.stroke(); } }
    ctx.fillStyle = css('--face');
    for (const i of FACE_PTS) if (ok(i)) { const [x, y] = pt(i); ctx.fillRect(x - 1, y - 1, 2, 2); }
    [[L.OFF.rhand, css('--hand')], [L.OFF.lhand, css('--hand2')]].forEach(([off, col]) => {
      if (!ok(off)) return;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      for (const [a, b] of HAND) { ctx.beginPath(); ctx.moveTo(...pt(off + a)); ctx.lineTo(...pt(off + b)); ctx.stroke(); }
      for (let j = 0; j < 21; j++) { const [x, y] = pt(off + j); ctx.beginPath(); ctx.arc(x, y, lw * 1.2, 0, 7); ctx.fill(); }
    });
    const ref = S.pipe && S.pipe.stream.ref;      // rest line in image space (y is not aspect-scaled)
    if (ref && Number.isFinite(ref.cy)) {
      const y = (ref.cy + settings.restY * ref.scale) * h;
      ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function measureLight(image, w, h) {
    try {
      const c = measureLight.c || (measureLight.c = document.createElement('canvas'));
      c.width = 32; c.height = 24;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(image, 0, 0, w, h, 0, 0, 32, 24);
      const d = g.getImageData(0, 0, 32, 24).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      S.light = s / (d.length / 4);
    } catch { S.light = null; }
  }

  // ------------------------------------------------------------ framing chips
  function updateChips(raw) {
    const has = off => Number.isFinite(raw[off * 3]);
    push(S.presence, [has(L.OFF.face + 1), has(L.OFF.pose + 11) && has(L.OFF.pose + 12), has(L.OFF.lhand), has(L.OFF.rhand)], 30);
    const frac = k => S.presence.reduce((a, p) => a + p[k], 0) / S.presence.length;
    const chips = [
      ['Face', frac(0) > 0.8], ['Shoulders', frac(1) > 0.8],
      ['Signer’s right hand', frac(3) > 0.3, true], ['Signer’s left hand', frac(2) > 0.3, true],
    ];
    const fps = fpsNow();
    let html = chips.map(([n, good, opt]) => `<span class="chip ${good ? 'good' : opt ? '' : 'warn'}">${good ? '✓' : opt ? '–' : '!'} ${n}</span>`).join('');
    if (S.light !== null && S.light < 55) html += '<span class="chip warn">! Low light</span>';
    const slow = fps > 0 && fps < 8;
    html += `<span class="chip ${slow ? 'warn' : ''}">${fps ? fps.toFixed(fps < 10 ? 1 : 0) : '–'} fps${slow ? ' · slow device' : ''}</span>`;
    $('#chips').innerHTML = html;
  }
  function fpsNow() {
    const t = S.frameTimes; if (t.length < 5) return 0;
    return (t.length - 1) / ((t[t.length - 1] - t[0]) / 1000);
  }

  // ------------------------------------------------------------ per-frame processing
  function newPipe() {
    S.pipe = new P.LabPipeline({ aspect: S.aspect, restY: settings.restY, handedness: settings.handed });
  }
  function process(raw) {
    const t0 = performance.now();
    const out = S.pipe.push(raw);
    push(S.times.pipe, performance.now() - t0);
    push(S.frameTimes, clock(), 60);
    const flag = $('#sigflag'); flag.hidden = false;
    flag.textContent = out.state === 'active' ? 'Signing' : 'Resting'; flag.classList.toggle('on', out.state === 'active');
    if (S.teach) teachStep(out);
    else if (out.closed && S.source === 'camera') onSegment(out.closed, null);
    if (S.source === 'camera') maybeEndSentence(out.state);
    return out;
  }

  // ------------------------------------------------------------ captions
  // Taught signs win when they match confidently; otherwise the loaded model answers.
  function recognise(seg, fps) {
    const taught = S.model.ready ? S.model.spot(seg.frames) : [];
    if (taught.some(r => r.status === 'ok') || !S.signModel) return taught;
    let m = null;
    try { m = S.signModel.classifySegment(seg, { fps: fps || 15, aspect: S.aspect }); } catch (e) { console.warn('model', e); }
    return m ? [{ start: 0, end: seg.frames.length - 1, label: m.label, status: m.status, p: m.p, source: 'model' }] : taught;
  }
  function onSegment(seg, at) {
    if (!S.model.ready && !S.signModel) { toast(`Sign seen (${seg.frames.length} frames). Teach some signs or load a model to see words.`); return []; }
    const rs = recognise(seg, fpsNow());
    for (const r of rs) {
      S.words.push({ text: R.wordText(r), status: r.status, label: r.label, at });
      if (settings.speak === 'word' && r.status === 'ok') say(r.label);
    }
    S.lastWordAt = clock();
    renderCaption();
    return rs;
  }
  function maybeEndSentence(state) {
    if (!S.words.length || state !== 'idle' || clock() - S.lastWordAt < 1800) return;
    const text = R.sentenceText(S.words.map(w => w.text));
    const spoken = R.sentenceText(S.words.filter(w => w.status === 'ok').map(w => w.label));
    S.past.push(S.words); if (S.past.length > 3) S.past.shift();
    S.words = [];
    if (settings.speak === 'sentence' && spoken) say(spoken);
    renderCaption();
    return text;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wordsHtml = ws => ws.map(w => `<span class="w ${w.status === 'ok' ? '' : w.status === 'uncertain' ? 'unsure' : 'reject'}">${esc(w.text)}</span>`).join('');
  function renderCaption() {
    $('#capPast').innerHTML = S.past.map(ws => `<div>${wordsHtml(ws)}</div>`).join('');
    $('#capNow').innerHTML = S.words.length ? wordsHtml(S.words) : '';
    const nModel = S.signModel ? S.signModel.size : 0, nTaught = S.model.ready ? S.model.labels.length : 0;
    $('#capMode').textContent = nModel || nTaught
      ? [nModel ? `${nModel} signs from the model` : '', nTaught ? `${nTaught} taught` : ''].filter(Boolean).join(' + ')
      : 'Teach a few signs or load a model to start captions';
  }
  function say(text) {
    try {
      if (!('speechSynthesis' in window) || !text) return;
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en'; u.rate = 1.0;
      speechSynthesis.speak(u);
    } catch {}
  }

  // ------------------------------------------------------------ camera
  async function startCamera() {
    if (!S.ready) return;
    stopAll();
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: settings.facing, width: { ideal: 960 }, height: { ideal: 720 } } });
    } catch (e) {
      $('#coverMsg').textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow the camera for this site in your browser settings, then try again.'
        : `The camera could not start (${e && e.name || 'error'}). This page needs https:// or localhost and a camera.`;
      return;
    }
    S.video.srcObject = S.stream; await S.video.play();
    S.aspect = S.video.videoWidth / S.video.videoHeight || 4 / 3;
    S.source = 'camera'; S.running = true; S.holistic.reset(); newPipe();
    $('#cover').hidden = true; $('#flipBtn').hidden = false; $('#stopBtn').hidden = false;
    canvas.classList.toggle('mirror', settings.facing === 'user');
    try { S.wake = await navigator.wakeLock?.request('screen'); } catch {}
    let n = 0;
    const loop = async () => {
      if (!S.running || S.source !== 'camera') return;
      const w = S.video.videoWidth, h = S.video.videoHeight;
      if (w && h) {
        const res = await detect(S.video);
        if (!S.running || S.source !== 'camera') return;
        const raw = res ? toRaw(res, S.aspect) : new Float32Array(W).fill(NaN);
        if (n++ % 15 === 0) measureLight(S.video, w, h);
        draw(S.video, raw, w, h); updateChips(raw); process(raw);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
  function stopAll() {
    S.running = false; S.source = null;
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
    try { S.wake && S.wake.release(); } catch {}
    if (S.teach) endTeach('Stopped.');
  }

  // ------------------------------------------------------------ teach
  function startTeach() {
    const label = $('#teachWord').value.trim().toLowerCase().replace(/\s+/g, ' ');
    const total = Math.max(2, Math.min(20, Number($('#teachReps').value) || 5));
    if (!label) { toast('Type the English word for the sign first.'); $('#teachWord').focus(); return; }
    if (S.source !== 'camera') { toast('Start the camera first.'); return; }
    S.teach = { label, total, done: 0, phase: 'rest', restSince: 0, goAt: 0 };
    $('#teachBtn').textContent = 'Cancel'; showPrompt(`Lower your hands to get ready for <b>${esc(label)}</b>`);
    renderSignCard();
  }
  function endTeach(msg) {
    S.teach = null; $('#teachBtn').textContent = 'Record'; $('#prompt').hidden = true; if (msg) toast(msg);
    syncPip();
  }
  function showPrompt(html) { const p = $('#prompt'); p.innerHTML = html; p.hidden = false; }
  function teachStep(out) {
    const T = S.teach, now = clock();
    if (T.phase === 'rest') {
      if (out.state === 'idle' && !out.active) {
        if (!T.restSince) T.restSince = now;
        if (now - T.restSince > 600) { T.phase = 'go'; T.goAt = now; showPrompt(`Sign <b>${esc(T.label)}</b> now (${T.done + 1} of ${T.total}), then lower your hands`); }
      } else T.restSince = 0;
      return;
    }
    if (out.closed) {
      saveExample(T.label, out.closed);
      T.done++;
      if (T.done >= T.total) { endTeach(`Saved ${T.total} examples of “${T.label}”.`); $('#teachWord').value = ''; renderSignCard(); return; }
      T.phase = 'rest'; T.restSince = 0; showPrompt(`Got it. Lower your hands for the next one (${T.done + 1} of ${T.total})`);
    } else if (out.state === 'idle' && now - T.goAt > 8000) {
      T.goAt = now; showPrompt(`No sign seen yet. Raise your hands above the dashed line and sign <b>${esc(T.label)}</b>`);
    }
  }
  const flat = (rows, n) => { const a = new Float32Array(rows.length * n); rows.forEach((r, i) => a.set(r, i * n)); return a; };
  const unflat = (a, n) => { const out = []; for (let i = 0; i < a.length / n; i++) out.push(a.subarray(i * n, (i + 1) * n)); return out; };
  async function saveExample(label, seg) {
    const e = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label, signer: settings.signer || 'unnamed',
                fps: +fpsNow().toFixed(1), aspect: S.aspect, mirrored: seg.mirrored, n: seg.frames.length, preN: seg.pre.length,
                frames: flat(seg.frames, D), raw: flat([...seg.pre, ...seg.raw], W), createdAt: new Date().toISOString() };
    S.examples.push(e);
    try { await store.put(e); } catch { toast('Could not save to this browser. The example is kept until you close the page.'); }
    refit();
  }
  let refitTimer = 0;
  function refit() {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      S.model = new R.FewShot({ tauSlack: settings.sens });
      const t0 = performance.now();
      const stats = S.model.fit(S.examples.map(e => ({ label: e.label, frames: unflat(e.frames, D) })));
      S.fitMs = performance.now() - t0;
      renderVocab(stats); renderSignCard(); renderCaption(); renderData();
    }, 30);
  }
  function renderVocab(stats) {
    if (stats !== undefined) S.lastStats = stats; else stats = S.lastStats;
    const counts = new Map();
    for (const e of S.examples) counts.set(e.label, (counts.get(e.label) || 0) + 1);
    const items = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const pairsOf = new Map();
    for (const p of X.taughtPairs(S.lex, new Set(counts.keys()))) {
      for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) { if (!pairsOf.has(x)) pairsOf.set(x, []); pairsOf.get(x).push(`${y} (${p.why})`); }
    }
    $('#vocab').innerHTML = items.length ? items.map(([l, n]) => {
      const pc = stats && stats.perClass.find(p => p.label === l);
      const st = pc && pc.n ? `${pc.correct}/${pc.n} self-test${pc.confusedWith.length ? ` · confused with ${pc.confusedWith.map(esc).join(', ')}` : ''}` : n < 2 ? 'needs 2+ examples' : '';
      const pr = pairsOf.has(l) ? ` <span class="pair">· only differs from ${pairsOf.get(l).map(esc).join(', ')}</span>` : '';
      return `<li><span class="name">${esc(l)}</span><span class="meta">${n} ex · ${st}${pr}</span><button data-del="${esc(l)}" aria-label="Delete ${esc(l)}">Delete</button></li>`;
    }).join('') : '<li><span class="muted">No signs taught yet. Pick a word above or type your own, then press Record.</span></li>';
    const box = $('#selfTest');
    if (stats && stats.n) {
      box.hidden = false;
      const wrong = stats.answered - stats.answeredCorrect, rejected = stats.n - stats.answered;
      box.innerHTML = `<table><tr><td>Self-test</td><td>${stats.answeredCorrect} of ${stats.n} examples recognised when each is held out and matched against the rest</td></tr>
        <tr><td>Misses</td><td>${wrong} wrong word, ${rejected} rejected as too different (shown as [?])</td></tr>
        <tr><td>Note</td><td>Same signer as the examples, so this is the best case. Test a second signer on the live camera.</td></tr></table>`;
    } else box.hidden = true;
    renderSuggest(counts);
  }
  const SUGGEST_MAX = 40;
  function renderSuggest(counts) {
    const sets = S.lex && S.lex.data.sets, set = sets && (sets[settings.sugSet] || sets.starter);
    const keys = set ? set.keys : ['hello', 'thank you', 'yes', 'no', 'please', 'help', 'name', 'water'];
    const left = keys.filter(w => !counts.has(w));
    $('#suggest').innerHTML = left.slice(0, SUGGEST_MAX).map(w => `<button type="button" data-word="${esc(w)}">${esc(w)}</button>`).join('');
    $('#suggestNote').textContent = set
      ? `${set.label}: ${left.length} not taught yet${left.length > SUGGEST_MAX ? `, showing the ${SUGGEST_MAX} most common` : ''}`
      : 'Suggested signs';
  }

  // ------------------------------------------------------------ sign list (ASL-LEX coding + look-alikes)
  // ------------------------------------------------------------ recognition model (.sbm)
  function useModel(buf, name) {
    const m = SM.parse(buf);
    S.signModel = m; renderModel(name); renderCaption(); renderSignCard();
    return m;
  }
  function renderModel(fileName) {
    const m = S.signModel, st = $('#modelStatus'), note = $('#modelNote');
    $('#modelRemove').hidden = !m;
    if (!m) {
      st.textContent = 'No model loaded. Captions use only the signs you teach. Load a SignBridge model file (.sbm) to recognise its signs without teaching them.';
      note.hidden = true; return;
    }
    const mt = m.h.metrics || {};
    st.innerHTML = `<b>${esc(m.h.name || fileName || 'Model')}</b> · ${m.size} signs` + (mt.test_top1 !== undefined
      ? `<br><span class="metrics">Right first time for ${Math.round(mt.test_top1 * 100)}% of signs by ${mt.test_signers} people it never saw` +
        ` (${Math.round(mt.test_top1_ci95[0] * 100)}–${Math.round(mt.test_top1_ci95[1] * 100)}%); in its top 5 for ${Math.round(mt.test_top5 * 100)}%.</span>` : '');
    note.hidden = !m.h.trained_on; note.textContent = m.h.trained_on ? `Kept on this device only. ${m.h.trained_on}` : '';
  }
  $('#modelFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const m = useModel(buf, f.name);
      try { await modelStore.put({ name: f.name, buf }); } catch {}
      toast(`Loaded ${m.size} signs.`);
    } catch (err) { toast(err.message || 'Could not read that model file.'); }
  });
  $('#modelRemove').addEventListener('click', async () => {
    S.signModel = null; try { await modelStore.clear(); } catch {}
    renderModel(); renderCaption(); renderSignCard(); toast('Model removed from this device.');
  });

  // ------------------------------------------------------------ demo: what to sign
  let demoColours = null;
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { demoColours = null; }); } catch {}
  const demoCols = () => {
    if (!demoColours) {
      const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
      demoColours = { bg: v('--panel'), body: v('--sunk'), bodyLine: v('--muted'), hand: v('--accent'), handFill: v('--accent-soft'),
        hand2: v('--hand2'), hand2Fill: v('--unsure-soft'), base: v('--muted'), baseFill: v('--sunk'), path: v('--muted'),
        target: v('--unsure'), contact: v('--unsure'), text: v('--fg') };
    }
    return demoColours;
  };
  const player = new DM.Player(() => [$('#demoCanvas'), $('#demoPip')], demoCols);
  S.demoMode = null;
  function demoFor(word) {
    const hit = S.lex && X.lookup(S.lex, word);
    const sign = hit && hit.sign && hit.sign.hs ? hit.sign : null;
    const ex = S.examples.find(e => e.label === word && e.raw && e.raw.length >= 1629 * 4) || null;
    return { sign, ex, plan: sign ? DM.plan(sign, { handed: settings.handed === 'left' ? 'left' : 'right' }) : null };
  }
  function renderDemo() {
    const word = X.norm($('#teachWord').value), box = $('#demo');
    if (!word) { box.hidden = true; player.clear(); syncPip(); return; }
    const d = demoFor(word);
    $('#demoVideo').href = `https://www.google.com/search?tbm=vid&q=${encodeURIComponent(`ASL sign "${word}"`)}`;
    const modes = { taught: !!d.ex, diagram: !!d.plan };
    // while teaching, show the reference diagram first; otherwise prefer a real taught example
    const order = S.teach ? ['diagram', 'taught'] : ['taught', 'diagram'];
    let mode = S.demoMode && modes[S.demoMode] ? S.demoMode : order.find(m => modes[m]) || null;
    box.hidden = false;
    for (const b of document.querySelectorAll('#demoModes button')) {
      b.hidden = !modes[b.dataset.mode]; b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    }
    $('#demoCanvas').hidden = !mode;
    const steps = $('#demoSteps'), note = $('#demoNote');
    if (mode === 'diagram') {
      player.showDiagram(d.plan);
      steps.innerHTML = DM.caption(d.sign, d.plan, X.LOC[d.sign.loc]).map(t => `<li>${esc(t)}</li>`).join('');
      note.textContent = 'Drawn from the ASL-LEX coding and shown like a mirror. It does not show palm direction or exactly which way the path goes, so check a real video if unsure.';
    } else if (mode === 'taught') {
      player.showReplay(d.ex);
      steps.innerHTML = '';
      note.textContent = `Replay of how ${d.ex.signer && d.ex.signer !== 'unnamed' ? d.ex.signer : 'it'} was taught on this device, shown like a mirror (hands and body landmarks).`;
    } else {
      player.clear(); steps.innerHTML = '';
      note.textContent = 'No demo for this word yet. Once it has been taught here, a replay shows in this space. Open real videos to see it signed.';
    }
    syncPip();
  }
  function syncPip() {
    const show = !!S.teach && !!player.mode && !$('#demo').hidden;
    $('#demoPip').hidden = !show; $('#pipLabel').hidden = !show; $('#pipBox').hidden = !show;
    $('#stage').classList.toggle('has-pip', show);
  }
  function renderSignCard() { renderCardText(); renderDemo(); }
  function renderCardText() {
    const box = $('#signCard'), word = X.norm($('#teachWord').value);
    if (!word || !S.lex) { box.hidden = true; box.innerHTML = ''; return; }
    const hit = X.lookup(S.lex, word);
    if (!hit) {
      box.hidden = false;
      box.innerHTML = `<span class="muted">“${esc(word)}” is not in the built-in sign list. You can still teach it.</span>`;
      return;
    }
    const s = hit.sign, desc = X.describe(s);
    const facts = [X.frequencyWord(s.f), s.wv ? `${s.wv} WLASL videos` : ''].filter(Boolean).join(' · ');
    const taught = new Set(S.examples.map(e => e.label));
    const conf = X.confusables(S.lex, hit.key, taught);
    const confHtml = conf.length
      ? `<span class="warn">Easy to confuse with ${conf.map(c => `<button type="button" data-word="${esc(c.key)}">${esc(c.key)}</button> (${esc(c.why)} only${c.taught ? ', taught' : ''})`).join(', ')}</span>`
      : '';
    const inModel = S.signModel && S.signModel.words.some(w => X.norm(w) === hit.key);
    box.hidden = false;
    box.innerHTML = `<span><b>${esc(hit.key)}</b>${facts ? ` <span class="muted small">${esc(facts)}</span>` : ''}</span>`
      + (inModel ? '<span class="inmodel">✓ The loaded model recognises this sign</span>' : '')
      + (desc ? `<span class="code">${esc(desc)}</span>` : '<span class="muted small">No ASL-LEX coding for this word (several variants share the name).</span>')
      + confHtml;
  }
  async function loadLexicon() {
    try {
      const r = await fetch('data/lexicon.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      S.lex = X.index(await r.json());
    } catch (e) { S.lex = null; window.SBLab.lexError = String(e && e.message || e); return; }
    const sel = $('#suggestSet'), sets = S.lex.data.sets;
    if (!sets[settings.sugSet]) settings.sugSet = 'starter';
    sel.innerHTML = Object.entries(sets).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    sel.value = settings.sugSet; sel.hidden = false;
    const credit = $('#lexCredit'); credit.textContent = S.lex.data.attribution; credit.hidden = false;
    renderVocab(); renderSignCard();
  }

  // ------------------------------------------------------------ video file
  async function runVideo(file) {
    if (!S.ready) return;
    stopAll();
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video format cannot be opened in this browser.')); });
    const fps = Math.max(5, Math.min(30, Number($('#videoFps').value) || 15));
    S.aspect = v.videoWidth / v.videoHeight; S.source = 'video'; S.holistic.reset(); newPipe();
    canvas.classList.remove('mirror'); $('#cover').hidden = true;
    const job = S.videoJob = { cancel: false }, frames = [], results = [];
    $('#videoResults').innerHTML = ''; $('#videoProg').hidden = false; $('#videoCancel').hidden = false; $('#videoSave').hidden = true;
    const total = Math.floor(v.duration * fps);
    const seek = t => new Promise(res => {
      if (Math.abs(v.currentTime - t) < 1e-6 && v.readyState >= 2) return res();
      const timer = setTimeout(res, 3000);
      v.onseeked = () => { clearTimeout(timer); res(); };
      v.currentTime = t;
    });
    const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    const addRes = (seg) => {
      if (!S.model.ready && !S.signModel) { results.push({ t: seg.start / fps, text: `sign (${seg.frames.length} frames)`, status: 'reject' }); return; }
      for (const r of recognise(seg, fps)) results.push({ t: (seg.start + r.start) / fps, text: R.wordText(r), status: r.status });
      $('#videoResults').innerHTML = results.map(r => `<li><span class="ts">${fmt(r.t)}</span><span class="w ${r.status === 'ok' ? '' : r.status === 'uncertain' ? 'unsure' : 'reject'}">${esc(r.text)}</span></li>`).join('');
    };
    for (let i = 0; i < total && !job.cancel; i++) {
      await seek(i / fps);
      const res = await detect(v);
      const raw = res ? toRaw(res, S.aspect) : new Float32Array(W).fill(NaN);
      frames.push(raw);
      draw(v, raw, v.videoWidth, v.videoHeight); updateChips(raw);
      const out = process(raw);
      if (out.closed) addRes(out.closed);
      $('#videoProg').value = (i + 1) / total;
    }
    const last = S.pipe.flush(); if (last) addRes(last);
    if (!results.length) $('#videoResults').innerHTML = '<li class="muted">No signing detected. Check that the hands rise above the rest line in this video.</li>';
    $('#videoCancel').hidden = true; $('#videoProg').hidden = true;
    S.videoFrames = { name: file.name, fps, aspect: S.aspect, frames };
    $('#videoSave').hidden = false; S.source = null;
    URL.revokeObjectURL(v.src);
    toast(job.cancel ? 'Video stopped.' : `Processed ${frames.length} frames.`);
    return results;
  }

  // ------------------------------------------------------------ export / import
  function b64(f32) {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Float32Array(u8.buffer); }
  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function packExamples() {
    return { format: 'signbridge-lab-pack', version: 1, layout: 'mediapipe-holistic-543', created: new Date().toISOString(),
             consent: true, examples: S.examples.map(e => ({ label: e.label, signer: e.signer, fps: e.fps, aspect: e.aspect,
               mirrored: e.mirrored, frames: e.n, pre_frames: e.preN, created: e.createdAt, raw_f32_b64: b64(e.raw) })) };
  }
  async function importPack(text) {
    const pack = JSON.parse(text);
    if (pack.format !== 'signbridge-lab-pack' || !Array.isArray(pack.examples)) throw new Error('This file is not a SignBridge Lab export.');
    let n = 0;
    for (const x of pack.examples) {
      const raw = unb64(x.raw_f32_b64), rows = unflat(raw, W);
      if (rows.length !== x.frames + x.pre_frames) throw new Error(`Example "${x.label}" is damaged (frame count).`);
      const feats = P.featurise(rows, x.pre_frames, x.aspect, x.mirrored);
      const e = { id: `${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}`, label: x.label, signer: x.signer, fps: x.fps,
                  aspect: x.aspect, mirrored: x.mirrored, n: x.frames, preN: x.pre_frames, frames: flat(feats, D), raw, createdAt: x.created };
      S.examples.push(e); await store.put(e); n++;
    }
    refit(); return n;
  }
  function renderData() {
    const signers = new Set(S.examples.map(e => e.signer)), words = new Set(S.examples.map(e => e.label));
    const frames = S.examples.reduce((a, e) => a + e.n, 0);
    $('#dataSummary').innerHTML = `<table><tr><td>Examples</td><td>${S.examples.length}</td></tr><tr><td>Signs</td><td>${words.size}</td></tr>
      <tr><td>Signers</td><td>${[...signers].map(esc).join(', ') || '–'}</td></tr><tr><td>Frames</td><td>${frames}</td></tr>
      <tr><td>Storage</td><td>${store.persistent ? 'saved in this browser' : 'this session only (browser storage unavailable)'}</td></tr></table>`;
  }

  // ------------------------------------------------------------ device check
  function renderDevice() {
    const lm = S.times.lm, pp = S.times.pipe;
    const f = v => (Number.isFinite(v) ? v.toFixed(1) : '–');
    $('#devStats').innerHTML = `<table>
      <tr><td>Landmarks per frame</td><td>${lm.length ? `${f(pct(lm, 0.5))} ms median, ${f(pct(lm, 0.9))} ms p90` : 'start the camera'}</td></tr>
      <tr><td>Features + segmenter</td><td>${pp.length ? `${f(pct(pp, 0.5))} ms median` : '–'}</td></tr>
      <tr><td>Frames per second</td><td>${f(fpsNow())}</td></tr>
      <tr><td>Camera</td><td>${S.video.videoWidth ? `${S.video.videoWidth}×${S.video.videoHeight}` : '–'}</td></tr>
      <tr><td>Recogniser update</td><td>${S.fitMs ? `${f(S.fitMs)} ms for ${S.examples.length} examples` : '–'}</td></tr>
      <tr><td>Browser</td><td>${esc(navigator.userAgent)}</td></tr></table>`;
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Could not load ${src}`)); document.head.appendChild(s); }); }
  async function speedTest() {
    const btn = $('#speedBtn'), out = $('#speedOut');
    btn.disabled = true; out.hidden = false; out.textContent = 'Loading the network…';
    try {
      if (!window.ort) await loadScript('vendor/ort/ort.wasm.min.js');
      const ort = window.ort;
      ort.env.wasm.wasmPaths = new URL('vendor/ort/', location.href).href;
      ort.env.wasm.numThreads = 1;
      const sess = await ort.InferenceSession.create('vendor/speedtest-phone-4.5M.onnx', { executionProviders: ['wasm'] });
      const Wn = 96, feats = new Float32Array(Wn * D);
      for (let i = 0; i < feats.length; i++) feats[i] = Math.sin(i) * 0.5;
      const ones = new Uint8Array(Wn).fill(1);
      const feeds = { feats: new ort.Tensor('float32', feats, [1, Wn, D]), mask: new ort.Tensor('bool', ones, [1, Wn]), seg_mask: new ort.Tensor('bool', ones.slice(), [1, Wn]) };
      out.textContent = 'Warming up…';
      for (let i = 0; i < 3; i++) await sess.run(feeds);
      const ts = [];
      for (let i = 0; i < 20; i++) { const t0 = performance.now(); await sess.run(feeds); ts.push(performance.now() - t0); out.textContent = `Running ${i + 1} of 20…`; }
      const p50 = pct(ts, 0.5), p90 = pct(ts, 0.9), budget = 4000 / 30;
      out.innerHTML = `<table><tr><td>Network</td><td>4.5M parameters, 96-frame window, WebAssembly, 1 thread</td></tr>
        <tr><td>Per run</td><td>${p50.toFixed(1)} ms median, ${p90.toFixed(1)} ms p90 (20 runs)</td></tr>
        <tr><td>Budget</td><td>one run every 4 frames = ${budget.toFixed(0)} ms at 30 fps; this device uses ${(100 * p90 / budget).toFixed(0)}% at p90</td></tr>
        <tr><td>Verdict</td><td>${p90 <= budget * 0.6 ? 'Fits with room for landmarks' : p90 <= budget ? 'Fits, but tight alongside landmarks' : 'Too slow here: a native app with the phone’s accelerator is needed'}</td></tr></table>`;
      window.SBLab.speed = { p50, p90, runs: ts.length };
    } catch (e) { out.textContent = `Speed test failed: ${e.message || e}`; }
    btn.disabled = false;
  }

  // ------------------------------------------------------------ wiring
  function selectTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    if (name === 'device') renderDevice();
    if (name === 'data') renderData();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  $('#startBtn').addEventListener('click', startCamera);
  $('#stopBtn').addEventListener('click', () => { stopAll(); $('#cover').hidden = false; $('#startBtn').textContent = 'Start camera'; $('#flipBtn').hidden = $('#stopBtn').hidden = true; $('#sigflag').hidden = true; });
  $('#flipBtn').addEventListener('click', () => { settings.facing = settings.facing === 'user' ? 'environment' : 'user'; saveSettings(); startCamera(); });
  $('#teachBtn').addEventListener('click', () => (S.teach ? endTeach('Recording cancelled.') : startTeach()));
  $('#teachWord').addEventListener('keydown', e => { if (e.key === 'Enter' && !S.teach) startTeach(); });
  $('#suggest').addEventListener('click', e => { const w = e.target.dataset && e.target.dataset.word; if (w) { $('#teachWord').value = w; $('#teachWord').focus(); renderSignCard(); } });
  $('#signCard').addEventListener('click', e => { const w = e.target.dataset && e.target.dataset.word; if (w && !S.teach) { $('#teachWord').value = w; renderSignCard(); } });
  $('#teachWord').addEventListener('input', () => { S.demoMode = null; renderSignCard(); });
  $('#demoModes').addEventListener('click', e => { const m = e.target.dataset && e.target.dataset.mode; if (m) { S.demoMode = m; renderDemo(); } });
  $('#suggestSet').addEventListener('change', e => { settings.sugSet = e.target.value; saveSettings(); renderVocab(); });
  $('#vocab').addEventListener('click', async e => {
    const l = e.target.dataset && e.target.dataset.del; if (!l) return;
    for (const x of S.examples.filter(x => x.label === l)) await store.del(x.id);
    S.examples = S.examples.filter(x => x.label !== l); refit(); toast(`Deleted “${l}”.`);
  });
  $('#videoFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) runVideo(f).catch(err => toast(err.message)); });
  $('#videoCancel').addEventListener('click', () => { if (S.videoJob) S.videoJob.cancel = true; });
  $('#videoSave').addEventListener('click', () => {
    const v = S.videoFrames; if (!v) return;
    download(`${v.name.replace(/\.[^.]+$/, '')}.landmarks.json`, { format: 'signbridge-lab-video', version: 1, layout: 'mediapipe-holistic-543',
      source: v.name, fps: v.fps, aspect: v.aspect, frames: v.frames.length, raw_f32_b64: b64(flat(v.frames, W)) });
  });
  $('#exportBtn').addEventListener('click', () => {
    if (!S.examples.length) return toast('Nothing to export yet.');
    if (!$('#consent').checked) return toast('Tick the consent box first.');
    download(`signbridge-lab-${new Date().toISOString().slice(0, 10)}.json`, packExamples());
  });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { toast(`Imported ${await importPack(await f.text())} examples.`); } catch (err) { toast(err.message); }
    e.target.value = '';
  });
  $('#clearBtn').addEventListener('click', () => { $('#clearConfirm').hidden = false; });
  $('#clearNo').addEventListener('click', () => { $('#clearConfirm').hidden = true; });
  $('#clearYes').addEventListener('click', async () => { await store.clear(); S.examples = []; refit(); $('#clearConfirm').hidden = true; toast('All examples deleted.'); });
  $('#speedBtn').addEventListener('click', speedTest);

  const bindRange = (id, key, fmt, after) => {
    const el = $(id), out = $(id + 'Val');
    el.value = settings[key]; out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => { settings[key] = Number(el.value); out.textContent = fmt(settings[key]); saveSettings(); after && after(); });
  };
  bindRange('#restY', 'restY', v => `${v.toFixed(2)} shoulder widths below the shoulders`, () => S.pipe && (S.pipe.seg.o.restY = settings.restY));
  bindRange('#sens', 'sens', v => `×${v.toFixed(2)}`, refit);
  [['#handed', 'handed', () => S.pipe && S.pipe.configure({ handedness: settings.handed })],
   ['#speak', 'speak', null],
   ['#fast', 'fast', () => S.holistic && S.holistic.setOptions({ modelComplexity: Number(settings.fast) })]]
    .forEach(([id, key, after]) => { const el = $(id); el.value = settings[key]; el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); after && after(); }); });
  $('#signerId').value = settings.signer;
  $('#signerId').addEventListener('input', e => { settings.signer = e.target.value.trim(); saveSettings(); });
  setInterval(() => { if (!$('[data-pane="device"]').hidden) renderDevice(); }, 1000);

  // Test hook: feed raw landmark frames directly (bypasses the camera). Used by the
  // automated browser test; harmless for people.
  window.SBLab = {
    state: S, settings, toRaw,
    // frames: Float32Array(1629) or arrays with null for missing. Frames are stamped at `fps`
    // on the simulated clock; `session` keeps the pipeline (and handedness state) across calls.
    feed(frames, { aspect = 1.0, fps = 30, session = true } = {}) {
      if (!S.pipe || !session) { S.aspect = aspect; newPipe(); }
      S.source = 'camera';
      if (S.fakeNow === undefined) S.fakeNow = 0;
      let closed = 0;
      for (const f of frames) {
        S.fakeNow += 1000 / fps;
        const out = process(f instanceof Float32Array ? f : Float32Array.from(f, v => (v === null ? NaN : v)));
        if (out.closed) closed++;
      }
      return closed;
    },
    teachStart(label, total) { $('#teachWord').value = label; $('#teachReps').value = total; S.source = 'camera'; if (!S.pipe) newPipe(); startTeach(); return !!S.teach; },
    endSentence() { S.lastWordAt = 0; return maybeEndSentence('idle'); },
    importPack, packExamples, runVideo, speedTest,
    lexicon: () => S.lex, renderSignCard, demo: player,
    loadModel: (buf, name) => useModel(buf, name), recognise,
  };

  // ------------------------------------------------------------ boot
  (async () => {
    renderVocab(null); renderCaption(); renderData();
    loadLexicon().then(() => { window.SBLab.lexReady = true; });
    modelStore.get().then(v => { if (v && v.buf) { try { useModel(v.buf, v.name); } catch {} } }).catch(() => {}).finally(() => { window.SBLab.modelChecked = true; });
    S.examples = await store.all().catch(() => []);
    if (S.examples.length) refit();
    if (!window.isSecureContext || !navigator.mediaDevices) {
      $('#coverMsg').textContent = 'Live camera needs this page on https:// or localhost. Video files still work in the Video tab.';
    }
    try {
      await initHolistic();
      const b = $('#startBtn'); b.disabled = false; b.textContent = 'Start camera';
      $('#teachBtn').disabled = false;
      $('#coverMsg').textContent = 'Point the camera at the signer from the waist up, in good light.';
      window.SBLab.ready = true;
    } catch (e) {
      $('#startBtn').textContent = 'Landmark models failed to load';
      $('#coverMsg').textContent = `${e.message || e}. Reload the page; if it persists, this browser may not support WebAssembly.`;
      window.SBLab.error = String(e && e.message || e);
    }
  })();
})();
