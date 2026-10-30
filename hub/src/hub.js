(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const B = { A: 1, B: 2, SEL: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, X: 256, Y: 512, L: 1024, R: 2048 };
  const DPAD = B.UP | B.DOWN | B.LEFT | B.RIGHT;

  const CONSOLES = [
    { id: 'nes', name: 'NES', full: 'Nintendo Entertainment System', ext: '.nes', accept: '.nes,.zip', status: 'ready', accent: '#e4483b' },
    { id: 'snes', name: 'SNES', full: 'Super Nintendo', ext: '.sfc  .smc', accept: '.sfc,.smc,.zip', status: 'beta', accent: '#8a7be8' },
    { id: 'gb', name: 'Game Boy', full: 'Game Boy e Game Boy Color', ext: '.gb  .gbc', accept: '.gb,.gbc,.zip', status: 'beta', accent: '#5aa469' },
    { id: 'sms', name: 'Master System', full: 'Sega Master System', ext: '.sms', accept: '.sms,.zip', status: 'beta', accent: '#2fa4d9', short: 'SMS' },
    { id: 'gg', name: 'Game Gear', full: 'Sega Game Gear', ext: '.gg', accept: '.gg,.zip', status: 'beta', accent: '#c9a227' },
    { id: 'gba', name: 'GBA', full: 'Game Boy Advance', ext: '.gba', accept: '.gba,.zip', status: 'beta', accent: '#4d7cf0' }
  ];

  /* Ícones originais (silhuetas genéricas de controle/portátil), não são logos oficiais */
  const LOGOS = {
    nes: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <rect x="6" y="14" width="84" height="36" rx="4"/>
      <path d="M16 29h16M24 21v16" stroke-width="5"/>
      <circle cx="68" cy="33" r="5" fill="var(--accent)" stroke="none"/><circle cx="80" cy="33" r="5" fill="var(--accent)" stroke="none"/>
      <path d="M42 37h7M52 37h7"/></svg>`,
    snes: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M20 14h56c9 0 14 11 12 24-1.5 9-9 11-14 6l-6-6H28l-6 6c-5 5-12.5 3-14-6C6 25 11 14 20 14z"/>
      <path d="M22 24h14M29 17v14" stroke-width="5"/>
      <circle cx="68" cy="17" r="3.6" fill="#4d7cf0" stroke="none"/><circle cx="68" cy="31" r="3.6" fill="#d9aa35" stroke="none"/>
      <circle cx="61" cy="24" r="3.6" fill="#3fae78" stroke="none"/><circle cx="75" cy="24" r="3.6" fill="#e4483b" stroke="none"/>
      <path d="M42 29h6M51 29h6"/></svg>`,
    gb: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M30 6h36a4 4 0 0 1 4 4v34a4 4 0 0 1-1 3l-4 9a4 4 0 0 1-3.600 2H34.600a4 4 0 0 1-3.600-2l-4-9a4 4 0 0 1-1-3V10a4 4 0 0 1 4-4z"/>
      <rect x="34" y="12" width="28" height="20" rx="2" fill="currentColor" fill-opacity=".2"/>
      <path d="M36 42h9M40.500 37.500v9" stroke-width="4"/>
      <circle cx="58" cy="44" r="3.200" fill="var(--accent)" stroke="none"/><circle cx="64" cy="39" r="3.200" fill="var(--accent)" stroke="none"/></svg>`,
    sms: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M8 24l8-10h64l8 10v22a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/>
      <path d="M30 24h36" /><rect x="34" y="30" width="28" height="9" rx="1.500" fill="currentColor" fill-opacity=".2"/>
      <circle cx="18" cy="41" r="2.600" fill="var(--accent)" stroke="none"/><circle cx="78" cy="41" r="2.600" fill="var(--accent)" stroke="none"/></svg>`,
    gg: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <rect x="4" y="14" width="88" height="38" rx="10"/>
      <rect x="28" y="19" width="40" height="28" rx="2" fill="currentColor" fill-opacity=".2"/>
      <path d="M10 33h12M16 27v12" stroke-width="4.500"/>
      <circle cx="78" cy="30" r="4" fill="var(--accent)" stroke="none"/><circle cx="85" cy="38" r="4" fill="var(--accent)" stroke="none"/></svg>`,
    gba: `<svg viewBox="0 0 96 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <rect x="4" y="12" width="88" height="42" rx="12"/>
      <rect x="31" y="19" width="34" height="26" rx="2" fill="currentColor" fill-opacity=".2"/>
      <path d="M10 8v4M26 8v4M10 8h16M70 8v4M86 8v4M70 8h16" stroke-width="2.5"/>
      <path d="M11 33h12M17 27v12" stroke-width="4.5"/>
      <circle cx="76" cy="38" r="4" fill="var(--accent)" stroke="none"/><circle cx="84" cy="31" r="4" fill="var(--accent)" stroke="none"/>
      <path d="M36 50h5M46 50h5" stroke-width="2.5"/></svg>`
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- estado ---------- */
  let cur = null, core = null, loaded = false, paused = false, muted = false;
  let last = 0, acc = 0, kbd = 0, touch = 0, gpad = 0, inPlayer = false;
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  let img = null, img32 = null;

  if (matchMedia('(pointer:fine)').matches) document.body.classList.add('nopad');

  /* ---------- home ---------- */
  function renderHome() {
    const grid = $('grid'); grid.innerHTML = '';
    for (const c of CONSOLES) {
      const b = document.createElement('button');
      b.className = 'card'; b.style.setProperty('--accent', c.accent);
      b.innerHTML = '<span class="logo">' + LOGOS[c.id] + '</span>' +
        '<span class="info"><span class="cname">' + c.name + '</span><span class="cfull">' + c.full + '</span>' +
        '<span class="cmeta"><span class="chip ' + (c.status === 'ready' ? 'ready' : 'wip') + '">' + ({ ready: 'Funcionando', beta: 'Beta', wip: 'Em desenvolvimento' }[c.status]) + '</span><span class="ext">' + c.ext + '</span></span></span>' +
        '<svg class="ico go"><use href="#i-chev"/></svg>';
      b.onclick = () => openConsole(c);
      grid.appendChild(b);
    }
  }

  function setScreen(w, h) {
    canvas.width = w; canvas.height = h;
    img = ctx.createImageData(w, h); img32 = new Uint32Array(img.data.buffer);
    const st = $('stage');
    st.style.setProperty('--ar', w + ' / ' + h);
    st.style.setProperty('--arn', (w / h).toFixed(4));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    if (typeof layoutStage === 'function') { try { layoutStage(); } catch (e) {} }
  }
  function showMsg(html, big) { $('msgbody').innerHTML = html; $('bBig').style.display = big === false ? 'none' : ''; $('msg').style.display = 'flex'; }
  function hideMsg() { $('msg').style.display = 'none'; }
  function setPauseIcon() { $('uPause').setAttribute('href', paused ? '#i-play' : '#i-pause'); }

  function openConsole(c) {
    cur = c; core = Cores[c.id].create(); loaded = false; paused = false; inPlayer = true;
    document.body.style.setProperty('--accent', c.accent);
    $('home').hidden = true; $('player').hidden = false;
    $('ptitle').textContent = c.short || c.name;
    $('file').accept = c.accept;
    setScreen(core.width, core.height);
    buildPad(c.id);
    applyVolume(); setPauseIcon();
    showMsg('<div class="ttl">' + c.name + '</div>Carregue uma ROM <b>' + esc(c.ext.trim().split(/\s+/).join(' ou ')) + '</b>');
    sramKeyCur = null;
    resetTools();
    if (c.id === 'gba') { try { const b = localStorage.getItem('gba_bios'); if (b) { core.loadBios(unb64(b)); toast('BIOS do GBA carregada'); } } catch (e) {} }
  }
  let toastT = 0;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }
  function closeConsole() {
    msave(); curKey = null; sramSave(); inPlayer = false; loaded = false; core = null; cur = null;
    kbd = touch = gpad = 0;
    $('player').hidden = true; $('home').hidden = false; try { renderLib(); } catch (e) {}
    document.body.style.setProperty('--accent', '#e4483b');
  }

  /* ---------- áudio ---------- */
  let actx = null;
  function applyVolume() { if (core && core.audio) core.audio.setVolume(muted ? 0 : 1); }
  let audioNode = null;
  function initAudio() {
    if (!core || !core.audio) return;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        actx = new AC({ latencyHint: 'interactive' });
        const node = actx.createScriptProcessor(1024, 0, 1);
        node.onaudioprocess = e => {
          const out = e.outputBuffer.getChannelData(0);
          if (core && core.audio && loaded && !paused) core.audio.fill(out); else out.fill(0);
        };
        node.connect(actx.destination); audioNode = node;
      } catch (e) { actx = null; return; }
    }
    core.audio.setSampleRate(actx.sampleRate);
    if (actx.state === 'suspended') actx.resume();
  }
  ['pointerdown', 'keydown'].forEach(t => addEventListener(t, () => { if (loaded) initAudio(); }, { passive: true }));

  /* ---------- saves de bateria ---------- */
  let sramKeyCur = null, sramLast = '';
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 4096) s += String.fromCharCode.apply(null, u8.subarray(i, i + 4096)); return btoa(s); };
  const unb64 = s => { const r = atob(s), u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; };
  function sramInit() {
    sramKeyCur = core.sramKey(); sramLast = '';
    if (!sramKeyCur) return;
    try { const s = localStorage.getItem(sramKeyCur); if (s) { core.sramRestore(unb64(s)); sramLast = s; } } catch (e) {}
  }
  function sramSave() {
    if (!core || !sramKeyCur) return;
    try { const s = b64(core.sramData()); if (s !== sramLast) { localStorage.setItem(sramKeyCur, s); sramLast = s; } } catch (e) {}
  }
  setInterval(sramSave, 3000);
  addEventListener('pagehide', sramSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) sramSave(); });

  /* ---------- carregar ROM ---------- */
  async function loadFile(f, key) {
    if (!core) return;
    try {
      const rb = await romBytes(f), u8 = rb.u8; lastRom = u8;
      curKey = key || (cur.id + ':' + libName(rb.name));
      sramSave();
      const info = core.load(u8);
      sramInit();
      romId = cur.id + '_' + hashRom(u8); loadCheats(); loadEnh(); rewindRing.length = 0; refreshSlots();
      applyVideo(vidOf(curKey));
      loaded = core.ready; $('bRew').hidden = !(core.ready && rewindOn && core.saveState); paused = false; setPauseIcon(); applyVolume();
      if (core.ready) { hideMsg(); initAudio(); }
      else {
        showMsg('<div class="ttl">' + esc(info.title) + '</div><ul>' + info.lines.map(l => '<li>' + esc(l) + '</li>').join('') +
          '</ul><div class="note">ROM reconhecida, mas o núcleo do ' + esc(cur.name) + ' ainda está em construção e não roda jogos.</div>');
      }
    } catch (e) {
      loaded = false;
      showMsg('<div class="err">' + esc(e.message) + '</div>');
    }
  }
  const openPicker = () => $('file').click();
  $('bOpen').onclick = openPicker; $('bBig').onclick = openPicker;
  $('file').onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; };
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); if (inPlayer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  $('bBack').onclick = closeConsole;
  $('bReset').onclick = () => { if (core && loaded) core.reset(); };
  $('bPause').onclick = () => { if (!loaded) return; paused = !paused; setPauseIcon(); };
  $('bMute').onclick = () => { muted = !muted; $('uMute').setAttribute('href', muted ? '#i-mute' : '#i-vol'); applyVolume(); };
  $('bBios').onclick = () => $('fileBios').click();
  $('fileBios').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const u8 = new Uint8Array(await f.arrayBuffer());
      if (u8.length !== 16384) throw new Error('A BIOS do GBA tem 16 KB (16384 bytes).');
      if (core && core.loadBios) core.loadBios(u8);
      try { localStorage.setItem('gba_bios', b64(u8)); } catch (er) {}
      toast('BIOS carregada, so fica neste aparelho');
      if (loaded && core && core.loadBios) core.reset();
      $('biosHint').textContent = 'BIOS guardada neste aparelho. Vale para os jogos de GBA que você abrir a partir de agora.';
    } catch (er) { toast(er.message); }
  };
  $('bPad').onclick = () => document.body.classList.toggle('nopad');


  /* ---------- painel de ferramentas: velocidade, cheats, tela ---------- */
  let speed = 1, turbo = false, padTurbo = false, romId = null, cheats = [];
  const isField = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  const hashRom = u8 => { let h = 2166136261 >>> 0; const st = Math.max(1, (u8.length / 65536) | 0); for (let i = 0; i < u8.length; i += st) h = Math.imul(h ^ u8[i], 16777619) >>> 0; return h.toString(36) + '_' + u8.length; };

  function buildSeg(el, labels, onPick) {
    el.innerHTML = '<i></i>' + labels.map((l, i) => '<button type="button" data-i="' + i + '" aria-pressed="false">' + l + '</button>').join('');
    el.style.setProperty('--n', labels.length);
    el.onclick = e => { const b = e.target.closest('button'); if (b) onPick(+b.dataset.i); };
    return i => { el.style.setProperty('--i', i); [...el.querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', k === i)); };
  }
  const SPEEDS = [0.5, 1, 2, 3, 5, 8];
  const setSpeedSeg = buildSeg($('segSpeed'), SPEEDS.map(v => v + 'x'), i => { speed = SPEEDS[i]; setSpeedSeg(i); acc = 0; spFrames = 0; spT = 0; spReal = 0; });
  let filter = 0;
  function applyFilter() { $('screen').style.imageRendering = filter ? 'auto' : 'pixelated'; }
  setSpeedSeg(1);
  function resetTools() { speed = 1; turbo = false; rewindRing.length = 0; rwKbd = rwBtn = false; slotInfo = [null, null, null]; renderSlots(); $('bRew').hidden = true; setSpeedSeg(1); romId = null; cheats = []; enh = {}; renderCheats(); $('secEnh').hidden = true; closeSheet(true); }

  /* gaveta */
  let sheetT = 0;
  function openSheet(mode) {
    showSheetMode(mode || 'tools'); refreshSlots();
    const sh = $('sheet'); clearTimeout(sheetT); sh.classList.remove('closing'); sh.hidden = false;
    void sh.offsetWidth; sh.classList.add('open'); renderCheats(); $('shClose').focus({ preventScroll: true });
  }
  function closeSheet(now) {
    const sh = $('sheet'); if (sh.hidden) return;
    $('tabSet').appendChild($('setPage'));
    sh.classList.add('closing'); sh.classList.remove('open'); clearTimeout(sheetT);
    sheetT = setTimeout(() => { sh.hidden = true; sh.classList.remove('closing'); }, now ? 0 : 210);
    if (!now && inPlayer) $('bTools').focus({ preventScroll: true });
  }
  $('bTools').onclick = () => openSheet('tools'); $('shClose').onclick = () => closeSheet(); $('scrim').onclick = () => closeSheet();
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  /* cheats */
  const ckey = () => 'cheats_' + romId;
  function saveCheats() { try { localStorage.setItem(ckey(), JSON.stringify(cheats)); } catch (e) {} }
  function pushCheats() {
    if (!core || !core.setCheats) return;
    const ops = [];
    for (const c of cheats) if (c.on) { try { ops.push(...core.parseCheat(c.code)); } catch (e) {} }
    core.setCheats(ops);
  }
  function loadCheats() {
    cheats = [];
    try { const v = JSON.parse(localStorage.getItem(ckey()) || '[]'); if (Array.isArray(v)) cheats = v; } catch (e) {}
    pushCheats(); renderCheats();
  }
  function renderCheats() {
    const ul = $('cheatList'), has = !!romId;
    $('chAdd').disabled = !has;
    $('chHint').textContent = !has ? 'Carregue uma ROM para adicionar cheats.' :
      (cur && cur.id === 'nes' ? 'NES: Game Genie (ex.: SXIOPO) ou endereço:valor da RAM (ex.: 0075:09).' :
       cur && cur.id === 'snes' ? 'SNES: Game Genie (ex.: C2A4-6F0D) ou Action Replay (ex.: 7E0DBE05 ou 7E0DBE:05, RAM 7E0000-7FFFFF).' :
       cur && (cur.id === 'sms' || cur.id === 'gg') ? cur.name + ': endereço:valor da RAM (ex.: C123:09) ou Action Replay 00C12309.' :
       cur && cur.id === 'gb' ? 'Game Boy: GameShark (ex.: 01FF34C0 = valor FF no endereço C034) ou Game Genie (ex.: 00A-17B-C49).' :
       cur && cur.id === 'gba' ? 'GBA: AR/GameShark sem criptografia, tipos 0, 1 e 2 (ex.: 03001234 000000FF), ou endereço:valor (ex.: 03001234:FF).' : '');
    if (!cheats.length) { ul.innerHTML = '<li class="empty">' + (has ? 'Nenhum cheat ainda.' : '') + '</li>'; return; }
    ul.innerHTML = cheats.map((c, i) => '<li class="ch"><div class="nm"><b>' + esc(c.name) + '</b><code>' + esc(c.code.replace(/\s*\n\s*/g, ' / ')) + '</code></div>' +
      '<button class="sw" role="switch" aria-checked="' + c.on + '" aria-label="Ativar ' + esc(c.name) + '" data-t="' + i + '"></button>' +
      '<button class="xb" aria-label="Remover ' + esc(c.name) + '" data-d="' + i + '"><svg class="ico" style="width:18px;height:18px"><use href="#i-close"/></svg></button></li>').join('');
  }
  $('cheatList').onclick = e => {
    const t = e.target.closest('[data-t]'), d = e.target.closest('[data-d]');
    if (t) { const c = cheats[+t.dataset.t]; c.on = !c.on; t.setAttribute('aria-checked', c.on); saveCheats(); pushCheats(); }
    else if (d) { cheats.splice(+d.dataset.d, 1); saveCheats(); pushCheats(); renderCheats(); }
  };
  $('chAdd').onclick = () => {
    const code = $('chCode').value.trim(), err = $('chErr');
    try {
      core.parseCheat(code);
      cheats.push({ name: $('chName').value.trim() || 'Cheat ' + (cheats.length + 1), code, on: true });
      $('chName').value = ''; $('chCode').value = ''; err.textContent = '';
      saveCheats(); pushCheats(); renderCheats();
    } catch (e) { err.textContent = e.message; }
  };

  /* captura de tela */
  $('bShot').onclick = () => {
    if (!core || !loaded) { toast('Carregue uma ROM primeiro'); return; }
    const src = shader ? view : $('screen'), k = shader ? 1 : 4, c = document.createElement('canvas'); c.width = src.width * k; c.height = src.height * k;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.drawImage(src, 0, 0, c.width, c.height);
    c.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'captura-' + cur.id + '-' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Captura salva'); });
  };


  /* ---------- melhorias por jogo (cada núcleo diz quais tem) ---------- */
  let enh = {};
  const ekey = () => 'enh_' + romId;
  function renderEnh() {
    const defs = core && core.enhancements ? core.enhancements() : [], box = $('enhBox');
    $('secEnh').hidden = !defs.length || !romId; box.innerHTML = '';
    for (const d of defs) {
      const w = document.createElement('div'); w.className = 'enh';
      if (d.type === 'toggle') {
        w.innerHTML = '<div class="top"><span>' + esc(d.label) + '</span><button class="sw" role="switch" aria-checked="' + !!enh[d.id] + '" aria-label="' + esc(d.label) + '"></button></div>';
        const sw = w.querySelector('.sw');
        sw.onclick = () => { enh[d.id] = !enh[d.id]; sw.setAttribute('aria-checked', !!enh[d.id]); applyEnh(); };
      } else {
        w.innerHTML = '<div class="top"><span>' + esc(d.label) + '</span></div><div class="seg"></div>';
        const set = buildSeg(w.querySelector('.seg'), d.choices, i => { enh[d.id] = i; set(i); applyEnh(); });
        set(enh[d.id] | 0);
      }
      w.insertAdjacentHTML('beforeend', '<p class="hint">' + esc(d.hint) + '</p>');
      box.appendChild(w);
    }
  }
  function applyEnh() { if (core && core.setOptions) core.setOptions(enh); try { localStorage.setItem(ekey(), JSON.stringify(enh)); } catch (e) {} }
  function loadEnh() {
    enh = {}; try { enh = JSON.parse(localStorage.getItem(ekey()) || '{}') || {}; } catch (e) {}
    if (core && core.setOptions) core.setOptions(enh);
    renderEnh();
  }

  /* ---------- estados salvos e rebobinar ---------- */
  const idb = (() => {
    let p;
    const open = () => p || (p = new Promise((res, rej) => { try { const r = indexedDB.open('emuhub', 1); r.onupgradeneeded = () => r.result.createObjectStore('st'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }));
    const tx = (m, f) => open().then(db => new Promise((res, rej) => { const t = db.transaction('st', m), rq = f(t.objectStore('st')); t.oncomplete = () => res(rq.result); t.onerror = () => rej(t.error); }));
    return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), all: () => open().then(db => new Promise((res, rej) => { const t = db.transaction('st', 'readonly'), s = t.objectStore('st'), ks = s.getAllKeys(), vs = s.getAll(); t.oncomplete = () => res(ks.result.map((k, i) => [k, vs.result[i]])); t.onerror = () => rej(t.error); })) };
  })();
  const pack = async u8 => window.CompressionStream ? { gz: true, data: new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) } : { gz: false, data: u8 };
  const unpack = async r => r.gz ? new Uint8Array(await new Response(new Blob([r.data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : r.data;
  const slotKey = n => 'state_' + romId + '_' + n;
  let slotInfo = [null, null, null];
  function thumb() {
    const c = document.createElement('canvas'); c.width = 120; c.height = Math.round(120 * core.height / core.width);
    c.getContext('2d').drawImage($('screen'), 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.6);
  }
  async function refreshSlots() {
    slotInfo = [null, null, null];
    if (romId) { try { for (let n = 0; n < 3; n++) { const r = await idb.get(slotKey(n)); if (r) slotInfo[n] = { t: r.t, thumb: r.thumb }; } } catch (e) {} }
    renderSlots();
  }
  const fmtT = t => { const d = new Date(t), p2 = v => String(v).padStart(2, '0'); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  function renderSlots() {
    const has = !!romId && loaded;
    $('slots').innerHTML = slotInfo.map((s, n) => '<div class="slot"><div class="th"' + (s ? ' style="background-image:url(' + s.thumb + ')"' : '') + '>' + (s ? '' : 'Vazio') + '</div>' +
      '<div class="lb">Slot ' + (n + 1) + '<small>' + (s ? fmtT(s.t) : 'sem estado') + '</small></div>' +
      '<div class="bt"><button class="btn" data-sv="' + n + '"' + (has ? '' : ' disabled') + '>Salvar</button><button class="btn" data-ld="' + n + '"' + (has && s ? '' : ' disabled') + '>Carregar</button></div></div>').join('');
    $('slots').style.setProperty('--ar', core ? core.width + ' / ' + core.height : '256/240');
  }
  async function saveSlot(n) {
    if (!core || !loaded || !romId) return;
    try {
      const raw = core.saveState(), pk = await pack(raw);
      await idb.set(slotKey(n), { t: Date.now(), gz: pk.gz, data: pk.data, thumb: thumb() });
      toast('Estado salvo no slot ' + (n + 1)); refreshSlots();
    } catch (e) { toast('Não foi possível salvar o estado'); }
  }
  async function loadSlot(n) {
    if (!core || !loaded || !romId) return;
    try {
      const r = await idb.get(slotKey(n));
      if (!r) { toast('Slot ' + (n + 1) + ' está vazio'); return; }
      core.loadState(await unpack(r)); rewindRing.length = 0; acc = 0;
      core.runFrame(); img32.set(core.frame); present();
      toast('Estado do slot ' + (n + 1) + ' carregado');
    } catch (e) { toast('Não foi possível carregar o estado'); }
  }
  $('slots').onclick = e => { const a = e.target.closest('[data-sv]'), b = e.target.closest('[data-ld]'); if (a) saveSlot(+a.dataset.sv); else if (b) loadSlot(+b.dataset.ld); };

  let rewindOn = true, rwKbd = false, rwBtn = false, rwPad = false, rwCount = 0, rwAcc = 0;
  const rewindRing = [];
  $('swRewind').onclick = () => { rewindOn = !rewindOn; $('swRewind').setAttribute('aria-checked', rewindOn); rewindRing.length = 0; $('bRew').hidden = !(rewindOn && loaded); };
  const rewBtn = $('bRew');
  rewBtn.addEventListener('pointerdown', e => { rwBtn = true; rewBtn.classList.add('on'); rewBtn.setPointerCapture(e.pointerId); e.preventDefault(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => rewBtn.addEventListener(t, () => { rwBtn = false; rewBtn.classList.remove('on'); }));
  const isRewinding = () => rewindOn && (rwKbd || rwBtn || rwPad);
  function rewindCapture() {
    if (++rwCount < 8) return; rwCount = 0;
    rewindRing.push(core.saveState()); if (rewindRing.length > (core.id === 'gba' ? 45 : 90)) rewindRing.shift();
  }

  /* ---------- biblioteca de jogos com capas (thumbnails do libretro/RetroArch) ---------- */
  const LIBSYS = {
    nes: 'Nintendo - Nintendo Entertainment System',
    snes: 'Nintendo - Super Nintendo Entertainment System',
    gb: 'Nintendo - Game Boy',
    sms: 'Sega - Master System - Mark III',
    gg: 'Sega - Game Gear',
    gba: 'Nintendo - Game Boy Advance'
  };
  const EXT2CON = { nes: 'nes', sfc: 'snes', smc: 'snes', gb: 'gb', gbc: 'gb', sms: 'sms', gg: 'gg', gba: 'gba' };
  const IMGEXT = { png: 1, jpg: 1, jpeg: 1, webp: 1 };
  let lib = [], libDir = null;
  const libName = f => f.replace(/\.[^.]+$/, '');
  const libSafe = n => n.replace(/[&*\/:`<>?\\|"]/g, '_');
  function coverCandidates(base) {
    const out = [base];
    const noTags = base.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim();
    const region = (base.match(/\((USA|Europe|Japan|World|Brazil|Australia|Korea|Germany|France|Spain|Italy)[^)]*\)/i) || [])[0];
    const noRev = base.replace(/\s*\((Rev|v)[^)]*\)/ig, '').replace(/\s*\((Beta|Proto|Unl|Demo)[^)]*\)/ig, '').trim();
    out.push(noRev);
    if (region) out.push(noTags + ' ' + region);
    for (const r of ['(USA)', '(Europe)', '(World)', '(Japan)', '(USA, Europe)']) out.push(noTags + ' ' + r);
    return [...new Set(out.filter(Boolean))];
  }
  const coverUrl = (con, n) => 'https://thumbnails.libretro.com/' + encodeURIComponent(LIBSYS[con]).replace(/%20/g, '%20') + '/Named_Boxarts/' + encodeURIComponent(libSafe(n)) + '.png';


  /* ---------- ZIP (sem biblioteca: parser + DecompressionStream) ---------- */
  const ZIP = {
    async list(file) {
      const tail = new DataView(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
      let e = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { e = i; break; }
      if (e < 0) throw new Error('Arquivo ZIP inválido');
      const cnt = tail.getUint16(e + 10, true), csz = tail.getUint32(e + 12, true), coff = tail.getUint32(e + 16, true);
      if (coff === 0xFFFFFFFF) throw new Error('ZIP64 não é suportado');
      const cd = new DataView(await file.slice(coff, coff + csz).arrayBuffer()), u8 = new Uint8Array(cd.buffer), out = []; let p = 0;
      for (let i = 0; i < cnt && p + 46 <= cd.byteLength; i++) {
        if (cd.getUint32(p, true) !== 0x02014b50) break;
        const fl = cd.getUint16(p + 8, true), nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
        out.push({ name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)), enc: fl & 1, method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), usize: cd.getUint32(p + 24, true), off: cd.getUint32(p + 42, true) });
        p += 46 + nl + xl + cl;
      }
      return out;
    },
    find: list => list.find(e => !e.name.endsWith('/') && EXT2CON[e.name.split('.').pop().toLowerCase()]),
    async read(file, e) {
      if (e.enc) throw new Error('ZIP com senha não é suportado');
      const lh = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer()), s = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true), raw = file.slice(s, s + e.csize);
      if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
      if (e.method !== 8) throw new Error('Compressão do ZIP não suportada');
      if (!window.DecompressionStream) throw new Error('Este navegador não abre ZIP compactado; extraia a ROM');
      return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
  };
  // devolve { u8, name } de um arquivo de ROM, abrindo o ZIP se for o caso
  async function romBytes(f) {
    if (/\.zip$/i.test(f.name)) {
      const e = ZIP.find(await ZIP.list(f)); if (!e) throw new Error('Nenhuma ROM (.nes, .sfc, .smc, .gb, .gbc, .gba) dentro do ZIP');
      return { u8: await ZIP.read(f, e), name: e.name.split('/').pop() };
    }
    return { u8: new Uint8Array(await f.arrayBuffer()), name: f.name };
  }
  const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  window.__hubZip = { ZIP, romBytes, crc32 };

  async function scanDir(dir, depth, out, imgs) {
    for await (const [name, h] of dir.entries()) {
      if (h.kind === 'directory') { if (depth < 3) await scanDir(h, depth + 1, out, imgs); continue; }
      const ext = name.split('.').pop().toLowerCase();
      if (EXT2CON[ext]) out.push({ name, base: libName(name), con: EXT2CON[ext], handle: h });
      else if (ext === 'zip') { try { const e = ZIP.find(await ZIP.list(await h.getFile())); if (e) { const n = e.name.split('/').pop(); out.push({ name, base: libName(n), con: EXT2CON[n.split('.').pop().toLowerCase()], handle: h, zip: true }); } } catch (er) {} }
      else if (IMGEXT[ext]) imgs[libName(name).toLowerCase()] = h;
    }
  }
  function applyImgs(items, imgs) { for (const it of items) { const h = imgs[it.base.toLowerCase()]; if (h) it.imgHandle = h; if (!h && it.imgFile === undefined) it.imgFile = null; } }
  function setLib(items) {
    lib = items.sort((a, b) => a.base.localeCompare(b.base, 'pt-BR', { numeric: true }));
    $('libQ').hidden = !lib.length; renderLib();
    $('libMsg').textContent = (FILEMODE && !libDir) ? (lib.length ? lib.length + (lib.length === 1 ? ' jogo guardado' : ' jogos guardados') + ' no aplicativo.' : 'Toque em Adicionar jogos para escolher as suas ROMs.') : lib.length ? lib.length + (lib.length === 1 ? ' jogo' : ' jogos') + ' em ' + (libDir ? libDir.name : 'pasta') + '.' : 'Nenhuma ROM (.nes, .sfc, .smc, .gb, .gbc, .gba) encontrada nessa pasta.';
  }
  /* ---------- favoritos, recentes e tempo de jogo ---------- */
  let META = {}; try { META = JSON.parse(localStorage.getItem('hub_meta') || '{}') || {}; } catch (e) {}
  const mk = it => it.con + ':' + it.base;
  const mget = k => META[k] || (META[k] = { fav: 0, last: 0, sec: 0 });
  const msave = () => { try { localStorage.setItem('hub_meta', JSON.stringify(META)); } catch (e) {} };
  let curKey = null, libView = 0, lastRom = null;
  const fmtTime = s => s < 60 ? '' : s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ' min';
  setInterval(() => {
    if (curKey && inPlayer && loaded && !paused && !document.hidden) { mget(curKey).sec++; if (++metaTick >= 15) { metaTick = 0; msave(); } }
  }, 1000);
  let metaTick = 0;
  addEventListener('pagehide', msave);
  const setLibSeg = buildSeg($('segLib'), ['Todos', 'Favoritos', 'Recentes'], i => { libView = i; setLibSeg(i); renderLib(); });
  let libCon = 'all', gameKeyOpen = null, gameItemOpen = null;
  const vTitle = it => it.base.replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim() || it.base;
  function mkCard(it, k, small) {
    const c = CONSOLES.find(x => x.id === it.con), w = document.createElement('div'), b = document.createElement('button'), m = mget(mk(it));
    w.className = 'gmw'; b.className = 'gm'; b.style.setProperty('--accent', c.accent); b.style.setProperty('--k', Math.min(k, 20));
    const ptxt = fmtTime(m.sec);
    b.innerHTML = '<span class="art"><span class="cs">' + (m.fav ? '\u2605 ' : '') + c.name + '</span><span class="ft">' + esc(vTitle(it)) + '</span><img alt="" loading="lazy" decoding="async"></span><span class="tt">' + esc(it.base) + (ptxt && !small ? '<span class="pt">' + ptxt + ' jogados</span>' : '') + '</span>';
    const mo = document.createElement('button'); mo.className = 'more'; mo.type = 'button'; mo.setAttribute('aria-label', 'Opções do jogo'); mo.innerHTML = '<svg class="ico"><use href="#i-more"/></svg>';
    mo.onclick = e => { e.stopPropagation(); openGameSheet(it); };
    w.append(b, mo);
    loadCover(it, b.querySelector('img'));
    b.onclick = () => playLib(it);
    // segurar abre as opções
    let lp = 0; b.addEventListener('pointerdown', () => { clearTimeout(lp); lp = setTimeout(() => { lp = -1; openGameSheet(it); }, 520); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => clearTimeout(lp)));
    b.addEventListener('click', e => { if (lp === -1) { lp = 0; e.stopImmediatePropagation(); } }, true);
    b.addEventListener('contextmenu', e => { e.preventDefault(); openGameSheet(it); });
    return w;
  }
  function renderChips() {
    const cons = CONSOLES.filter(c => lib.some(i => i.con === c.id)), box = $('conChips');
    box.hidden = cons.length < 2; if (box.hidden) { libCon = 'all'; return; }
    box.innerHTML = ''; for (const [id, name] of [['all', 'Todos'], ...cons.map(c => [c.id, c.name])]) {
      const b = document.createElement('button'); b.textContent = name; b.className = libCon === id ? 'on' : ''; b.onclick = () => { libCon = id; renderLib(); }; box.appendChild(b);
    }
  }
  function renderLib() {
    const q = $('libQ').value.trim().toLowerCase(), g = $('libGrid'); g.innerHTML = '';
    $('segLib').hidden = !lib.length; $('libEmpty').hidden = !!lib.length || !!libDir; $('libQ').hidden = !lib.length;
    renderChips();
    let items = lib.filter(i => (!q || i.base.toLowerCase().includes(q)) && (libCon === 'all' || i.con === libCon) && (libView !== 1 || mget(mk(i)).fav) && (libView !== 2 || mget(mk(i)).last));
    if (libView === 2) items = items.slice().sort((a, b) => mget(mk(b)).last - mget(mk(a)).last);
    else items = items.slice().sort((a, b) => mget(mk(b)).fav - mget(mk(a)).fav);
    // continuar jogando
    const rec = lib.filter(i => mget(mk(i)).last).sort((a, b) => mget(mk(b)).last - mget(mk(a)).last).slice(0, 8), rr = $('recentRow'); rr.innerHTML = '';
    $('recentWrap').hidden = !rec.length || libView !== 0 || !!q;
    rec.forEach((it, k) => rr.appendChild(mkCard(it, k, true)));
    items.forEach((it, k) => g.appendChild(mkCard(it, k)));
    if (!items.length && lib.length) g.innerHTML = '<p class="hint">' + (libView === 1 ? 'Nenhum favorito ainda. Abra as opções de um jogo (três pontos) e favorite.' : libView === 2 ? 'Você ainda não jogou nada.' : 'Nada com esse nome.') + '</p>';
  }
  async function loadCover(it, img) {
    // 1) imagem do usuário na própria pasta, 2) capas do libretro, 3) cartão gerado (já está por baixo)
    if (it.imgHandle) { try { img.src = it.localUrl || (it.localUrl = URL.createObjectURL(await it.imgHandle.getFile())); img.onload = () => img.classList.add('ok'); return; } catch (e) {} }
    if (it.imgFileObj) { img.src = it.localUrl || (it.localUrl = URL.createObjectURL(it.imgFileObj)); img.onload = () => img.classList.add('ok'); return; }
    const canon = (META[mk(it)] || {}).canon, cands = canon ? [canon, ...coverCandidates(it.base)] : coverCandidates(it.base); let i = 0;
    img.onload = () => img.classList.add('ok');
    img.onerror = () => { if (++i < cands.length) img.src = coverUrl(it.con, cands[i]); };
    img.src = coverUrl(it.con, cands[0]);
  }
  async function itemFile(it) {
    if (it.file) return it.file;
    if (it.stored) { const r = await idb.get('rom:' + it.stored); if (!r) throw new Error('ROM não encontrada'); return new File([r.data], it.name); }
    if (it.handle.queryPermission && await it.handle.queryPermission({ mode: 'read' }) !== 'granted') await it.handle.requestPermission({ mode: 'read' });
    return it.handle.getFile();
  }
  async function playLib(it) {
    try {
      const f = await itemFile(it);
      openConsole(CONSOLES.find(c => c.id === it.con));
      mget(mk(it)).last = Date.now(); msave();
      loadFile(f, mk(it));
    } catch (e) { toast('Não foi possível abrir ' + it.name); }
  }
  async function useDir(dir) {
    libDir = dir; $('libMsg').textContent = 'Lendo a pasta...';
    const items = [], imgs = {};
    try { await scanDir(dir, 0, items, imgs); } catch (e) { $('libMsg').textContent = 'Não foi possível ler a pasta.'; return; }
    applyImgs(items, imgs); setLib(items);
  }
  /* No aplicativo Android (WebView) o seletor de pasta não abre: as ROMs são escolhidas como arquivos e guardadas dentro do app. */
  // No app (WebView) a função showDirectoryPicker pode existir e não abrir nada, então lá ela é ignorada
  const IS_APP = !!window.Capacitor || /; wv\)/.test(navigator.userAgent) || (/Android/i.test(navigator.userAgent) && location.hostname === 'localhost');
  const FILEMODE = IS_APP;
  let storedList = [];
  async function loadStored() {
    try { storedList = (await idb.get('romlist')) || []; } catch (e) { storedList = []; }
    const st = storedList.map(s => ({ name: s.name, base: s.base, con: s.con, stored: s.key, zip: s.zip }));
    setLib(lib.filter(x => !x.stored).concat(st));
  }
  async function describeRom(f) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (EXT2CON[ext]) return { base: libName(f.name), con: EXT2CON[ext], zip: false };
    if (ext === 'zip') { const e = ZIP.find(await ZIP.list(f)); if (e) { const n = e.name.split('/').pop(); return { base: libName(n), con: EXT2CON[n.split('.').pop().toLowerCase()], zip: true }; } }
    return null;
  }
  async function addFiles(files) {
    let ok = 0, bad = 0;
    $('libMsg').textContent = 'Adicionando jogos...';
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    for (const f of files) {
      try {
        const d = await describeRom(f); if (!d) { bad++; continue; }
        const key = d.con + ':' + f.name + ':' + f.size, data = new Uint8Array(await f.arrayBuffer());
        await idb.set('rom:' + key, { name: f.name, data });
        storedList = storedList.filter(s => s.key !== key); storedList.push({ key, name: f.name, base: d.base, con: d.con, zip: d.zip }); ok++;
      } catch (e) { bad++; }
    }
    try { await idb.set('romlist', storedList); } catch (e) { toast('Sem espaço para guardar as ROMs'); }
    await loadStored();
    toast(ok ? ok + (ok === 1 ? ' jogo adicionado' : ' jogos adicionados') + (bad ? ' (' + bad + ' ignorados)' : '') : 'Nenhuma ROM válida (.nes, .sfc, .smc, .gb, .gbc, .gba ou .zip)');
  }
  async function removeStored(it) {
    storedList = storedList.filter(s => s.key !== it.stored);
    try { await idb.set('romlist', storedList); await idb.set('rom:' + it.stored, null); } catch (e) {}
    await loadStored();
  }
  /* ---- pasta nativa (app Android): seletor do sistema via plugin FolderPicker (SAF) ---- */
  const FP = () => window.Capacitor.registerPlugin('FolderPicker');
  let diagLast = '';
  function diagSet(m) { diagLast = m; diagShow(); }
  function diagShow() {
    const el = $('diag'); if (!el) return; const C = window.Capacitor || {};
    let pl = ''; try { pl = C.isPluginAvailable ? C.isPluginAvailable('FolderPicker') : '?'; } catch (e) { pl = 'erro'; }
    el.textContent = ['app: ' + IS_APP, 'Capacitor: ' + !!window.Capacitor + (C.getPlatform ? ' (' + C.getPlatform() + ')' : ''), 'plugin FolderPicker: ' + pl, 'showDirectoryPicker: ' + !!window.showDirectoryPicker, 'origem: ' + location.origin, 'último erro: ' + (diagLast || '-'), navigator.userAgent].join('\n');
  }
  $('bDiag').onclick = async () => { diagShow(); if (!IS_APP) return; try { const r = await FP().list({ uri: 'content://x' }); diagSet('list ok ' + JSON.stringify(r).slice(0, 80)); } catch (e) { diagSet('teste: ' + String(e && (e.message || e.code || e))); } };
  diagShow();
  const NCH = 4 * 1024 * 1024;
  async function nativeFile(n) {
    const parts = [];
    for (let off = 0; ; off += NCH) {
      const r = await FP().read({ uri: n.uri, offset: off, length: NCH });
      parts.push(Uint8Array.from(atob(r.data), c => c.charCodeAt(0))); if (r.n < NCH) break;
    }
    return new File(parts, n.name);
  }
  async function useNative(uri, name) {
    $('libMsg').textContent = 'Lendo a pasta...';
    let files; try { files = (await FP().list({ uri })).files; } catch (e) { $('libMsg').textContent = 'Não foi possível ler a pasta (permissão expirada?). Toque em Escolher pasta de novo.'; throw e; }
    const items = [], imgs = {}, zips = [];
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase(), h = { getFile: () => nativeFile(f) };
      if (EXT2CON[ext]) items.push({ name: f.name, base: libName(f.name), con: EXT2CON[ext], handle: h });
      else if (ext === 'zip' && f.size <= 16 * 1024 * 1024) zips.push({ f, h });
      else if (IMGEXT[ext]) imgs[libName(f.name).toLowerCase()] = h;
    }
    for (let i = 0; i < zips.length; i += 4) await Promise.all(zips.slice(i, i + 4).map(async ({ f, h }) => {
      try { const e = ZIP.find(await ZIP.list(await h.getFile())); if (e) { const n = e.name.split('/').pop(); items.push({ name: f.name, base: libName(n), con: EXT2CON[n.split('.').pop().toLowerCase()], handle: h, zip: true }); } } catch (er) {}
    }));
    applyImgs(items, imgs); libDir = { name }; $('bFolder').textContent = 'Trocar pasta';
    setLib(items.concat(storedList.map(x => ({ name: x.name, base: x.base, con: x.con, stored: x.key, zip: x.zip }))));
  }
  async function pickFolder() {
    if (FILEMODE) {
      try { const r = await FP().pickFolder(); localStorage.setItem('nativedir', JSON.stringify({ uri: r.uri, name: r.name })); await useNative(r.uri, r.name); }
      catch (e) { const m = String(e && (e.message || e.code || e)); diagSet('pickFolder: ' + m); if (!/cancel/i.test(m)) toast('Erro no seletor de pasta: ' + m.slice(0, 120)); }
      return;
    }
    if (window.showDirectoryPicker) {
      try {
        const dir = await showDirectoryPicker({ id: 'emuhub-roms', mode: 'read' });
        try { await idb.set('libdir', dir); } catch (e) {}
        $('bFolder').textContent = 'Trocar pasta'; await useDir(dir);
      } catch (e) { if (e && e.name !== 'AbortError') { toast('Esse aparelho não abriu o seletor de pasta; escolha as ROMs direto'); $('libFiles').click(); } }
    } else $('libInput').click();
  }
  $('libFiles').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await addFiles(fs); };
  $('bFolder').onclick = $('bFolder2').onclick = $('bFolder3').onclick = pickFolder;
  $('bAdd').onclick = () => $('libFiles').click();
  $('libInput').onchange = async e => {
    const files = [...e.target.files], items = [], imgs = {};
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (EXT2CON[ext]) items.push({ name: f.name, base: libName(f.name), con: EXT2CON[ext], file: f });
      else if (ext === 'zip') { try { const e = ZIP.find(await ZIP.list(f)); if (e) { const n = e.name.split('/').pop(); items.push({ name: f.name, base: libName(n), con: EXT2CON[n.split('.').pop().toLowerCase()], file: f, zip: true }); } } catch (er) {} }
      else if (IMGEXT[ext]) imgs[libName(f.name).toLowerCase()] = f;
    }
    if (!items.length) { toast('Esse aparelho não deixou escolher pasta. Escolha as ROMs direto:'); e.target.value = ''; setTimeout(() => $('libFiles').click(), 400); return; }
    for (const it of items) { const im = imgs[it.base.toLowerCase()]; if (im) it.imgFileObj = im; }
    libDir = { name: (files[0] && files[0].webkitRelativePath || '').split('/')[0] || 'pasta' };
    $('bFolder').textContent = 'Trocar pasta'; setLib(items); e.target.value = '';
  };
  $('libQ').oninput = renderLib;
  async function libInit() {
    if (FILEMODE) {
      $('libEmptyTxt').textContent = 'Escolha a pasta onde estão as suas ROMs (.nes, .sfc, .gb, .gbc, .gba ou .zip) ou adicione jogos avulsos. Os arquivos continuam onde estão.';
      await loadStored();
      try { const d = JSON.parse(localStorage.getItem('nativedir') || 'null'); if (d) { $('bFolder').textContent = 'Trocar pasta'; await useNative(d.uri, d.name); } } catch (e) {}
      return;
    }
    await loadStored();
    if (!window.showDirectoryPicker) { $('libMsg').textContent += ' (Este navegador não guarda a pasta; você escolhe de novo a cada visita.)'; return; }
    try {
      const dir = await idb.get('libdir'); if (!dir) return;
      $('bFolder').textContent = 'Trocar pasta';
      if (await dir.queryPermission({ mode: 'read' }) === 'granted') await useDir(dir);
      else {
        libDir = dir; $('libMsg').textContent = 'Pasta salva: ' + dir.name + '. O navegador precisa da sua permissão para ler de novo.';
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Reabrir ' + dir.name; b.id = 'bReopen';
        b.onclick = async () => { try { if (await dir.requestPermission({ mode: 'read' }) === 'granted') { b.remove(); await useDir(dir); } } catch (e) {} };
        $('libMsg').after(b);
      }
    } catch (e) {}
  }

  /* ---------- teclado ---------- */
  const KEYS = {
    KeyX: B.A, KeyK: B.A, KeyZ: B.B, KeyJ: B.B, KeyC: B.X, KeyV: B.Y, KeyQ: B.L, KeyE: B.R,
    Enter: B.START, ShiftLeft: B.SEL, ShiftRight: B.SEL, Backspace: B.SEL,
    ArrowUp: B.UP, ArrowDown: B.DOWN, ArrowLeft: B.LEFT, ArrowRight: B.RIGHT,
    KeyW: B.UP, KeyS: B.DOWN, KeyA: B.LEFT, KeyD: B.RIGHT
  };
  addEventListener('keydown', e => { if (!inPlayer || isField(e.target)) return; if (e.code === 'Tab') { turbo = true; e.preventDefault(); return; } if (e.code === 'KeyR') { rwKbd = true; e.preventDefault(); return; } if (e.code === 'F5') { e.preventDefault(); saveSlot(0); return; } if (e.code === 'F8') { e.preventDefault(); loadSlot(0); return; } const m = KEYS[e.code]; if (m) { kbd |= m; e.preventDefault(); } });
  addEventListener('keyup', e => { if (!inPlayer || isField(e.target)) { if (e.code === 'Tab') turbo = false; return; } if (e.code === 'Tab') { turbo = false; e.preventDefault(); return; } if (e.code === 'KeyR') { rwKbd = false; e.preventDefault(); return; } const m = KEYS[e.code]; if (m) { kbd &= ~m; e.preventDefault(); } });
  addEventListener('blur', () => { kbd = 0; });

  /* ---------- controles de toque (layout por console) ---------- */
  const ld = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
  const sv = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  let hapOn = ld('hub_hap', '1') === '1', hapLvl = +ld('hub_haplvl', '1'), padLvl = +ld('hub_padop', '2');
  const HAP = [5, 10, 22], PADOP = [0.35, 0.65, 1];
  function buzz(ms) { if (hapOn && navigator.vibrate) { try { navigator.vibrate(ms || HAP[hapLvl]); } catch (e) {} } }
  function applyPadOp() { document.documentElement.style.setProperty('--padop', PADOP[padLvl]); }
  applyPadOp();
  $('swHaptic').setAttribute('aria-checked', hapOn);
  $('swHaptic').onclick = () => { hapOn = !hapOn; $('swHaptic').setAttribute('aria-checked', hapOn); sv('hub_hap', hapOn ? '1' : '0'); buzz(); };
  const setHapSeg = buildSeg($('segHaptic'), ['Leve', 'Média', 'Forte'], i => { hapLvl = i; setHapSeg(i); sv('hub_haplvl', i); buzz(); });
  setHapSeg(hapLvl);
  const setPadSeg = buildSeg($('segPad'), ['Discretos', 'Médios', 'Opacos'], i => { padLvl = i; setPadSeg(i); sv('hub_padop', i); applyPadOp(); });
  setPadSeg(padLvl);

  let sizeLvl = +ld('hub_padsz', '1'), lefty = ld('hub_lefty', '0') === '1';
  const PADSZ = [0.82, 1, 1.2];
  function applyPadLayout() { document.documentElement.style.setProperty('--sz', PADSZ[sizeLvl]); $('pad').classList.toggle('lefty', lefty); }
  const setSizeSeg = buildSeg($('segSize'), ['Pequeno', 'Normal', 'Grande'], i => { sizeLvl = i; setSizeSeg(i); sv('hub_padsz', i); applyPadLayout(); });
  setSizeSeg(sizeLvl);
  $('swLeft').setAttribute('aria-checked', lefty);
  $('swLeft').onclick = () => { lefty = !lefty; $('swLeft').setAttribute('aria-checked', lefty); sv('hub_lefty', lefty ? '1' : '0'); applyPadLayout(); };
  applyPadLayout();

  /* tela cheia */
  function toggleFull() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement) { d.exitFullscreen(); return; }
    if (el.requestFullscreen) el.requestFullscreen().then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => toast('Tela cheia não disponível aqui'));
    else toast('Tela cheia não disponível aqui');
  }
  $('bFull').onclick = toggleFull;
  addEventListener('keydown', e => { if (e.code === 'F11' || (e.code === 'KeyF' && inPlayer && !isField(e.target) && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); toggleFull(); } });


  /* ---------- shaders (WebGL) e resolução ---------- */
  const view = $('view');
  let gl = null, glOk = true, glU = {}, glTex = null;
  let shader = 0, resLvl = 3, fitMode = 0, roundPx = 1;
  const SHADERS = ['Sem', 'Pixel', 'Linhas', 'CRT', 'LCD', 'GBA'];
  const SH_INFO = ['Pixels puros, sem processamento.', 'Só escala bem: pixels firmes, sem tremer e sem borrar.', 'Linhas de varredura de TV (scanlines).', 'Tela de tubo: curvatura, linhas, máscara e vinheta.', 'Grade de pixels de LCD, com cores do console portátil.', 'Corrige as cores como a tela do GBA original.'];
  const VS = 'attribute vec2 a;varying vec2 uv;void main(){uv=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  const FS = 'precision mediump float;uniform sampler2D t;uniform vec2 src,res,ts;uniform float mode;varying vec2 uv;' +
    'vec3 gba(vec3 c){c=pow(c,vec3(1.35));return vec3(c.r*.8125+c.g*.125+c.b*.0625,c.g*.75+c.b*.25,c.r*.1875+c.g*.125+c.b*.6875)*1.08;}' +
    'vec2 sh(vec2 u){vec2 p=u*ts,f=floor(p),n=p-f;float k=max(res.x/ts.x,1.);vec2 a=clamp((n-.5)*k+.5,0.,1.);return (f+a)/ts;}' +
    'void main(){vec2 u=uv;vec3 c;' +
    'if(mode==4.){u=uv;c=texture2D(t,sh(u)).rgb;c=gba(c);vec2 g=fract(u*src);float gx=smoothstep(0.,.18,g.x)*smoothstep(1.,.82,g.x),gy=smoothstep(0.,.18,g.y)*smoothstep(1.,.82,g.y);c*=mix(.8,1.,gx*gy)*1.06;}' +
    'else if(mode==5.){c=gba(texture2D(t,sh(u)).rgb);}' +
    'else if(mode==3.){vec2 cc=u*2.-1.;cc*=vec2(1.+cc.y*cc.y*.035,1.+cc.x*cc.x*.05);u=cc*.5+.5;if(u.x<0.||u.x>1.||u.y<0.||u.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}' +
    'c=texture2D(t,sh(u)).rgb;float sl=.5+.5*cos((fract(u.y*src.y)-.5)*6.2831853);c*=mix(.74,1.,pow(sl,.7));float m=mod(floor(gl_FragCoord.x),3.);c*=vec3(m<1.?1.:.93,m>=1.&&m<2.?1.:.93,m>=2.?1.:.93);c*=1.12-.4*dot(cc,cc)*.5;}' +
    'else if(mode==2.){c=texture2D(t,sh(u)).rgb;float sl=.5+.5*cos((fract(u.y*src.y)-.5)*6.2831853);c*=mix(.8,1.,pow(sl,.8))*1.04;}' +
    'else{c=texture2D(t,sh(u)).rgb;}' +
    'gl_FragColor=vec4(min(c,1.),1.);}';
  // Scale2x (EPX): arredonda as quinas dos pixels sem borrar; duas passadas = 4x
  const VS_FBO = VS.replace('.5-a.y*.5', '.5+a.y*.5'); // passes em FBO já guardam a imagem sem inverter
  const FS2 = 'precision mediump float;uniform sampler2D t;uniform vec2 ts;varying vec2 uv;' +
    'vec3 T(vec2 c){return texture2D(t,c/ts).rgb;}' +
    'bool eq(vec3 a,vec3 b){return distance(a,b)<.04;}' +
    'void main(){vec2 p=uv*ts;vec2 c=floor(p)+.5;vec2 q=step(.5,fract(p));' +
    'vec3 E=T(c),B=T(c+vec2(0.,-1.)),D=T(c+vec2(-1.,0.)),F=T(c+vec2(1.,0.)),H=T(c+vec2(0.,1.));vec3 o=E;' +
    'if(!eq(B,H)&&!eq(D,F)){' +
    'if(q.x<.5&&q.y<.5){if(eq(D,B))o=D;}else if(q.x>.5&&q.y<.5){if(eq(B,F))o=F;}else if(q.x<.5){if(eq(D,H))o=D;}else{if(eq(H,F))o=F;}}' +
    'gl_FragColor=vec4(o,1.);}';
  let glP1 = null, glP2 = null, glFbo = null, glFboW = 0, glFboH = 0, glBuf = null;
  function glInit() {
    if (gl) return true; if (!glOk) return false;
    try {
      gl = view.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, alpha: false }); if (!gl) throw 0;
      const mkS = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw 0; return o; };
      const mkP = (fs, vs) => { const p = gl.createProgram(); gl.attachShader(p, mkS(gl.VERTEX_SHADER, vs || VS)); gl.attachShader(p, mkS(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw 0; return p; };
      glP2 = mkP(FS); glP1 = mkP(FS2, VS_FBO);
      glBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      glTex = mkTex();
      const U = (p, n) => gl.getUniformLocation(p, n);
      glU = { src: U(glP2, 'src'), ts: U(glP2, 'ts'), res: U(glP2, 'res'), mode: U(glP2, 'mode'), t: U(glP2, 't'), ts1: U(glP1, 'ts'), t1: U(glP1, 't') };
      gl.useProgram(glP1); gl.uniform1i(glU.t1, 0); gl.useProgram(glP2); gl.uniform1i(glU.t, 0);
      return true;
    } catch (e) { gl = null; glOk = false; shader = 0; applyShaderMode(); refreshVideoPanels(); toast('Shaders não funcionam neste aparelho'); return false; }
  }
  function mkTex(w, h) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  // 2 alvos de renderização: 2x e 4x do tamanho original
  function ensureFbo(w, h) {
    if (glFbo && glFboW === w && glFboH === h) return;
    if (glFbo) glFbo.forEach(f => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
    glFbo = [2, 4].map(k => { const tex = mkTex(w * k, h * k), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return { fb, tex, w: w * k, h: h * k }; });
    glFboW = w; glFboH = h; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function viewSize() {
    const w = canvas.width, h = canvas.height;
    let k = [1, 2, 4][resLvl];
    if (!k) { const st = $('stage'); k = Math.ceil(Math.max(st.clientWidth, 1) * (window.devicePixelRatio || 1) / w); if (shader >= 2) k = Math.max(k, 3); }
    k = Math.max(1, Math.min(k, 8, Math.floor(2048 / w) || 1));
    if (view.width !== w * k || view.height !== h * k) { view.width = w * k; view.height = h * k; }
    return k;
  }
  function present() {
    ctx.putImageData(img, 0, 0);
    if (!shader || !glInit()) return;
    const k = viewSize(), w = canvas.width, h = canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    let tex = glTex, tw = w, th = h;
    if (roundPx) {
      ensureFbo(w, h);
      const passes = k >= 3 ? 2 : 1;
      gl.useProgram(glP1);
      for (let i = 0; i < passes; i++) {
        const f = glFbo[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb); gl.viewport(0, 0, f.w, f.h);
        gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform2f(glU.ts1, tw, th);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        tex = f.tex; tw = f.w; th = f.h;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.useProgram(glP2);
    gl.viewport(0, 0, view.width, view.height);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform2f(glU.src, w, h); gl.uniform2f(glU.ts, tw, th); gl.uniform2f(glU.res, view.width, view.height); gl.uniform1f(glU.mode, shader);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function applyShaderMode() {
    canvas.style.display = shader ? 'none' : ''; view.hidden = !shader;
    if (img) present();
  }

  /* ---------- perfil de vídeo (padrão geral + por jogo) ---------- */
  const VDEF0 = { shader: 1, res: 3, fit: 0, filter: 0, round: 1 };
  let VDEF = Object.assign({}, VDEF0); try { Object.assign(VDEF, JSON.parse(localStorage.getItem('hub_viddef') || 'null') || {}); } catch (e) {}
  const vidOf = key => Object.assign({}, VDEF, key && META[key] && META[key].vid || {});
  function applyVideo(p) {
    shader = p.shader; resLvl = p.res; fitMode = p.fit; filter = p.filter; roundPx = p.round;
    applyFilter(); applyShaderMode(); layoutStage();
  }
  const VLAB = { shader: SHADERS, res: ['Nativa', '2x', '4x', 'Auto'], fit: ['Proporcional', 'Pixel perfeito', 'Esticar'], filter: ['Pixels nítidos', 'Suavizado'], round: ['Retas', 'Arredondadas'] };
  const VTIT = { shader: 'Shader', res: 'Resolução interna (vale para os shaders)', fit: 'Ajuste na tela', filter: 'Escala sem shader', round: 'Quinas dos pixels (vale para os shaders)' };
  const panels = [];
  function makeVideoPanel(get, set, reset) {
    const el = document.createElement('div'); el.className = 'vidp'; const setters = {};
    for (const f of ['shader', 'round', 'res', 'fit', 'filter']) {
      const p = document.createElement('p'); p.className = 'hint'; p.style.margin = '12px 0 6px'; if (f === 'shader') p.style.marginTop = '0'; p.textContent = VTIT[f];
      const sg = document.createElement('div'); sg.className = 'seg'; el.append(p, sg);
      setters[f] = buildSeg(sg, VLAB[f], i => { set(f, i); refresh(); });
    }
    const hint = document.createElement('p'); hint.className = 'hint'; el.appendChild(hint);
    if (reset) { const r = document.createElement('div'); r.className = 'row'; const bt = document.createElement('button'); bt.className = 'btn'; bt.textContent = 'Usar o padrão geral'; bt.onclick = () => { reset(); refresh(); }; r.appendChild(bt); el.appendChild(r); }
    function refresh() { const p = get(); for (const f in setters) setters[f](p[f]); hint.textContent = SH_INFO[p.shader] || ''; }
    refresh(); const o = { el, refresh }; panels.push(o); return o;
  }
  const refreshVideoPanels = () => panels.forEach(p => p.refresh());
  let vidTarget = null; // chave do jogo que o painel por jogo está editando
  const defPanel = makeVideoPanel(() => VDEF, (f, v) => { VDEF[f] = v; sv('hub_viddef', JSON.stringify(VDEF)); if (inPlayer && loaded && curKey) applyVideo(vidOf(curKey)); });
  $('vidDefHost').appendChild(defPanel.el);
  const gamePanel = makeVideoPanel(() => vidOf(vidTarget), (f, v) => {
    const m = mget(vidTarget); m.vid = Object.assign({}, m.vid || {}, { [f]: v }); msave();
    if (inPlayer && loaded && vidTarget === curKey) applyVideo(vidOf(curKey));
  }, () => { const m = mget(vidTarget); delete m.vid; msave(); if (inPlayer && loaded && vidTarget === curKey) applyVideo(vidOf(curKey)); });
  function layoutStage() {
    const st = $('stage'); st.style.width = st.style.height = '';
    if (!canvas.width || !core) return;
    const w = canvas.width, h = canvas.height, vw = innerWidth, vh = innerHeight, arn = w / h;
    const land = matchMedia('(orientation:landscape)').matches;
    const H = land ? vh - 56 : vh * 0.5, W = land ? Math.min(vw, H * arn) : Math.min(vw, H * arn);
    if (fitMode === 2) { st.style.width = vw + 'px'; st.style.height = H + 'px'; }
    else if (fitMode === 1) { const k = Math.floor(Math.min(W / w, H / h)); if (k >= 1) { st.style.width = k * w + 'px'; st.style.height = k * h + 'px'; } }
    if (img && shader) present();
  }
  addEventListener('resize', layoutStage); addEventListener('orientationchange', () => setTimeout(layoutStage, 200));


  /* ---------- identificar jogo pelo hash (DAT do libretro) e importar cheats ---------- */
  const DATSYS = { nes: 'Nintendo - Nintendo Entertainment System', snes: 'Nintendo - Super Nintendo Entertainment System', gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color', sms: 'Sega - Master System - Mark III', gg: 'Sega - Game Gear', gba: 'Nintendo - Game Boy Advance' };
  const RAW = 'https://raw.githubusercontent.com/libretro/libretro-database/master/';
  const CDN = 'https://cdn.jsdelivr.net/gh/libretro/libretro-database@master/';
  async function repoFetch(path) { // tenta o GitHub direto e, se falhar, o jsDelivr
    let r; try { r = await fetch(RAW + path); if (r.ok) return r; } catch (e) {}
    try { const r2 = await fetch(CDN + path); if (r2.ok || !r) return r2; } catch (e) {}
    if (!r) throw new Error('Sem conexão com a lista online'); return r;
  }
  const gbSys = u8 => (u8 && u8[0x143] & 0x80) ? 'gbc' : 'gb';
  const datMem = {};
  async function datMap(con) {
    if (datMem[con]) return datMem[con];
    try { const c = await idb.get('dat_' + con); if (c) return datMem[con] = c; } catch (e) {}
    const r = await repoFetch('metadat/no-intro/' + encodeURIComponent(DATSYS[con]) + '.dat'); if (!r.ok) throw new Error('Não consegui baixar a lista de jogos (' + r.status + ')');
    const txt = await r.text(), map = {}, re = /\bgame\s*\(\s*name "([^"]+)"[\s\S]*?\brom \( name "[^"]*" size \d+ crc ([0-9A-Fa-f]{8})/g; let m;
    while ((m = re.exec(txt))) map[m[2].toUpperCase()] = m[1];
    if (!Object.keys(map).length) throw new Error('Lista de jogos em formato inesperado');
    try { await idb.set('dat_' + con, map); } catch (e) {}
    return datMem[con] = map;
  }
  function romCrc(con, u8) {
    let s = 0;
    if (con === 'nes' && u8[0] === 0x4E && u8[1] === 0x45 && u8[2] === 0x53 && u8[3] === 0x1A) s = 16;
    else if (con === 'snes' && u8.length % 1024 === 512) s = 512;
    return crc32(s ? u8.subarray(s) : u8).toString(16).toUpperCase().padStart(8, '0');
  }
  async function identify(con, u8) {
    const crc = romCrc(con, u8), tries = con === 'gb' ? [gbSys(u8), gbSys(u8) === 'gb' ? 'gbc' : 'gb'] : [con];
    for (const t of tries) { const n = (await datMap(t))[crc]; if (n) return n; }
    return null;
  }
  let chtIdx = null;
  async function chtIndex() {
    if (chtIdx) return chtIdx;
    const bin = Uint8Array.from(atob('/*CHTIDX*/'), c => c.charCodeAt(0));
    const ds = new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip')));
    return chtIdx = JSON.parse(await ds.text());
  }
  const chtBase = n => n.replace(/\s*[\(\[].*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const chtRegions = n => { const m = n.match(/\(([^)]*)\)/); return m ? m[1].toLowerCase().split(/[,\s]+/).filter(Boolean) : []; };
  // acha os arquivos .cht do mesmo jogo (o nome do arquivo nem sempre é igual ao nome do DAT: variantes Game Genie / Action Replay / GameShark)
  async function chtFiles(sys, canon) {
    const list = (await chtIndex())[sys] || [], b = chtBase(canon);
    if (list.includes(canon)) { const ex = [canon]; for (const f of list) if (f !== canon && chtBase(f) === b && f.startsWith(canon) && ex.length < 6) ex.push(f); return ex; }
    let c = list.filter(f => chtBase(f) === b && !/rumbles/i.test(f)); if (!c.length) c = list.filter(f => chtBase(f) === b);
    const reg = chtRegions(canon), same = c.filter(f => chtRegions(f).some(r => reg.includes(r) || r === 'world'));
    return (same.length ? same : c).slice(0, 6);
  }
  const decodeEnt = t => { const x = document.createElement('textarea'); x.innerHTML = t; return x.value; };
  $('gmIdent').onclick = async () => {
    const it = gameItemOpen; if (!it) return; $('gmIdent').disabled = true; $('gmIdent').textContent = 'Identificando...';
    try {
      const { u8 } = await romBytes(await itemFile(it)), name = await identify(it.con, u8);
      if (name) { mget(mk(it)).canon = name; msave(); renderLib(); $('shTitle').textContent = name; toast('Identificado: ' + name); }
      else toast('Jogo não encontrado na lista (pode ser hack, tradução ou dump diferente)');
    } catch (e) { toast(e.message || 'Falha ao identificar'); }
    $('gmIdent').disabled = false; $('gmIdent').textContent = 'Identificar jogo';
  };
  $('chImport').onclick = async () => {
    if (!core || !loaded || !lastRom || !core.parseCheat) { toast('Carregue uma ROM primeiro'); return; }
    const bt = $('chImport'); bt.disabled = true; bt.textContent = 'Buscando...';
    try {
      const m = mget(curKey); if (!m.canon) { m.canon = await identify(cur.id, lastRom); msave(); }
      if (!m.canon) throw new Error('Jogo não identificado, então não sei qual lista de cheats usar');
      const sys = cur.id === 'gb' ? gbSys(lastRom) : cur.id, files = await chtFiles(sys, m.canon);
      if (!files.length) throw new Error('Ainda não existe lista de cheats para "' + m.canon + '"');
      let ok = 0, total = 0, got = 0;
      for (const f of files) {
        let r; try { r = await repoFetch('cht/' + encodeURIComponent(DATSYS[sys]) + '/' + encodeURIComponent(f) + '.cht'); } catch (e) { continue; }
        if (!r.ok) continue; got++;
        const tag = (f.match(/\((Game Genie|Action Replay|GameShark|Rumbles)\)/i) || [])[1], ent = {};
        for (const mm of (await r.text()).matchAll(/^cheat(\d+)_(desc|code)\s*=\s*"([^"]*)"/gm)) (ent[mm[1]] = ent[mm[1]] || {})[mm[2]] = mm[3];
        for (const k in ent) {
          const e = ent[k]; if (!e.code) continue; total++;
          const code = e.code.replace(/\s*\+\s*/g, '\n').trim();
          if (cheats.some(c => c.code === code)) continue;
          try { core.parseCheat(code); cheats.push({ name: decodeEnt(e.desc || 'Cheat ' + (cheats.length + 1)) + (tag ? ' [' + tag + ']' : ''), code, on: false }); ok++; } catch (er) {}
        }
      }
      if (!got) throw new Error('Não consegui baixar a lista de cheats (sem internet?)');
      saveCheats(); pushCheats(); renderCheats();
      toast(ok ? ok + ' de ' + total + ' cheats importados (desligados; ligue os que quiser)' : 'Nenhum cheat compatível (' + total + ' encontrados em formato não suportado)');
    } catch (e) { toast(e.message || 'Falha ao importar'); }
    bt.disabled = false; bt.textContent = 'Importar cheats do libretro';
  };

  /* ---------- backup ---------- */
  $('bExport').onclick = async () => {
    try {
      const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== 'gba_bios') ls[k] = localStorage.getItem(k); }
      const rows = await idb.all(), db = {};
      for (const [k, v] of rows) { if (k === 'libdir' || String(k).startsWith('dat_') || String(k).startsWith('rom:') || k === 'romlist') continue; db[k] = v && v.data instanceof Uint8Array ? Object.assign({}, v, { data: b64(v.data), _u8: 1 }) : v; }
      const blob = new Blob([JSON.stringify({ app: 'emu-hub', v: 1, t: Date.now(), ls, db })], { type: 'application/json' });
      const fname = 'emu-hub-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      const file = new File([blob], fname, { type: 'application/json' });
      if (FILEMODE && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Backup do Emu Hub' }); toast('Backup pronto para salvar'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Backup exportado');
    } catch (e) { toast('Não foi possível exportar: ' + e.message); }
  };
  $('bImport').onclick = () => $('fileBackup').click();
  $('fileBackup').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (d.app !== 'emu-hub' || d.v !== 1) throw new Error('Arquivo não é um backup do Emu Hub');
      let n = 0;
      for (const k in d.ls) { localStorage.setItem(k, d.ls[k]); n++; }
      for (const k in d.db) { const v = d.db[k]; if (v && v._u8) { v.data = unb64(v.data); delete v._u8; } await idb.set(k, v); n++; }
      try { META = JSON.parse(localStorage.getItem('hub_meta') || '{}') || {}; } catch (er) {}
      toast(n + ' itens restaurados. Recarregando...'); setTimeout(() => location.reload(), 1200);
    } catch (er) { toast('Backup inválido: ' + er.message); }
  };

  /* ---------- tela ligada, gravação de vídeo, PWA ---------- */
  let wakeOn = ld('hub_wake', '1') === '1', wlock = null;
  $('swWake').setAttribute('aria-checked', wakeOn);
  $('swWake').onclick = () => { wakeOn = !wakeOn; $('swWake').setAttribute('aria-checked', wakeOn); sv('hub_wake', wakeOn ? '1' : '0'); wakeUpdate(); };
  async function wakeUpdate() {
    const want = wakeOn && inPlayer && loaded && !paused && !document.hidden;
    if (want && !wlock && navigator.wakeLock) { try { wlock = await navigator.wakeLock.request('screen'); wlock.addEventListener('release', () => { wlock = null; }); } catch (e) {} }
    else if (!want && wlock) { try { wlock.release(); } catch (e) {} wlock = null; }
  }
  setInterval(wakeUpdate, 2000); document.addEventListener('visibilitychange', wakeUpdate);
  let rec = null, recDest = null;
  $('bRec').onclick = () => {
    if (rec) { rec.stop(); return; }
    if (!core || !loaded) { toast('Carregue uma ROM primeiro'); return; }
    const src = shader ? view : canvas;
    if (!src.captureStream || !window.MediaRecorder) { toast('Este navegador não grava vídeo'); return; }
    const stream = src.captureStream(60);
    if (actx && audioNode) { if (!recDest) { recDest = actx.createMediaStreamDestination(); audioNode.connect(recDest); } recDest.stream.getAudioTracks().forEach(t => stream.addTrack(t)); }
    const mt = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)), chunks = [];
    try { rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 8e6 }); } catch (e) { toast('Não foi possível iniciar a gravação'); return; }
    rec.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => {
      const b = new Blob(chunks, { type: mt }), a = document.createElement('a'); a.href = URL.createObjectURL(b);
      a.download = 'gravacao-' + (cur ? cur.id : 'jogo') + '-' + Date.now() + (mt.includes('mp4') ? '.mp4' : '.webm'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      rec = null; $('bRec').textContent = 'Gravar vídeo'; toast('Gravação salva');
    };
    rec.start(1000); $('bRec').textContent = 'Parar gravação'; toast('Gravando... abra o menu de novo para parar');
  };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* gaveta: modo ferramentas / ajustes */
  let setMode = false;
  function showSheetMode(mode) {
    $('shTools').hidden = mode !== 'tools'; $('shGame').hidden = mode !== 'game'; $('shSetHost').hidden = mode !== 'set';
    if (mode === 'set') { $('shSetHost').appendChild($('setPage')); renderGpMap(); } else $('tabSet').appendChild($('setPage'));
    if (mode === 'tools') { vidTarget = curKey; gamePanel.refresh(); $('vidToolsHost').appendChild(gamePanel.el); }
    if (mode === 'game') { gamePanel.refresh(); $('vidLibHost').appendChild(gamePanel.el); }
    $('shTitle').textContent = mode === 'set' ? 'Ajustes gerais' : mode === 'game' ? 'Opções do jogo' : 'Menu do jogo';
  }
  $('bSet').onclick = () => showSheetMode('set');

  /* ---------- abas da tela inicial ---------- */
  function showTab(id) {
    for (const t of ['tabLib', 'tabCon', 'tabSet']) $(t).hidden = t !== id;
    document.querySelectorAll('#tabs .tb').forEach(b => b.classList.toggle('on', b.dataset.t === id));
    $('tabsBody').scrollTop = 0; sv('hub_tab', id); if (id === 'tabSet') renderGpMap();
  }
  document.querySelectorAll('#tabs .tb').forEach(b => b.onclick = () => showTab(b.dataset.t));

  /* ---------- opções do jogo (biblioteca) ---------- */
  function openGameSheet(it) {
    gameItemOpen = it; vidTarget = mk(it);
    openSheet('game');
    const m = mget(vidTarget), c = CONSOLES.find(x => x.id === it.con);
    $('shTitle').textContent = vTitle(it);
    $('gmInfo').textContent = c.name + (m.sec >= 60 ? ' · ' + fmtTime(m.sec) + ' jogados' : '') + (m.last ? ' · último: ' + new Date(m.last).toLocaleDateString('pt-BR') : '');
    $('gmFav').textContent = m.fav ? 'Remover dos favoritos' : 'Favoritar';
    $('gmDel').hidden = !it.stored;
  }
  $('gmDel').onclick = async () => { const it = gameItemOpen; if (!it || !confirm('Remover "' + it.base + '" do aplicativo? (Saves e estados ficam guardados.)')) return; closeSheet(true); await removeStored(it); toast('Jogo removido'); };
  $('gmPlay').onclick = () => { const it = gameItemOpen; closeSheet(true); if (it) playLib(it); };
  $('gmFav').onclick = () => { const m = mget(vidTarget); m.fav = m.fav ? 0 : 1; msave(); $('gmFav').textContent = m.fav ? 'Remover dos favoritos' : 'Favoritar'; renderLib(); };
  $('gmClear').onclick = () => { const m = mget(vidTarget); m.last = 0; m.sec = 0; msave(); $('gmInfo').textContent = ''; renderLib(); toast('Histórico zerado'); };
  $('bClearHist').onclick = () => { if (!confirm('Zerar o histórico e o tempo de jogo de todos os jogos? (Favoritos e ajustes de vídeo ficam.)')) return; for (const k in META) { META[k].last = 0; META[k].sec = 0; } msave(); renderLib(); toast('Histórico zerado'); };

  /* botões de ação: um único tratador no #pad, assim o dedo pode deslizar de um botão para outro sem levantar */
  const held = new Map(); // pointerId -> botão sob o dedo
  const BTNBITS = ~DPAD;
  function syncBtns() {
    let m = 0; const on = new Set();
    for (const b of held.values()) if (b) { m |= b._mask; on.add(b); }
    touch = (touch & ~BTNBITS) | (m & BTNBITS);
    for (const b of $('pad').querySelectorAll('button')) b.classList.toggle('on', on.has(b));
  }
  const btnAt = (x, y) => { const e = document.elementFromPoint(x, y), b = e && e.closest && e.closest('#pad button'); return b && b._mask ? b : null; };
  function bindBtn(el, mask) {
    el._mask = mask;
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  { const pd = $('pad');
    pd.addEventListener('pointerdown', e => {
      if (editPad) return; const b = e.target.closest && e.target.closest('button'); if (!b || !b._mask) return;
      e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) {}
      held.set(e.pointerId, b); syncBtns(); buzz();
    });
    pd.addEventListener('pointermove', e => {
      if (editPad || !held.has(e.pointerId)) return;
      const b = btnAt(e.clientX, e.clientY), cur = held.get(e.pointerId);
      if (b === cur) return;
      held.set(e.pointerId, b); if (b) buzz(); // fora de qualquer botão: o dedo continua sendo seguido (null)
      syncBtns();
    });
    const end = e => { if (!held.has(e.pointerId)) return; held.delete(e.pointerId); syncBtns(); buzz(4); };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => pd.addEventListener(t, end));
  }
  function tilt(dp, m) {
    const ry = ((m & B.RIGHT) ? 1 : 0) - ((m & B.LEFT) ? 1 : 0), rx = ((m & B.UP) ? 1 : 0) - ((m & B.DOWN) ? 1 : 0);
    dp.style.setProperty('--rx', rx * 11 + 'deg'); dp.style.setProperty('--ry', ry * 11 + 'deg');
    if (m || ry || rx) dp.setAttribute('data-p', ''); else dp.removeAttribute('data-p');
  }
  function bindDpad(dp) {
    let ptr = null;
    const update = e => {
      const r = dp.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const th = 0.28; let m = 0;
      if (dx < -th) m |= B.LEFT; if (dx > th) m |= B.RIGHT; if (dy < -th) m |= B.UP; if (dy > th) m |= B.DOWN;
      if ((touch & DPAD) !== m) buzz(); touch = (touch & ~DPAD) | m; tilt(dp, m);
    };
    dp.addEventListener('pointerdown', e => { if (editPad) return; e.preventDefault(); ptr = e.pointerId; try { dp.setPointerCapture(e.pointerId); } catch (_) {} update(e); });
    dp.addEventListener('pointermove', e => { if (e.pointerId === ptr) update(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => dp.addEventListener(t, e => { if (e.pointerId === ptr) { ptr = null; touch &= ~DPAD; tilt(dp, 0); } }));
    dp.addEventListener('contextmenu', e => e.preventDefault());
  }
  const mkDiv = cls => { const e = document.createElement('div'); e.className = cls; return e; };
  const mkBtn = (cls, txt, mask) => { const e = document.createElement('button'); e.className = cls; e.textContent = txt; bindBtn(e, mask); return e; };

  /* posição dos botões (editável): deslocamentos em vw/vh, separados por orientação */
  let PADPOS = {}; try { PADPOS = JSON.parse(localStorage.getItem('hub_padpos') || '{}') || {}; } catch (e) {}
  let editPad = false;
  const padOri = () => matchMedia('(orientation:landscape)').matches ? 'l' : 'p';
  const padKey = el => el.classList.contains('dpad') ? 'dpad' : el.classList.contains('face') ? 'face' : el.classList.contains('sys') ? 'sys' : el.classList.contains('l') ? 'L' : 'R';
  function applyPadPos() {
    const o = PADPOS[padOri()] || {};
    for (const el of $('pad').children) { const p = o[padKey(el)] || [0, 0]; el.style.setProperty('--dx', p[0] + 'vw'); el.style.setProperty('--dy', p[1] + 'vh'); }
  }
  addEventListener('resize', () => { if (core) applyPadPos(); });
  function setEditPad(on) {
    editPad = on; document.body.classList.toggle('editpad', on); $('padEdit').hidden = !on; touch = 0; held.clear();
    if (!on) { sv('hub_padpos', JSON.stringify(PADPOS)); applyPadPos(); }
  }
  $('bMovePad').onclick = () => { closeSheet(true); setEditPad(true); };
  $('peDone').onclick = () => setEditPad(false);
  $('peReset').onclick = () => { delete PADPOS[padOri()]; applyPadPos(); };
  { let drag = null;
    $('pad').addEventListener('pointerdown', e => {
      if (!editPad) return; const el = e.target.closest('#pad > *'); if (!el) return;
      e.preventDefault(); e.stopPropagation(); const p = (PADPOS[padOri()] || {})[padKey(el)] || [0, 0];
      drag = { el, id: e.pointerId, x: e.clientX, y: e.clientY, p0: p.slice() }; try { $('pad').setPointerCapture(e.pointerId); } catch (er) {}
    }, true);
    $('pad').addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const nx = drag.p0[0] + (e.clientX - drag.x) / innerWidth * 100, ny = drag.p0[1] + (e.clientY - drag.y) / innerHeight * 100;
      const o = PADPOS[padOri()] || (PADPOS[padOri()] = {}); o[padKey(drag.el)] = [+nx.toFixed(2), +ny.toFixed(2)]; applyPadPos();
    });
    ['pointerup', 'pointercancel'].forEach(t => $('pad').addEventListener(t, e => { if (drag && e.pointerId === drag.id) drag = null; }));
  }
  function buildPad(layout) {
    const pad = $('pad'); pad.innerHTML = ''; touch = 0; held.clear();
    const dp = mkDiv('dpad'); dp.innerHTML = '<span class="dpc"><i></i></span>'; bindDpad(dp); pad.appendChild(dp);
    const face = mkDiv('face ' + layout);
    if (layout === 'snes') face.append(mkBtn('rnd fx', 'X', B.X), mkBtn('rnd fy', 'Y', B.Y), mkBtn('rnd fa', 'A', B.A), mkBtn('rnd fb', 'B', B.B));
    else face.append(mkBtn('rnd two b', 'B', B.B), mkBtn('rnd two a', 'A', B.A));
    pad.appendChild(face);
    if (layout !== 'nes' && layout !== 'gb' && layout !== 'sms' && layout !== 'gg') pad.append(mkBtn('shoulder l', 'L', B.L), mkBtn('shoulder r', 'R', B.R));
    const sys = mkDiv('sys'); if (layout === 'sms') sys.append(mkBtn('sysbtn', 'PAUSE', B.START)); else if (layout === 'gg') sys.append(mkBtn('sysbtn', 'START', B.START)); else sys.append(mkBtn('sysbtn', 'SELECT', B.SEL), mkBtn('sysbtn', 'START', B.START));
    pad.appendChild(sys);
    applyPadPos();
  }

  /* ---------- gamepad ---------- */
  /* mapeamento do controle */
  const GPDEF = { [B.A]: 0, [B.B]: 1, [B.X]: 2, [B.Y]: 3, [B.L]: 4, [B.R]: 5, [B.SEL]: 8, [B.START]: 9 };
  const GPNAMES = [[B.A, 'A'], [B.B, 'B'], [B.X, 'X'], [B.Y, 'Y'], [B.L, 'L'], [B.R, 'R'], [B.SEL, 'Select'], [B.START, 'Start']];
  let GPMAP = Object.assign({}, GPDEF);
  try { const s = JSON.parse(localStorage.getItem('hub_gpmap') || 'null'); if (s) GPMAP = s; } catch (e) {}
  const GPLBL = i => 'Botão ' + i;
  let gpWait = null;
  function renderGpMap() {
    const box = $('gpMap'); box.innerHTML = '';
    for (const [m, n] of GPNAMES) {
      const b = document.createElement('button'); b.type = 'button';
      b.className = gpWait === m ? 'wait' : ''; b.innerHTML = '<span>' + n + '</span><b>' + (gpWait === m ? '...' : GPLBL(GPMAP[m])) + '</b>';
      b.onclick = () => { gpWait = gpWait === m ? null : m; renderGpMap(); $('gpHint').textContent = gpWait ? 'Aperte o botão do controle para ' + n + '.' : 'Toque num botão da lista e aperte o botão do controle que você quer usar nele.'; };
      box.appendChild(b);
    }
  }
  $('gpReset').onclick = () => { GPMAP = Object.assign({}, GPDEF); gpWait = null; sv('hub_gpmap', JSON.stringify(GPMAP)); renderGpMap(); };
  function gpCapture() {
    if (gpWait === null) return;
    for (const g of (navigator.getGamepads ? navigator.getGamepads() : [])) {
      if (!g) continue;
      for (let i = 0; i < g.buttons.length; i++) if (g.buttons[i].pressed && i !== 6 && i !== 7 && i !== 12 && i !== 13 && i !== 14 && i !== 15) {
        GPMAP[gpWait] = i; gpWait = null; sv('hub_gpmap', JSON.stringify(GPMAP)); renderGpMap(); $('gpHint').textContent = 'Pronto. Mapeado.'; return;
      }
    }
  }
  setInterval(() => { if (gpWait !== null) gpCapture(); }, 60);

  function pollPad() {
    gpad = 0; rwPad = false; if (padTurbo) { padTurbo = false; turbo = false; }
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of gps) {
      if (!g) continue;
      const b = i => g.buttons[i] && g.buttons[i].pressed;
      for (const k in GPMAP) if (b(GPMAP[k])) gpad |= +k;
      if (b(7)) { turbo = true; padTurbo = true; }
      rwPad = !!b(6);
      if (b(12) || g.axes[1] < -0.5) gpad |= B.UP; if (b(13) || g.axes[1] > 0.5) gpad |= B.DOWN;
      if (b(14) || g.axes[0] < -0.5) gpad |= B.LEFT; if (b(15) || g.axes[0] > 0.5) gpad |= B.RIGHT;
      break;
    }
  }

  /* ---------- loop principal ---------- */
  const drain = new Float32Array(1024); let frameMs = 4, spFrames = 0, spT = 0, spReal = 0;
  function stepFrame() { const t = performance.now(); core.runFrame(); frameMs = frameMs * 0.95 + (performance.now() - t) * 0.05; if (rewindOn && speed === 1 && !turbo) rewindCapture(); }
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!core || !loaded || paused) { last = ts; spT = 0; spReal = 0; spFrames = 0; return; }
    pollPad();
    core.setButtons(kbd | touch | gpad);
    let frames = 0;
    const au = core.audio, sp = (turbo && speed < 4) ? 4 : speed;
    if (core.setTurbo) core.setTurbo(sp !== 1 || isRewinding());
    if (isRewinding()) {
      rwAcc += Math.min(ts - last, 100);
      if (rwAcc >= 33) { rwAcc = 0; if (rewindRing.length) { core.loadState(rewindRing.pop()); core.runFrame(); frames = 1; } }
      if (au) while (au.buffered() > 2048) au.fill(drain);
    } else if (sp !== 1) {
      // roda os quadros devidos até estourar ~11 ms por ciclo da tela; só o último quadro do lote é desenhado
      acc += Math.min(ts - last, 100) * sp;
      const want = Math.min(Math.floor(acc / 16.64), 16), t0 = performance.now();
      let done = 0;
      let skipped = false;
      while (done < want) {
        skipped = !!core.setSkip && done < want - 1;
        if (core.setSkip) core.setSkip(skipped);
        stepFrame(); done++; frames++;
        if (performance.now() - t0 > 11) break;
      }
      if (core.setSkip) core.setSkip(false);
      if (skipped) { stepFrame(); done++; frames++; } // o último quadro do lote sempre é desenhado (senão a imagem congela)
      acc = Math.min(acc - done * 16.64, 33);
      if (au) while (au.buffered() > 2048) au.fill(drain);
    } else if (au && actx && actx.state === 'running') {
      while (au.buffered() < 3072 && frames < 3) { stepFrame(); frames++; }
    } else {
      acc += Math.min(ts - last, 100);
      while (acc >= 16.64 && frames < 3) { stepFrame(); acc -= 16.64; frames++; }
      if (frames === 3) acc = 0;
    }
    // velocidade real alcançada (quadros emulados por segundo / 60), medida a cada ~1 s
    spFrames += frames;
    if (!spT) { spT = ts; spFrames = 0; }
    else if (ts - spT >= 1000) {
      spReal = spFrames * 1000 / (ts - spT) / 60; spFrames = 0; spT = ts;
    }
    const slow = !isRewinding() && spReal > 0 && spReal < sp * 0.9;
    $('badge').textContent = (sp !== 1 ? sp + 'x' : '') + (slow ? (sp !== 1 ? ' (real ' : 'lento ') + spReal.toFixed(1) + 'x, ' + frameMs.toFixed(1) + ' ms/quadro' + (sp !== 1 ? ')' : '') : '');
    $('badge').classList.toggle('on', sp !== 1 || slow);
    last = ts;
    if (frames) { img32.set(core.frame); present(); }
  }

  renderHome();
  { const t = ld('hub_tab', 'tabLib'); if (['tabLib', 'tabCon', 'tabSet'].includes(t)) showTab(t); }
  libInit();
  requestAnimationFrame(loop);
})();
