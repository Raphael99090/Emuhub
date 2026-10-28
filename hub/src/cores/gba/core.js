'use strict';
/* Núcleo GBA: ARM7TDMI, vídeo, som, timers, DMA, interrupções e BIOS simulada. */

function gbaFindSaveType(d) {
  // varre a ROM atrás das strings de biblioteca de save usadas pelos jogos
  const pats = [['EEPROM_V', 'EEPROM'], ['SRAM_V', 'SRAM'], ['FLASH1M_V', 'Flash 128 KB'], ['FLASH512_V', 'Flash 64 KB'], ['FLASH_V', 'Flash 64 KB']]
    .map(([s, n]) => ({ b: Array.from(s, c => c.charCodeAt(0)), n }));
  const len = d.length - 10;
  for (let i = 0; i < len; i++) {
    const c = d[i];
    if (c !== 0x45 && c !== 0x53 && c !== 0x46) continue; // E, S, F
    for (const p of pats) {
      if (p.b[0] !== c) continue;
      let ok = true;
      for (let k = 1; k < p.b.length; k++) if (d[i + k] !== p.b[k]) { ok = false; break; }
      if (ok) return p.n;
    }
  }
  return null;
}

function parseGbaHeader(d) {
  if (d.length < 0xC0) throw new Error('Arquivo pequeno demais para ser uma ROM de GBA.');
  if (d[0xB2] !== 0x96) throw new Error('Cabeçalho de GBA inválido (byte fixo 0x96 ausente). Arquivo corrompido ou não é uma ROM de GBA.');
  let sum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) sum += d[i];
  const chk = (-(sum + 0x19)) & 0xFF;
  const str = (a, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = d[a + i]; if (c === 0) break; s += String.fromCharCode(c); } return s; };
  return {
    title: str(0xA0, 12).trim() || 'Sem título',
    code: str(0xAC, 4),
    maker: str(0xB0, 2),
    version: d[0xBC],
    romBytes: d.length,
    checksumOk: chk === d[0xBD],
    armEntry: d[3] === 0xEA,
    save: gbaFindSaveType(d)
  };
}

const GBA_SKIP = new Set(['fast', 'rom', 'frame', 'buf', 'bios', 'swiHook', 'ioRead16', 'ioWrite16', 'ioWrite8', 'cheatOps']);

