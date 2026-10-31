'use strict';
/* Núcleo SNES (em construção): por enquanto reconhece e valida a ROM pelo cabeçalho. */

const SNES_REGIONS = ['Japão', 'América do Norte', 'Europa', 'Suécia', 'Finlândia', 'Dinamarca', 'França', 'Holanda', 'Espanha', 'Alemanha', 'Itália', 'China', 'Indonésia', 'Coreia'];

const SNES_CHIPS = { 0: 'DSP', 1: 'Super FX', 2: 'OBC-1', 3: 'SA-1', 4: 'S-DD1', 5: 'S-RTC', 15: 'chip personalizado' };

function parseSnesHeader(d) {
  const off = (d.length % 1024 === 512) ? 512 : 0; // cabeçalho de copiador
  const cands = [{ a: 0x7FC0, map: 'LoROM' }, { a: 0xFFC0, map: 'HiROM' }, { a: 0x40FFC0, map: 'ExHiROM' }];
  let best = null;
  for (const c of cands) {
    const a = c.a + off;
    if (a + 32 > d.length) continue;
    const comp = d[a + 0x1C] | (d[a + 0x1D] << 8), chk = d[a + 0x1E] | (d[a + 0x1F] << 8);
    let score = 0;
    if (((comp + chk) & 0xFFFF) === 0xFFFF) score += 4;
    const isHi = (d[a + 0x15] & 1) === 1;
    if ((c.map === 'LoROM') === !isHi) score += 2;
    let ascii = true;
    for (let i = 0; i < 21; i++) { const ch = d[a + i]; if (ch < 0x20 || ch > 0x7E) { ascii = false; break; } }
    if (ascii) score += 2;
    if (!best || score > best.score) best = { map: c.map, a, score };
  }
  if (!best || best.score < 4) throw new Error('Não consegui reconhecer o cabeçalho de SNES. Arquivo corrompido ou formato não suportado.');
  const a = best.a, mm = d[a + 0x15], type = d[a + 0x16];
  let title = '';
  for (let i = 0; i < 21; i++) title += String.fromCharCode(d[a + i]);
  return {
    title: title.trim() || 'Sem título',
    map: best.map,
    fast: (mm & 0x10) !== 0,
    romBytes: d.length - off,
    copierHeader: off > 0,
    sramKB: d[a + 0x18] ? (1 << d[a + 0x18]) : 0,
    region: SNES_REGIONS[d[a + 0x19]] || 'Outra',
    coprocessor: (type & 0x0F) >= 3,
    chip: (type & 0x0F) >= 3 ? type >> 4 : -1,
    battery: [2, 5, 6, 9, 10].includes(type & 0x0F),
    checksumOk: score_ok(d, a)
  };
}
function score_ok(d, a) {
  const comp = d[a + 0x1C] | (d[a + 0x1D] << 8), chk = d[a + 0x1E] | (d[a + 0x1F] << 8);
  return ((comp + chk) & 0xFFFF) === 0xFFFF;
}

const SNES_SKIP = new Set(['rom', 'frame', 'fb', 'fb256', 'lineHires', 'bgcolS', 'bgpriS', 'chrPx', 'sampleBuf', 'noLimit', 'clk', 'ramCheats', 'patched', 'owned']);

