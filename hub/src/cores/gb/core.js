/* Adaptador Game Boy / Game Boy Color -> interface comum de núcleos do hub.
 * Máscara de botões: A=1 B=2 SEL=4 START=8 UP=16 DOWN=32 LEFT=64 RIGHT=128 */
const GB_MBC_NAMES = { 0: 'Sem MBC', 1: 'MBC1', 2: 'MBC2', 3: 'MBC3', 5: 'MBC5' };
const GB_PALETTES = [
  [0xFFD0F8E0, 0xFF70C088, 0xFF566834, 0xFF201808], // verde suave
  [0xFFFFFFFF, 0xFFAAAAAA, 0xFF555555, 0xFF000000], // cinza
  [0xFF8FCDC4, 0xFF5BA37A, 0xFF3B6B3A, 0xFF1D3B22], // verde clássico (Game Boy original)
  [0xFFB8E0E8, 0xFF9BB9A8, 0xFF5E7A5A, 0xFF2E4030]  // Pocket
];
const GB_SKIP = new Set(['rom', 'frame', 'buf', 'gg', 'serialOut', 'ramCheats', 'noLimit']);

class GBCore {
  constructor() {
    this.id = 'gb'; this.name = 'Game Boy'; this.width = 160; this.height = 144; this.ready = false;
    this.gb = new GB();
    const apu = this.gb.apu;
    this.audio = {
      buffered: () => apu.buffered(),
      fill: o => apu.fill(o),
      setSampleRate: sr => apu.setSampleRate(sr),
      setVolume: v => { apu.volume = v; }
    };
    this.header = null; this.ramCheats = null; this.dmgOnly = false;
  }
  get frame() { return this.gb.ppu.frame; }
  parseHeader(u8) {
    if (u8.length < 0x150) throw new Error('Arquivo pequeno demais para ser uma ROM de Game Boy.');
    let title = '';
    for (let i = 0x134; i < 0x143; i++) { const c = u8[i]; if (c >= 0x20 && c < 0x7F) title += String.fromCharCode(c); else if (c === 0) break; }
    let sum = 0; for (let i = 0x134; i <= 0x14C; i++) sum = (sum - u8[i] - 1) & 255;
    return { title: title.trim() || 'Sem título', type: u8[0x147], cgbFlag: u8[0x143], headerOk: sum === u8[0x14D], romKB: u8.length >> 10, ramCode: u8[0x149], sgb: u8[0x146] === 3 };
  }
  load(u8) {
    const h = this.parseHeader(u8); this.header = h;
    this.gb.load(u8, this.dmgOnly);
    this.romHash = 0; for (let i = 0; i < Math.min(u8.length, 65536); i++) this.romHash = (this.romHash * 31 + u8[i]) >>> 0;
    this.ready = true;
    const g = this.gb, c = g.cart;
    return {
      title: h.title,
      lines: [
        'Modo: ' + (g.cgb ? 'Game Boy Color' + (h.cgbFlag === 0xC0 ? ' (só GBC)' : ' (também roda no GB)') : 'Game Boy (DMG)'),
        'Cartucho: ' + (GB_MBC_NAMES[c.mbc] || 'desconhecido') + ' (tipo 0x' + h.type.toString(16).toUpperCase().padStart(2, '0') + ')' + (c.battery ? ', com bateria' : '') + (c.rtc ? ', com relógio' : ''),
        'ROM: ' + h.romKB + ' KB, RAM: ' + (g.ram.length >> 10 || (g.ram.length ? '0.5' : '0')) + ' KB',
        c.unsupported ? 'Atenção: este tipo de cartucho (câmera, MBC6/7, HuC3, TAMA5) ainda não é suportado' : 'Checksum do cabeçalho: ' + (h.headerOk ? 'ok' : 'não confere')
      ]
    };
  }
  reset() { this.gb.reset(); this.applyCheatsInit(); }
  setButtons(m) { this.gb.setButtons(m); }
  runFrame() { this.gb.runFrame(); this.applyCheats(); }
  saveState() { return emuStateSave(this.gb, GB_SKIP); }
  loadState(u8) { emuStateLoad(this.gb, GB_SKIP, u8); this.gb.apu.rp = this.gb.apu.wp; }
  /* ---- cheats: GameShark (01VVLLHH) e Game Genie (XXX-YYY[-ZZZ]) ---- */
  parseCheat(text) {
    const ops = [];
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim(); if (!line) continue;
      let m;
      if ((m = /^([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(line))) {
        const t = parseInt(m[1], 16); if ((t & 0xF0) !== 0 && t !== 0x01) throw new Error('GameShark: tipo ' + m[1] + ' não suportado (aceito: 01VVLLHH).');
        ops.push({ t: 'ram', addr: (parseInt(m[4], 16) << 8) | parseInt(m[3], 16), val: parseInt(m[2], 16) });
      } else if ((m = /^([0-9A-F]{3})-([0-9A-F]{3})(?:-([0-9A-F]{3}))?$/i.exec(line))) {
        const d = (m[1] + m[2] + (m[3] || '')).split('').map(x => parseInt(x, 16));
        const val = (d[0] << 4) | d[1];
        const addr = (((d[5] ^ 0xF) << 12) | (d[2] << 8) | (d[3] << 4) | d[4]) & 0xFFFF;
        let cmp = -1;
        if (m[3]) { const x = (d[6] << 4) | d[8]; cmp = ((((x >> 2) | (x << 6)) & 255) ^ 0xBA); }
        if (addr >= 0x8000) throw new Error('Game Genie: endereço fora da ROM.');
        ops.push({ t: 'gg', addr, val, cmp });
      } else throw new Error('Formato não reconhecido: "' + line + '". Use GameShark (ex.: 01FF34C0) ou Game Genie (ex.: 00A-17B-C49).');
    }
    if (!ops.length) throw new Error('Digite um código.');
    return ops;
  }
  setCheats(ops) {
    this.ramCheats = ops.filter(o => o.t === 'ram');
    const gg = ops.filter(o => o.t === 'gg'); this.gb.gg = gg.length ? gg : null;
  }
  applyCheatsInit() {}
  applyCheats() {
    const r = this.ramCheats; if (!r || !r.length) return;
    const g = this.gb;
    for (let i = 0; i < r.length; i++) g.write(r[i].addr, r[i].val);
  }
  /* ---- melhorias por jogo ---- */
  enhancements() {
    return [
      { id: 'pal', type: 'choice', label: 'Cores do Game Boy original', choices: ['Verde suave', 'Cinza', 'Clássico', 'Pocket'], hint: 'Só vale para jogos de Game Boy em preto e verde (os do Color têm cores próprias).' },
      { id: 'noLimit', type: 'toggle', label: 'Sem limite de 10 sprites por linha', hint: 'Acaba com o pisca-pisca de personagens. Alguns jogos usam o limite de propósito.' }
    ];
  }
  setOptions(o) {
    const p = GB_PALETTES[o.pal | 0] || GB_PALETTES[0];
    for (let i = 0; i < 4; i++) GB_DMG_COLORS[i] = p[i];
    this.gb.ppu.noLimit = !!o.noLimit;
  }
  /* ---- save da bateria (RAM + relógio do MBC3) ---- */
  sramKey() { return this.gb.cart.battery && (this.gb.ram.length || this.gb.cart.rtc) ? 'gb_' + this.romHash : null; }
  sramData() {
    const g = this.gb;
    if (!g.cart.rtc) return g.ram;
    const out = new Uint8Array(g.ram.length + 13), r = g.rtc;
    out.set(g.ram);
    const dv = new DataView(out.buffer);
    dv.setUint32(g.ram.length, r.base >>> 0, true); dv.setUint32(g.ram.length + 4, Math.floor(r.base / 4294967296) >>> 0, true);
    dv.setUint32(g.ram.length + 8, (r.haltAt || 0) >>> 0, true); out[g.ram.length + 12] = r.halt ? 1 : 0;
    return out;
  }
  sramRestore(u8) {
    const g = this.gb, n = g.ram.length;
    g.ram.set(u8.subarray(0, n));
    if (g.cart.rtc && u8.length >= n + 13) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.length), r = g.rtc;
      r.base = dv.getUint32(n, true) + dv.getUint32(n + 4, true) * 4294967296; r.haltAt = dv.getUint32(n + 8, true); r.halt = u8[n + 12] === 1;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GBCore };