class GBACore {
  constructor() {
    this.id = 'gba'; this.name = 'GBA'; this.width = 240; this.height = 160; this.ready = false;
    this.audio = null;
    this.frame = new Uint32Array(240 * 160).fill(0xFF000000);
    this.header = null;
    this.sys = new GBASystem(this.frame);
    this.bus = this.sys.bus; this.cpu = this.sys.cpu;
    const apu = this.sys.apu;
    this.audio = { buffered: () => apu.buffered(), fill: o => apu.fill(o), setSampleRate: r => apu.setSampleRate(r), setVolume: v => { apu.volume = v; } };
  }
  load(u8) {
    const h = parseGbaHeader(u8);
    this.header = h;
    this.bus.loadRom(u8);
    this.bus.sram.fill(0xFF); this.bus.ee.data.fill(0xFF); this.bus.ee.size = 0;
    this.bus.saveType = { 'SRAM': 'sram', 'Flash 64 KB': 'flash64', 'Flash 128 KB': 'flash128', 'EEPROM': 'eeprom' }[h.save] || 'sram';
    this.bus.fl.bank = 0;
    this.sys.reset();
    this.ready = true;
    return {
      title: h.title,
      lines: [
        'Código do jogo: ' + (h.code || '?') + ', produtor ' + (h.maker || '?') + ', versão ' + h.version,
        'ROM: ' + (h.romBytes >> 10) + ' KB',
        'Save: ' + (h.save || 'não detectado (tratado como SRAM)'),
        'Checksum do cabeçalho: ' + (h.checksumOk ? 'ok' : 'não confere')
      ]
    };
  }
  /* ---- cheats: AR/GameShark v3 sem criptografia (tipos 0, 1, 2) e "ENDERECO:VALOR" ---- */
  parseCheat(text) {
    const ops = [];
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim(); if (!line) continue;
      let m;
      if ((m = /^([0-9A-F]{8})\s*[ :=]\s*([0-9A-F]{8})$/i.exec(line))) {
        const hi = parseInt(m[1], 16) >>> 0, t = hi >>> 28;
        if (t > 2) throw new Error('Código tipo ' + t + ' não suportado. Aceito: escrita direta (começando com 0, 1 ou 2) e códigos criptografados não funcionam.');
        ops.push({ t: 'w', addr: (hi & 0x0FFFFFFF) >>> 0, val: parseInt(m[2], 16) >>> 0, size: 1 << t });
      } else if ((m = /^([0-9A-F]{6,8})\s*[:=]\s*([0-9A-F]{2}|[0-9A-F]{4}|[0-9A-F]{8})$/i.exec(line))) {
        ops.push({ t: 'w', addr: parseInt(m[1], 16) >>> 0, val: parseInt(m[2], 16) >>> 0, size: m[2].length >> 1 });
      } else throw new Error('Formato não reconhecido: "' + line + '". Use 8+8 dígitos (ex.: 03001234 000000FF) ou ENDEREÇO:VALOR (ex.: 03001234:FF).');
    }
    if (!ops.length) throw new Error('Digite um código.');
    for (const o of ops) { const r = o.addr >>> 24; if (r !== 2 && r !== 3) throw new Error('Endereço ' + o.addr.toString(16).toUpperCase().padStart(8, '0') + ' fora da RAM (02xxxxxx ou 03xxxxxx).'); }
    return ops;
  }
  setCheats(ops) { this.cheatOps = ops; }
  applyCheats() {
    const r = this.cheatOps; if (!r || !r.length) return;
    const b = this.bus, c = b.cycles;
    for (let i = 0; i < r.length; i++) { const o = r[i]; if (o.size === 1) b.write8(o.addr, o.val); else if (o.size === 2) b.write16(o.addr & ~1, o.val); else b.write32(o.addr & ~3, o.val); }
    b.cycles = c;
  }
  loadBios(u8) {
    if (u8.length !== 0x4000) throw new Error('A BIOS do GBA tem 16384 bytes (16 KB); este arquivo tem ' + u8.length + '.');
    this.sys.loadBios(u8); this.biosLoaded = true;
  }
  saveState() { return emuStateSave(this.sys, GBA_SKIP); }
  loadState(u8) { emuStateLoad(this.sys, GBA_SKIP, u8); const a = this.sys.apu; a.rp = a.wp; this.sys.frameDone = false; }
  reset() { this.sys.reset(); }
  setSkip(on) { this.sys.skipVideo = !!on; }
  setTurbo(on) { this.sys.apu.fast = !!on; }
  runFrame() { this.sys.runFrame(); this.applyCheats(); }
  setButtons(m) { this.sys.setButtons(m); }
  sramKey() {
    if (!this.header || !this.header.save) return null;
    const rom = this.bus.rom.u8; let h = 0;
    for (let i = 0; i < Math.min(this.bus.romLen, 65536); i++) h = (h * 31 + rom[i]) >>> 0;
    return 'gba_' + h;
  }
  sramData() {
    const b = this.bus;
    switch (b.saveType) {
      case 'flash64': return b.sram.subarray(0, 0x10000);
      case 'flash128': return b.sram.subarray(0, 0x20000);
      case 'eeprom': return b.ee.data.subarray(0, b.ee.size || 512);
      default: return b.sram.subarray(0, 0x8000);
    }
  }
  sramRestore(u8) {
    const b = this.bus, d = this.sramData();
    d.set(u8.subarray(0, d.length));
    if (b.saveType === 'eeprom') { if (u8.length >= 8192) { b.ee.data.set(u8.subarray(0, 8192)); b.ee.size = 8192; } else b.ee.data.set(u8.subarray(0, 512)); }
  }
}

if (typeof module !== 'undefined') module.exports = { parseGbaHeader, GBACore };
