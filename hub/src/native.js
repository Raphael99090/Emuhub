/* Motor nativo C++/WebAssembly (opcional). O hub continua com os núcleos JavaScript como padrão e reserva:
 * se o módulo não existir (ou a opção estiver desligada) tudo funciona como antes. */
const Native = {
  mod: null, ready: false, failed: false, p: null, CON: { nes: 0, gb: 1, snes: 2 },
  enabled() { try { return localStorage.getItem('hub_native') === '1'; } catch (e) { return false; } },
  supports(id) { return this.ready && this.CON[id] !== undefined; },
  init() {
    if (this.p) return this.p;
    this.p = new Promise((res, rej) => {
      const go = () => EmuHubCoreModule({ locateFile: f => new URL(f, document.baseURI).href }).then(m => {
        if (m._emuhub_abi_version() < 4) throw new Error('Módulo nativo desatualizado');
        this.mod = m; this.ready = true; res(m);
      }, rej);
      if (typeof EmuHubCoreModule === 'function') return go();
      const s = document.createElement('script'); s.src = new URL('emuhub-core.js', document.baseURI).href; s.async = true;
      s.onload = () => (typeof EmuHubCoreModule === 'function' ? go() : rej(new Error('Módulo nativo inválido')));
      s.onerror = () => rej(new Error('Módulo nativo não encontrado'));
      document.head.appendChild(s);
    }).catch(e => { this.failed = true; this.ready = false; throw e; });
    return this.p;
  }
};

