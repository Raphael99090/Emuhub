'use strict';
/* Sistema Game Boy / Game Boy Color: mapa de memória, cartuchos (MBC1/2/3/5), temporizador, joypad,
 * serial, DMA de OAM, HDMA/GDMA do CGB, troca de velocidade e ligação CPU/PPU/APU. */
const GB_FRAME = 70224;

class GB {
  constructor() {
    this.cpu = new GBCPU(this);
    this.ppu = new GBPPU(this);
    this.apu = new GBApu(this);
    this.rom = new Uint8Array(0x8000); this.romMask = 0x7FFF;
    this.cart = { type: 0, mbc: 0, battery: false, rtc: false, ramBanks: 0, romBanks: 2 };
    this.ram = new Uint8Array(0); this.ramMask = 0;
    this.wram = new Uint8Array(0x8000); this.hram = new Uint8Array(0x80);
    this.io = new Uint8Array(0x80);
    this.cgb = false; this.doubleSpeed = false; this.speedArmed = false;
    this.ifl = 0; this.ie = 0; this.buttons = 0; this.joySel = 0x30;
    this.divc = 0; this.tima = 0; this.tma = 0; this.tac = 0;
    this.serialOut = ''; this.sb = 0; this.sc = 0;
    this.wbank = 1;
    this.hdma = { src: 0, dst: 0, len: 0, active: false };
    this.hdmaActive = false;
    this.rtc = { regs: new Uint8Array(5), latched: new Uint8Array(5), base: 0, halt: false, latch: 0, haltAt: 0 };
    this.gg = null; this.extra = 0;
    this.mbcState();
  }
  mbcState() { this.ramEn = false; this.romBank = 1; this.ramBank = 0; this.mode = 0; this.upper = 0; this.rtcSel = 0; this.romOff1 = 0x4000; this.romOff0 = 0; this.ramOff = 0; }
  load(rom, forceDmg) {
    let n = 0x8000; while (n < rom.length) n <<= 1;
    this.rom = new Uint8Array(n); this.rom.set(rom); this.romMask = n - 1; this.romLen = rom.length;
    const t = rom[0x147], c = this.cart;
    c.type = t; c.romBanks = n >> 14;
    c.mbc = [0, 1, 1, 1, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5][t] || 0;
    if (t >= 0x19 && t <= 0x1E) c.mbc = 5;
    if (t === 0xFF) c.mbc = 1;
    c.battery = [3, 6, 9, 0x0F, 0x10, 0x13, 0x1B, 0x1E, 0xFF].includes(t);
    c.rtc = t === 0x0F || t === 0x10;
    c.unsupported = [0x20, 0x22, 0xFC, 0xFD, 0xFE].includes(t);
    const rs = [0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000][rom[0x149]] || 0;
    const ramSize = c.mbc === 2 ? 512 : rs;
    this.ram = new Uint8Array(ramSize); this.ramMask = ramSize ? ramSize - 1 : 0;
    c.ramBanks = Math.max(1, ramSize >> 13);
    this.cgb = !forceDmg && (rom[0x143] & 0x80) !== 0;
    this.reset();
  }
  reset() {
    this.mbcState(); this.ifl = 0xE1; this.ie = 0; this.divc = 0; this.tima = 0; this.tma = 0; this.tac = 0;
    this.joySel = 0x30; this.wbank = 1; this.doubleSpeed = false; this.speedArmed = false; this.extra = 0;
    this.wram.fill(0); this.hram.fill(0); this.io.fill(0); this.serialOut = '';
    this.hdma.active = false; this.hdmaActive = false;
    this.ppu.reset(); this.apu.reset(); this.ppu.vram.fill(0); this.ppu.oam.fill(0);
    if (this.cgb) { for (let i = 0; i < 64; i++) { this.ppu.bgPal[i] = 0xFF; this.ppu.obPal[i] = 0xFF; } for (let i = 0; i < 32; i++) { this.ppu.bgCol[i] = this.ppu.obCol[i] = GB_RGB_LUT[0x7FFF]; } }
    const c = this.cpu;
    c.ime = 0; c.imeNext = 0; c.halted = false; c.haltBug = false; c.pc = 0x100; c.sp = 0xFFFE;
    if (this.cgb) { c.a = 0x11; c.f = 0x80; c.b = 0; c.c = 0; c.d = 0xFF; c.e = 0x56; c.h = 0; c.l = 0x0D; }
    else { c.a = 0x01; c.f = 0xB0; c.b = 0; c.c = 0x13; c.d = 0; c.e = 0xD8; c.h = 0x01; c.l = 0x4D; }
    this.apu.write(0xFF26, 0x80);
    const apuInit = { 0xFF10: 0x80, 0xFF11: 0xBF, 0xFF12: 0xF3, 0xFF14: 0xBF, 0xFF16: 0x3F, 0xFF17: 0, 0xFF19: 0xBF, 0xFF1A: 0x7F, 0xFF1B: 0xFF, 0xFF1C: 0x9F, 0xFF1E: 0xBF, 0xFF20: 0xFF, 0xFF21: 0, 0xFF22: 0, 0xFF23: 0xBF, 0xFF24: 0x77, 0xFF25: 0xF3 };
    for (const a in apuInit) this.apu.write(+a, apuInit[a]);
    this.apu.p1.on = this.apu.p2.on = false;
    this.ppu.lcdc = 0x91; this.ppu.mode = 2; this.ppu.ly = 0; this.ppu.cyc = 0;
    this.updateBanks();
  }
  /* ---- bancos do cartucho ---- */
  updateBanks() {
    const c = this.cart, nb = c.romBanks;
    let b0 = 0, b1;
    switch (c.mbc) {
      case 1: {
        b1 = ((this.upper << 5) | (this.romBank & 31)); if ((this.romBank & 31) === 0) b1 |= 1;
        if (this.mode) b0 = this.upper << 5;
        this.ramOff = (this.mode ? this.upper : 0) << 13;
        break;
      }
      case 2: b1 = this.romBank & 15 || 1; break;
      case 3: b1 = this.romBank & 127 || 1; this.ramOff = (this.ramBank & 3) << 13; break;
      case 5: b1 = this.romBank & 0x1FF; this.ramOff = (this.ramBank & 15) << 13; break;
      default: b1 = 1;
    }
    this.romOff0 = ((b0 % nb) << 14); this.romOff1 = ((b1 % nb) << 14);
  }
  mbcWrite(a, v) {
    const c = this.cart;
    switch (c.mbc) {
      case 1:
        if (a < 0x2000) this.ramEn = (v & 15) === 0x0A;
        else if (a < 0x4000) this.romBank = v & 31;
        else if (a < 0x6000) this.upper = v & 3;
        else this.mode = v & 1;
        break;
      case 2:
        if (a < 0x4000) { if (a & 0x100) this.romBank = v & 15; else this.ramEn = (v & 15) === 0x0A; }
        break;
      case 3:
        if (a < 0x2000) this.ramEn = (v & 15) === 0x0A;
        else if (a < 0x4000) this.romBank = v & 127;
        else if (a < 0x6000) { this.rtcSel = v; this.ramBank = v & 3; }
        else { if (this.rtc.latch === 0 && v === 1) this.latchRtc(); this.rtc.latch = v; }
        break;
      case 5:
        if (a < 0x2000) this.ramEn = (v & 15) === 0x0A;
        else if (a < 0x3000) this.romBank = (this.romBank & 0x100) | v;
        else if (a < 0x4000) this.romBank = (this.romBank & 0xFF) | ((v & 1) << 8);
        else if (a < 0x6000) this.ramBank = v & 15;
        break;
    }
    this.updateBanks();
  }
  /* ---- relógio de tempo real do MBC3 ---- */
  rtcNow() {
    const r = this.rtc; let sec = r.halt ? r.haltAt : Math.floor(Date.now() / 1000);
    let d = Math.max(0, sec - r.base);
    const out = new Uint8Array(5);
    out[0] = d % 60; d = Math.floor(d / 60); out[1] = d % 60; d = Math.floor(d / 60); out[2] = d % 24; d = Math.floor(d / 24);
    out[3] = d & 255; out[4] = ((d >> 8) & 1) | (d > 511 ? 0x80 : 0) | (r.halt ? 0x40 : 0);
    return out;
  }
  latchRtc() { this.rtc.latched = this.rtcNow(); }
  rtcWrite(sel, v) {
    const r = this.rtc, cur = this.rtcNow(); const i = sel - 8;
    cur[i] = v;
    if (i === 4) { const wasHalt = r.halt; r.halt = (v & 0x40) !== 0; if (r.halt && !wasHalt) r.haltAt = Math.floor(Date.now() / 1000); }
    let d = ((cur[4] & 1) << 8) | cur[3];
    const total = cur[0] + cur[1] * 60 + cur[2] * 3600 + d * 86400;
    const now = r.halt ? (r.haltAt = r.haltAt || Math.floor(Date.now() / 1000)) : Math.floor(Date.now() / 1000);
    r.base = now - total;
    if (!(i === 4)) { /* mantém o bit de parada */ }
  }
  /* ---- barramento ---- */
  read(a) {
    switch (a >> 12) {
      case 0: case 1: case 2: case 3: {
        const v = this.rom[(this.romOff0 | (a & 0x3FFF)) & this.romMask]; // 0000-3FFF; usa banco 0 (ou o alto do MBC1 modo 1)
        return this.gg ? this.ggRead(a, v) : v;
      }
      case 4: case 5: case 6: case 7: {
        const v = this.rom[(this.romOff1 | (a & 0x3FFF)) & this.romMask];
        return this.gg ? this.ggRead(a, v) : v;
      }
      case 8: case 9: return this.ppu.vram[((this.ppu.vbk & (this.cgb ? 1 : 0)) << 13) | (a & 0x1FFF)];
      case 10: case 11: return this.readRam(a);
      case 12: return this.wram[a & 0xFFF];
      case 13: return this.wram[(this.cgb ? this.wbank << 12 : 0x1000) | (a & 0xFFF)];
      case 14: return this.wram[a & 0xFFF];
      case 15:
        if (a < 0xFE00) return this.wram[(this.cgb ? this.wbank << 12 : 0x1000) | (a & 0xFFF)];
        if (a < 0xFEA0) return this.ppu.oam[a - 0xFE00];
        if (a < 0xFF00) return 0xFF;
        if (a < 0xFF80) return this.readIo(a);
        if (a === 0xFFFF) return this.ie;
        return this.hram[a - 0xFF80];
    }
    return 0xFF;
  }
  readRam(a) {
    const c = this.cart;
    if (!this.ramEn) return 0xFF;
    if (c.mbc === 2) return this.ram[a & 0x1FF] | 0xF0;
    if (c.mbc === 3 && this.rtcSel >= 8) return this.rtcSel <= 0x0C ? this.rtc.latched[this.rtcSel - 8] : 0xFF;
    if (!this.ramMask) return 0xFF;
    return this.ram[(this.ramOff | (a & 0x1FFF)) & this.ramMask];
  }
  write(a, v) {
    switch (a >> 12) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: this.mbcWrite(a, v); return;
      case 8: case 9: this.ppu.vram[((this.ppu.vbk & (this.cgb ? 1 : 0)) << 13) | (a & 0x1FFF)] = v; return;
      case 10: case 11: {
        const c = this.cart;
        if (!this.ramEn) return;
        if (c.mbc === 2) { this.ram[a & 0x1FF] = v & 15; return; }
        if (c.mbc === 3 && this.rtcSel >= 8) { if (this.rtcSel <= 0x0C) this.rtcWrite(this.rtcSel, v); return; }
        if (this.ramMask) this.ram[(this.ramOff | (a & 0x1FFF)) & this.ramMask] = v;
        return;
      }
      case 12: this.wram[a & 0xFFF] = v; return;
      case 13: this.wram[(this.cgb ? this.wbank << 12 : 0x1000) | (a & 0xFFF)] = v; return;
      case 14: this.wram[a & 0xFFF] = v; return;
      case 15:
        if (a < 0xFE00) { this.wram[(this.cgb ? this.wbank << 12 : 0x1000) | (a & 0xFFF)] = v; return; }
        if (a < 0xFEA0) { this.ppu.oam[a - 0xFE00] = v; return; }
        if (a < 0xFF00) return;
        if (a < 0xFF80) { this.writeIo(a, v); return; }
        if (a === 0xFFFF) { this.ie = v; return; }
        this.hram[a - 0xFF80] = v;
    }
  }
  readIo(a) {
    switch (a) {
      case 0xFF00: {
        const b = this.buttons, sel = this.joySel; let low = 15;
        if (!(sel & 0x10)) { if (b & 128) low &= ~1; if (b & 64) low &= ~2; if (b & 16) low &= ~4; if (b & 32) low &= ~8; }
        if (!(sel & 0x20)) { if (b & 1) low &= ~1; if (b & 2) low &= ~2; if (b & 4) low &= ~4; if (b & 8) low &= ~8; }
        return 0xC0 | sel | low;
      }
      case 0xFF01: return this.sb; case 0xFF02: return 0x7E | this.sc;
      case 0xFF04: return (this.divc >> 8) & 255;
      case 0xFF05: return this.tima; case 0xFF06: return this.tma; case 0xFF07: return 0xF8 | this.tac;
      case 0xFF0F: return 0xE0 | this.ifl;
      case 0xFF4D: return this.cgb ? (this.doubleSpeed ? 0x80 : 0) | 0x7E | (this.speedArmed ? 1 : 0) : 0xFF;
      case 0xFF55: return this.cgb ? (this.hdma.active ? (this.hdma.len - 1) & 0x7F : 0xFF) : 0xFF;
      case 0xFF70: return this.cgb ? 0xF8 | this.wbank : 0xFF;
    }
    if (a >= 0xFF10 && a < 0xFF40) return this.apu.read(a);
    if (a >= 0xFF40 && a <= 0xFF4B) { if (a === 0xFF46) return 0xFF; return this.ppu.readReg(a); }
    if (a >= 0xFF4F && a <= 0xFF6B && (a === 0xFF4F || a >= 0xFF68)) return this.ppu.readReg(a);
    return this.io[a - 0xFF00] | 0;
  }
  writeIo(a, v) {
    switch (a) {
      case 0xFF00: this.joySel = v & 0x30; return;
      case 0xFF01: this.sb = v; return;
      case 0xFF02:
        this.sc = v & 1;
        if ((v & 0x81) === 0x81) { this.serialOut += String.fromCharCode(this.sb); this.sb = 0xFF; this.ifl |= 8; }
        return;
      case 0xFF04: this.divc = 0; return;
      case 0xFF05: this.tima = v; return; case 0xFF06: this.tma = v; return; case 0xFF07: this.tac = v & 7; return;
      case 0xFF0F: this.ifl = v & 0x1F; return;
      case 0xFF46: { const s = v << 8; for (let i = 0; i < 160; i++) this.ppu.oam[i] = this.read(s + i); return; }
      case 0xFF4D: if (this.cgb) this.speedArmed = (v & 1) !== 0; return;
      case 0xFF51: this.hdma.src = (this.hdma.src & 0xFF) | (v << 8); return;
      case 0xFF52: this.hdma.src = (this.hdma.src & 0xFF00) | (v & 0xF0); return;
      case 0xFF53: this.hdma.dst = (this.hdma.dst & 0xFF) | ((v & 0x1F) << 8); return;
      case 0xFF54: this.hdma.dst = (this.hdma.dst & 0xFF00) | (v & 0xF0); return;
      case 0xFF55: if (this.cgb) this.hdmaWrite(v); return;
      case 0xFF70: if (this.cgb) this.wbank = (v & 7) || 1; return;
    }
    if (a >= 0xFF10 && a < 0xFF40) { this.apu.write(a, v); return; }
    if (a >= 0xFF40 && a <= 0xFF4B) { this.ppu.writeReg(a, v); return; }
    if (a === 0xFF4F || (a >= 0xFF68 && a <= 0xFF6B)) { this.ppu.writeReg(a, v); return; }
    this.io[a - 0xFF00] = v;
  }
  /* ---- DMA do CGB ---- */
  hdmaWrite(v) {
    const h = this.hdma;
    if (h.active && !(v & 0x80)) { h.active = false; this.hdmaActive = false; return; }
    h.len = (v & 0x7F) + 1;
    if (v & 0x80) { h.active = true; this.hdmaActive = true; if (this.ppu.mode === 0 || !(this.ppu.lcdc & 0x80)) this.hdmaStep(); return; }
    while (h.len > 0) { this.hdmaBlock(); h.len--; }
    this.extra += 8 * (v & 0x7F) * 2 + 16; h.active = false; this.hdmaActive = false;
  }
  hdmaBlock() {
    const h = this.hdma, vram = this.ppu.vram, bank = (this.ppu.vbk & 1) << 13;
    for (let i = 0; i < 16; i++) { vram[bank | ((h.dst + i) & 0x1FFF)] = this.read((h.src + i) & 0xFFFF); }
    h.src = (h.src + 16) & 0xFFFF; h.dst = (h.dst + 16) & 0x1FFF;
  }
  hdmaStep() {
    const h = this.hdma; if (!h.active) return;
    this.hdmaBlock(); h.len--; this.extra += 8;
    if (h.len <= 0) { h.active = false; this.hdmaActive = false; h.len = 0; }
  }
  stop() { if (this.cgb && this.speedArmed) { this.doubleSpeed = !this.doubleSpeed; this.speedArmed = false; this.divc = 0; } }
  /* ---- Game Genie ---- */
  ggRead(a, v) {
    const g = this.gg;
    for (let i = 0; i < g.length; i++) if (g[i].addr === a && (g[i].cmp < 0 || g[i].cmp === v)) return g[i].val;
    return v;
  }
  /* ---- entrada ---- */
  setButtons(m) {
    const old = this.buttons; this.buttons = m & 0xFF;
    if (this.buttons & ~old) this.ifl |= 16; // joypad
  }
  /* ---- laço principal ---- */
  runFrame() {
    const cpu = this.cpu, ppu = this.ppu, apu = this.apu;
    ppu.frameDone = false;
    let cycles = 0, rem = 0;
    while (!ppu.frameDone && cycles < GB_FRAME * 2) {
      const c = cpu.step() + this.extra; this.extra = 0;
      cycles += c;
      this.timerTick(c);
      let d = c; if (this.doubleSpeed) { d += rem; rem = d & 1; d >>= 1; }
      ppu.tick(d); apu.tick(d);
    }
  }
  timerTick(c) {
    const old = this.divc; this.divc += c;
    if (this.divc > 0x40000000) this.divc -= 0x10000000;
    if (this.tac & 4) {
      const sh = [10, 4, 6, 8][this.tac & 3];
      let edges = (this.divc >> sh) - (old >> sh);
      if (this.divc < old) edges = ((this.divc + 0x10000000) >> sh) - (old >> sh);
      if (edges > 0) {
        this.tima += edges;
        while (this.tima > 255) { this.tima = this.tma + (this.tima - 256); this.ifl |= 4; }
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GB };