class SNESCore {
  constructor() {
    this.id = 'snes'; this.name = 'SNES'; this.ready = false;
    this.snes = new SNES();
    const apu = this.snes.apu;
    this.audio = {
      buffered: () => apu.buffered(),
      fill: o => apu.fill(o),
      setSampleRate: sr => apu.setSampleRate(sr),
      setVolume: v => { apu.volume = v; }
    };
    this.header = null;
  }
  get frame() { return this.snes.ppu.frame; }
  get width() { return this.snes.ppu.outW; }
  get height() { return this.snes.ppu.outH; }
  get dar() { const p = this.snes.ppu; return (p.setini & 4) ? 256 / 239 : 256 / 224; }
  load(u8) {
    const h = parseSnesHeader(u8);
    this.header = h;
    const rom = h.copierHeader ? u8.subarray(512) : u8;
    this.romHash = 0; for (let i = 0; i < Math.min(rom.length, 65536); i++) this.romHash = (this.romHash * 31 + rom[i]) >>> 0;
    this.owned = false; this.patched = null;
    this.snes.gsu = null; this.snes.gsuIrq = false;
    if (h.chip === 1) { // Super FX
      const ramB = (h.battery ? Math.min(Math.max(h.sramKB, 32), 256) : 128) * 1024;
      this.snes.load(rom, false, 0);
      this.snes.gsu = new GSU(this.snes, rom, ramB);
      if (h.battery) { this.snes.sram = this.snes.gsu.ram; this.snes.sramMask = ramB - 1; }
    } else this.snes.load(rom, h.map !== 'LoROM', h.sramKB ? Math.min(h.sramKB, 128) * 1024 : 0);
    this.snes.reset();
    this.ready = true;
    return {
      title: h.title,
      lines: [
        'Mapeamento: ' + h.map + (h.fast ? ' (FastROM)' : ' (SlowROM)'),
        'ROM: ' + (h.romBytes >> 10) + ' KB' + (h.copierHeader ? ' (cabeçalho de copiador ignorado)' : ''),
        'SRAM: ' + (h.sramKB ? h.sramKB + ' KB' : 'nenhuma'),
        'Região: ' + h.region,
        h.chip === 1 ? 'Coprocessador: Super FX (GSU)' : h.coprocessor ? 'Atenção: este jogo usa coprocessador extra (' + SNES_CHIPS[h.chip] + '), ainda não suportado' : 'Coprocessador: não',
        'Checksum do cabeçalho: ' + (h.checksumOk ? 'ok' : 'não confere')
      ]
    };
  }
  /* ---- cheats: Game Genie (XXXX-XXXX) e Pro Action Replay (AAAAAADD ou AAAAAA:DD) ---- */
  parseCheat(text) {
    const ops = [];
    const GG = 'DF4709156BC8A23E';
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim(); if (!line) continue;
      let m;
      if ((m = /^([0-9A-F]{4})-([0-9A-F]{4})$/i.exec(line))) {
        const str = (m[1] + m[2]).toUpperCase(); let n = 0;
        for (const ch of str) { const k = GG.indexOf(ch); if (k < 0) throw new Error('Game Genie: caractere inválido "' + ch + '". Letras válidas: D F 4 7 0 9 1 5 6 B C 8 A 2 3 E.'); n = (n * 16 + k) >>> 0; }
        const val = n >>> 24; let a = n & 0xFFFFFF;
        a = ((a & 0x003C00) << 10) | ((a & 0x00003C) << 14) | ((a & 0xF00000) >> 8) | ((a & 0x000003) << 10) | ((a & 0x00C000) >> 6) | ((a & 0x0F0000) >> 12) | ((a & 0x0003C0) >> 6);
        ops.push({ t: 'gg', addr: a, val });
      } else if ((m = /^([0-9A-F]{6})\s*[:= ]?\s*([0-9A-F]{2})$/i.exec(line))) {
        const a = parseInt(m[1], 16);
        const bank = a >> 16;
        if (!((bank === 0x7E || bank === 0x7F) || (bank < 0x40 && (a & 0xFFFF) < 0x2000))) throw new Error('Endereço ' + m[1].toUpperCase() + ' fora da RAM (7E0000-7FFFFF).');
        ops.push({ t: 'ram', addr: a, val: parseInt(m[2], 16) });
      } else throw new Error('Formato não reconhecido: "' + line + '". Use Game Genie (ex.: C2A4-6F0D) ou Action Replay (ex.: 7E0DBE05 ou 7E0DBE:05).');
    }
    if (!ops.length) throw new Error('Digite um código.');
    return ops;
  }
  setCheats(ops) {
    const s = this.snes;
    if (this.patched) { for (const [i, v] of this.patched) s.rom[i] = v; this.patched = null; } // desfaz Game Genie anterior
    this.ramCheats = ops.filter(o => o.t === 'ram');
    const gg = ops.filter(o => o.t === 'gg'); if (!gg.length) return;
    this.patched = [];
    if (!this.owned) { s.rom = s.rom.slice(); this.owned = true; } // não altera o arquivo original do hub
    for (const o of gg) {
      const bank = o.addr >> 16, off = o.addr & 0xFFFF;
      if (off < 0x8000 && !s.hiRom) continue;
      if (bank === 0x7E || bank === 0x7F) continue;
      if (s.hiRom && (bank & 0x7F) < 0x40 && off < 0x8000) continue;
      const i = s.hiRom ? (((bank & 0x3F) << 16) | off) & s.romMask : (((bank & 0x7F) << 15) | (off & 0x7FFF)) & s.romMask;
      this.patched.push([i, s.rom[i]]); s.rom[i] = o.val;
    }
  }
  applyCheats() {
    const r = this.ramCheats; if (!r || !r.length) return;
    const s = this.snes;
    for (let i = 0; i < r.length; i++) { const o = r[i], bank = o.addr >> 16; if (bank === 0x7E || bank === 0x7F) s.wram[o.addr & 0x1FFFF] = o.val; else s.wram[o.addr & 0x1FFF] = o.val; }
  }
  /* ---- melhorias por jogo ---- */
  enhancements() {
    return [
      { id: 'noLimit', type: 'toggle', label: 'Sem limite de sprites por linha', hint: 'Acaba com o pisca-pisca de sprites (limite de 32 por linha e 34 fatias). Alguns jogos usam o limite de propósito.' },
      { id: 'oc', type: 'choice', label: 'Overclock da CPU', choices: ['Desligado', '+33%', '+100%', '+200%'], hint: 'Dá mais tempo à CPU em cada quadro e reduz a lentidão em jogos pesados (Gradius III, Super R-Type). Gasta mais processamento.' }
    ];
  }
  setOptions(o) { this.snes.ppu.noLimit = !!o.noLimit; this.snes.clk = [1, 0.75, 0.5, 0.34][o.oc | 0] || 1; }
  reset() { this.snes.reset(); }
  runFrame() { this.snes.runFrame(); this.applyCheats(); }
  setButtons(m) { this.snes.setButtons(m); }
  saveState() { return emuStateSave(this.snes, SNES_SKIP); }
  loadState(u8) { emuStateLoad(this.snes, SNES_SKIP, u8); this.snes.apu.rpf = this.snes.apu.wp; }
  sramKey() { return this.snes.sramMask ? 'snes_' + this.romHash : null; }
  sramData() { return this.snes.sram; }
  sramRestore(u8) { this.snes.sram.set(u8.subarray(0, this.snes.sram.length)); }
}

if (typeof module !== 'undefined') module.exports = { parseSnesHeader, SNESCore };