class NativeCore {
  constructor(id, name) {
    const m = Native.mod; this.m = m; this.id = id; this.name = name; this.native = true; this.ready = false;
    if (m._emuhub_select_console(Native.CON[id]) !== 0) throw new Error('Console não suportado pelo módulo nativo');
    this.ring = new Float32Array(32768); this.rp = 0; this.wp = 0; this.romHash = 0;
    this.audio = {
      setSampleRate: r => m._emuhub_set_audio_sample_rate(r),
      setVolume: v => m._emuhub_set_audio_volume(v),
      buffered: () => this.wp - this.rp,
      fill: out => {
        for (let i = 0; i < out.length; i++) {
          if (this.rp < this.wp) { this.last = this.ring[this.rp & 32767]; this.rp++; } else this.last = (this.last || 0) * 0.995;
          out[i] = this.last;
        }
      }
    };
  }
  get width() { return this.m._emuhub_video_width(); }
  get height() { return this.m._emuhub_video_height(); }
  get dar() { return this.id === 'snes' ? this.m._emuhub_video_aspect() : undefined; }
  /* o motor nativo ainda não cobre coprocessadores do SNES (Super FX, SA-1, DSP-1...): esses jogos usam o núcleo JS */
  needsJs(u8) {
    if (this.id !== 'snes') return false;
    try { return typeof parseSnesHeader === 'function' ? !!parseSnesHeader(u8).coprocessor : false; } catch (e) { return true; }
  }
  load(u8) {
    const m = this.m; m._emuhub_select_console(Native.CON[this.id]);
    const ptr = m._malloc(u8.length); if (!ptr) throw new Error('Memória insuficiente para carregar a ROM');
    try {
      m.HEAPU8.set(u8, ptr);
      const r = m._emuhub_load_rom(ptr, u8.length);
      if (r !== 0) throw new Error(r === 2 && this.id === 'gb' ? 'Tipo de cartucho ainda não suportado pelo motor nativo.' : 'O motor nativo recusou a ROM (código ' + r + ').');
    } finally { m._free(ptr); }
    const hb = this.id === 'snes' && u8.length % 1024 === 512 ? u8.subarray(512) : u8;
    this.romHash = 0; for (let i = 0; i < Math.min(hb.length, 65536); i++) this.romHash = (this.romHash * 31 + hb[i]) >>> 0;
    this.rp = this.wp = 0; this.ready = true;
    let title = this.id === 'gb' ? '' : this.id === 'snes' ? 'ROM SNES' : 'ROM NES';
    if (this.id === 'gb') { for (let i = 0x134; i < 0x143 && u8[i] >= 0x20 && u8[i] < 0x7F; i++) title += String.fromCharCode(u8[i]); title = title.trim() || 'Sem título'; }
    if (this.id === 'snes') { try { if (typeof parseSnesHeader === 'function') { const h = parseSnesHeader(u8); title = h.title; } } catch (e) {} }
    const lines = ['Motor nativo C++/WebAssembly'];
    if (this.id === 'gb') lines.push('Modo: ' + (m._emuhub_gb_is_cgb() ? 'Game Boy Color' : 'Game Boy (DMG)'));
    else if (this.id === 'nes') lines.push('Mapper ' + m._emuhub_nes_mapper());
    return { title, lines };
  }
  get frame() { const m = this.m; return new Uint32Array(m.HEAPU32.buffer, m._emuhub_video_buffer(), m._emuhub_video_buffer_size()); }
  runFrame() {
    const m = this.m; m._emuhub_select_console(Native.CON[this.id]);
    if (m._emuhub_run_frame() !== 0) throw new Error('Falha ao executar um quadro no motor nativo');
    const n = m._emuhub_audio_buffer_samples(), src = new Float32Array(m.HEAPF32.buffer, m._emuhub_audio_buffer(), n);
    for (let i = 0; i < n; i++) { if (this.wp - this.rp >= 32768) this.rp++; this.ring[this.wp & 32767] = src[i]; this.wp++; }
  }
  reset() { this.m._emuhub_reset(); this.rp = this.wp = 0; }
  setButtons(mask) { this.m._emuhub_set_buttons(mask & (this.id === 'snes' ? 0xFFF : 255)); }
  peek(a) { return this.id === 'nes' ? this.m._emuhub_nes_cpu_read(a & 65535) : this.id === 'snes' ? this.m._emuhub_snes_peek(a >>> 0) : 0; }
  /* save da bateria (GB). O relógio do MBC3 ainda não é salvo no motor nativo. */
  sramKey() { return (this.id === 'gb' || this.id === 'snes') && this.m._emuhub_sram_battery() && this.m._emuhub_sram_size() ? this.id + '_' + this.romHash : null; }
  sramData() { const m = this.m; return new Uint8Array(m.HEAPU8.buffer, m._emuhub_sram_data(), m._emuhub_sram_size()).slice(); }
  /* cheats: o texto é interpretado pelo mesmo parser dos núcleos JS; o módulo recebe as operações prontas */
  parseCheat(text) { return (this._parser = this._parser || Cores[this.id].create()).parseCheat(text); }
  setCheats(ops) {
    const m = this.m; m._emuhub_select_console(Native.CON[this.id]); m._emuhub_cheats_clear();
    for (const o of ops) { if (o.t === 'ram') m._emuhub_cheat_ram(o.addr >>> 0, o.val); else if (o.t === 'gg') m._emuhub_cheat_gg(o.addr >>> 0, o.val, o.cmp === undefined ? -1 : o.cmp); }
  }
  saveState() {
    const m = this.m, n = m._emuhub_state_save();
    return new Uint8Array(m.HEAPU8.buffer, m._emuhub_state_buffer(), n).slice();
  }
  loadState(u8) {
    const m = this.m, p = m._emuhub_state_alloc(u8.length);
    m.HEAPU8.set(u8, p);
    const r = m._emuhub_state_load(u8.length);
    if (r === 1) throw new Error('Estado salvo por outro motor (JS). Salve de novo no motor nativo.');
    if (r) throw new Error('Estado incompatível com este jogo');
  }
  sramRestore(u8) { const m = this.m, n = m._emuhub_sram_size(); m.HEAPU8.set(u8.subarray(0, n), m._emuhub_sram_data()); }
}

function makeCore(id, name) {
  if (Native.enabled() && Native.supports(id)) { try { return new NativeCore(id, name); } catch (e) {} }
  return Cores[id].create();
}
if (typeof module !== 'undefined') module.exports = { Native, NativeCore, makeCore };
