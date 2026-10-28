'use strict';
/* Sistema SNES: mapa de memória (LoROM/HiROM), registradores da CPU ($4200-$43FF), DMA/HDMA,
 * temporização por linha (1364 ciclos mestres), NMI/IRQ, joypads e ligação PPU/APU. */
const SNES_LINE = 1364, SNES_LINES = 262, SNES_HBLANK = 1096;

class SNES {
  constructor() {
    this.cpu = new CPU65816(this);
    this.ppu = new SNESPPU(this);
    this.apu = new SNESAPU(this);
    this.rom = new Uint8Array(0x8000); this.romMask = 0x7FFF; this.hiRom = false;
    this.sram = new Uint8Array(0); this.sramMask = 0;
    this.wram = new Uint8Array(0x20000);
    this.cyc = 0; this.line = 0; this.frameCount = 0; this.clk = 1;
    this.nmiPending = false; this.irqLine = false; this.mdr = 0;
    this.memsel = 0; this.nmitimen = 0; this.rdnmi = 0; this.timeup = 0; this.hvbjoy = 0;
    this.htime = 0x1FF; this.vtime = 0x1FF; this.irqFired = false;
    this.wmadd = 0; this.wrio = 0xFF;
    this.mulA = 0xFF; this.mulRes = 0; this.divQ = 0; this.divR = 0; this.divA = 0xFFFF;
    this.joy = new Uint16Array(4); this.joyAuto = new Uint16Array(4); this.joyShift = new Uint16Array(2); this.joyStrobe = 0;
    this.buttons = 0; // máscara do hub
    this.hLatch = 0; this.vLatch = 0; this.latchFlag = 0; this.hSel = 0; this.vSel = 0;
    this.dmaEn = 0; this.hdmaEn = 0;
    this.ch = [];
    for (let i = 0; i < 8; i++) this.ch.push({ ctl: 0xFF, bbad: 0xFF, a1t: 0xFFFF, a1b: 0xFF, das: 0xFFFF, dasb: 0xFF, a2a: 0xFFFF, ntrl: 0xFF, unused: 0xFF, doTransfer: false, done: true });
  }
  load(rom, hiRom, sramBytes) {
    this.rom = rom; this.hiRom = hiRom;
    let m = 1; while (m < rom.length) m <<= 1; this.romMask = m - 1; // espelhamento por potência de dois
    this.romLen = rom.length;
    this.sram = new Uint8Array(sramBytes || 0); this.sramMask = sramBytes ? sramBytes - 1 : 0;
    this.reset();
  }
  reset() {
    this.wram.fill(0); this.cyc = 0; this.line = 0; this.nmiPending = false; this.irqLine = false;
    this.nmitimen = 0; this.rdnmi = 0; this.timeup = 0; this.hvbjoy = 0; this.memsel = 0; this.dmaEn = 0; this.hdmaEn = 0; this.irqFired = false;
    this.htime = 0x1FF; this.vtime = 0x1FF;
    this.ppu.reset(); this.apu.reset(); this.cpu.reset();
  }
  /* ---------- mapa de memória ---------- */
  romAt(bank, off) {
    // hiROM: bancos 00-3F/80-BF 8000-FFFF e 40-7D/C0-FF; loROM: 32 KB por banco
    if (this.hiRom) return this.rom[(((bank & 0x3F) << 16) | off) & this.romMask];
    return this.rom[(((bank & 0x7F) << 15) | (off & 0x7FFF)) & this.romMask];
  }
  speed(a) {
    const bank = a >>> 16, off = a & 0xFFFF;
    if (!(bank & 0x40)) {
      if (off < 0x2000) return 8;
      if (off < 0x4000) return 6;
      if (off < 0x4200) return 12;
      if (off < 0x6000) return 6;
      if (off < 0x8000) return 8;
      return (bank & 0x80) && (this.memsel & 1) ? 6 : 8;
    }
    return (bank >= 0xC0 && (this.memsel & 1)) ? 6 : 8;
  }
  idle(n) { this.cyc += 6 * n * this.clk; }
  read(a) { this.cyc += this.speed(a) * this.clk; return (this.mdr = this.rawRead(a)); }
  write(a, v) { this.cyc += this.speed(a) * this.clk; this.rawWrite(a, v); }
  rawRead(a) {
    const bank = a >>> 16, off = a & 0xFFFF;
    if (bank === 0x7E || bank === 0x7F) return this.wram[((bank & 1) << 16) | off];
    if (!(bank & 0x40)) { // 00-3F e 80-BF
      if (off < 0x2000) return this.wram[off];
      if (off < 0x8000) {
        if (off < 0x2100) return this.mdr;
        if (off < 0x2140) return this.ppu.readReg(off);
        if (off < 0x2180) return this.apuRead(off & 3);
        if (off === 0x2180) { const v = this.wram[this.wmadd]; this.wmadd = (this.wmadd + 1) & 0x1FFFF; return v; }
        if (off >= 0x4200 && off < 0x4400) return this.regRead(off);
        if (off === 0x4016 || off === 0x4017) return this.joyRead(off & 1);
        if (off >= 0x6000 && this.hiRom && (bank & 0x3F) >= 0x20 && this.sramMask) return this.sram[(((bank & 0x1F) << 13) | (off - 0x6000)) & this.sramMask];
        return this.mdr;
      }
      return this.romAt(bank, off);
    }
    // 40-7D e C0-FF
    if (this.hiRom) return this.rom[(((bank & 0x3F) << 16) | off) & this.romMask];
    if (bank >= 0x70 && bank < 0x7E && off < 0x8000) return this.sramMask ? this.sram[(((bank - 0x70) << 15) | off) & this.sramMask] : this.mdr;
    if (bank >= 0xF0 && off < 0x8000) return this.sramMask ? this.sram[(((bank - 0xF0) << 15) | off) & this.sramMask] : this.mdr;
    return this.rom[(((bank & 0x7F) << 15) | (off & 0x7FFF)) & this.romMask];
  }
  rawWrite(a, v) {
    const bank = a >>> 16, off = a & 0xFFFF;
    if (bank === 0x7E || bank === 0x7F) { this.wram[((bank & 1) << 16) | off] = v; return; }
    if (!(bank & 0x40)) {
      if (off < 0x2000) { this.wram[off] = v; return; }
      if (off < 0x8000) {
        if (off < 0x2100) return;
        if (off < 0x2140) { this.ppu.writeReg(off, v); return; }
        if (off < 0x2180) { this.apuWrite(off & 3, v); return; }
        if (off === 0x2180) { this.wram[this.wmadd] = v; this.wmadd = (this.wmadd + 1) & 0x1FFFF; return; }
        if (off === 0x2181) { this.wmadd = (this.wmadd & 0x1FF00) | v; return; }
        if (off === 0x2182) { this.wmadd = (this.wmadd & 0x100FF) | (v << 8); return; }
        if (off === 0x2183) { this.wmadd = (this.wmadd & 0xFFFF) | ((v & 1) << 16); return; }
        if (off === 0x4016) { this.joyStrobe = v & 1; if (this.joyStrobe) { this.joyShift[0] = this.joy[0]; this.joyShift[1] = this.joy[1]; } return; }
        if (off >= 0x4200 && off < 0x4400) { this.regWrite(off, v); return; }
        if (off >= 0x6000 && this.hiRom && (bank & 0x3F) >= 0x20 && this.sramMask) this.sram[(((bank & 0x1F) << 13) | (off - 0x6000)) & this.sramMask] = v;
      }
      return;
    }
    if (this.hiRom) return;
    if (this.sramMask && off < 0x8000) {
      if (bank >= 0x70 && bank < 0x7E) this.sram[(((bank - 0x70) << 15) | off) & this.sramMask] = v;
      else if (bank >= 0xF0) this.sram[(((bank - 0xF0) << 15) | off) & this.sramMask] = v;
    }
  }
  /* ---------- APU (portas 2140-2143) com sincronização preguiçosa ---------- */
  apuRead(p) { this.apu.sync(this.cyc); return this.apu.outPorts[p]; }
  apuWrite(p, v) { this.apu.sync(this.cyc); this.apu.inPorts[p] = v; this.apu.portClock = this.apu.clock; }
  /* ---------- joypads ---------- */
  setButtons(m) {
    // máscara do hub -> bits do SNES: B Y Sel Start Up Down Left Right A X L R
    let j = 0;
    if (m & 2) j |= 0x8000; if (m & 512) j |= 0x4000; if (m & 4) j |= 0x2000; if (m & 8) j |= 0x1000;
    if (m & 16) j |= 0x0800; if (m & 32) j |= 0x0400; if (m & 64) j |= 0x0200; if (m & 128) j |= 0x0100;
    if (m & 1) j |= 0x0080; if (m & 256) j |= 0x0040; if (m & 1024) j |= 0x0020; if (m & 2048) j |= 0x0010;
    // direções opostas não acontecem no controle real
    if ((j & 0x0C00) === 0x0C00) j &= ~0x0C00; if ((j & 0x0300) === 0x0300) j &= ~0x0300;
    this.joy[0] = j;
  }
  joyRead(p) {
    if (this.joyStrobe) return (this.mdr & 0xFC) | ((this.joy[p] & 0x8000) ? 1 : 0);
    const v = (this.joyShift[p] & 0x8000) ? 1 : 0;
    this.joyShift[p] = ((this.joyShift[p] << 1) | 1) & 0xFFFF; // depois dos 16 bits o controle devolve 1
    return (this.mdr & 0xFC) | v;
  }
  /* ---------- registradores $4200-$43FF ---------- */
  regRead(a) {
    switch (a) {
      case 0x4210: { const v = this.rdnmi | 0x02; this.rdnmi = 0; return v | (this.mdr & 0x70); }
      case 0x4211: { const v = this.timeup; this.timeup = 0; this.irqLine = false; return v | (this.mdr & 0x7F); }
      case 0x4212: return this.hvbjoy | (this.cyc >= SNES_HBLANK ? 0x40 : 0) | (this.line >= 225 ? 0x80 : 0) | (this.mdr & 0x3E);
      case 0x4213: return this.wrio;
      case 0x4214: return this.divQ & 0xFF; case 0x4215: return this.divQ >> 8;
      case 0x4216: return this.mulRes & 0xFF; case 0x4217: return (this.mulRes >> 8) & 0xFF;
      case 0x4218: case 0x421A: case 0x421C: case 0x421E: return this.joyAuto[(a - 0x4218) >> 1] & 0xFF;
      case 0x4219: case 0x421B: case 0x421D: case 0x421F: return this.joyAuto[(a - 0x4218) >> 1] >> 8;
    }
    if (a >= 0x4300 && a < 0x4380) {
      const c = this.ch[(a >> 4) & 7];
      switch (a & 0xF) {
        case 0: return c.ctl; case 1: return c.bbad; case 2: return c.a1t & 0xFF; case 3: return c.a1t >> 8; case 4: return c.a1b;
        case 5: return c.das & 0xFF; case 6: return c.das >> 8; case 7: return c.dasb; case 8: return c.a2a & 0xFF; case 9: return c.a2a >> 8;
        case 10: return c.ntrl; default: return c.unused;
      }
    }
    return this.mdr;
  }
  regWrite(a, v) {
    switch (a) {
      case 0x4200: {
        const was = this.nmitimen; this.nmitimen = v;
        if (!(v & 0x80)) this.nmiPending = false;
        else if (!(was & 0x80) && (this.rdnmi & 0x80)) this.nmiPending = true; // ligou o NMI durante o vblank
        if (!(v & 0x30)) { this.irqLine = false; }
        return;
      }
      case 0x4201: this.wrio = v; return;
      case 0x4202: this.mulA = v; return;
      case 0x4203: this.mulRes = this.mulA * v; return;
      case 0x4204: this.divA = (this.divA & 0xFF00) | v; return;
      case 0x4205: this.divA = (this.divA & 0xFF) | (v << 8); return;
      case 0x4206: if (v) { this.divQ = (this.divA / v) | 0; this.mulRes = this.divA % v; } else { this.divQ = 0xFFFF; this.mulRes = this.divA; } return;
      case 0x4207: this.htime = (this.htime & 0x100) | v; return;
      case 0x4208: this.htime = (this.htime & 0xFF) | ((v & 1) << 8); return;
      case 0x4209: this.vtime = (this.vtime & 0x100) | v; return;
      case 0x420A: this.vtime = (this.vtime & 0xFF) | ((v & 1) << 8); return;
      case 0x420B: this.dmaEn = v; if (v) this.runDma(); return;
      case 0x420C: this.hdmaEn = v; return;
      case 0x420D: this.memsel = v & 1; return;
    }
    if (a >= 0x4300 && a < 0x4380) {
      const c = this.ch[(a >> 4) & 7];
      switch (a & 0xF) {
        case 0: c.ctl = v; break; case 1: c.bbad = v; break;
        case 2: c.a1t = (c.a1t & 0xFF00) | v; break; case 3: c.a1t = (c.a1t & 0xFF) | (v << 8); break; case 4: c.a1b = v; break;
        case 5: c.das = (c.das & 0xFF00) | v; break; case 6: c.das = (c.das & 0xFF) | (v << 8); break; case 7: c.dasb = v; break;
        case 8: c.a2a = (c.a2a & 0xFF00) | v; break; case 9: c.a2a = (c.a2a & 0xFF) | (v << 8); break;
        case 10: c.ntrl = v; break; default: c.unused = v;
      }
    }
  }
  /* ---------- DMA ---------- */
  readB(r) { // barramento B (2100-21FF) sem custo de ciclo
    if (r < 0x40) return this.ppu.readReg(0x2100 + r);
    if (r < 0x80) return this.apuRead(r & 3);
    if (r === 0x80) { const v = this.wram[this.wmadd]; this.wmadd = (this.wmadd + 1) & 0x1FFFF; return v; }
    return 0;
  }
  writeB(r, v) { this.rawWrite(0x2100 + r, v); }
  runDma() {
    const O = SNES_DMA_OFFS;
    this.cyc += 16;
    for (let i = 0; i < 8; i++) {
      if (!(this.dmaEn & (1 << i))) continue;
      const c = this.ch[i], mode = c.ctl & 7, offs = O[mode], dir = c.ctl & 0x80;
      const step = (c.ctl & 0x08) ? 0 : ((c.ctl & 0x10) ? -1 : 1);
      let n = c.das || 0x10000, k = 0;
      this.cyc += 8;
      while (n > 0) {
        const b = (c.bbad + offs[k & (offs.length - 1)]) & 0xFF, aa = (c.a1b << 16) | c.a1t;
        if (dir) { this.rawWrite(aa, this.readB(b)); } else { const v = this.rawRead(aa); this.writeB(b, v); }
        c.a1t = (c.a1t + step) & 0xFFFF;
        k++; n--; this.cyc += 8;
      }
      c.das = 0;
    }
    this.dmaEn = 0;
  }
  /* ---------- HDMA ---------- */
  hdmaInit() {
    for (let i = 0; i < 8; i++) {
      const c = this.ch[i]; c.done = !(this.hdmaEn & (1 << i)); c.doTransfer = false;
      if (c.done) continue;
      c.a2a = c.a1t; this.hdmaLoad(c);
    }
  }
  hdmaLoad(c) {
    c.ntrl = this.rawRead((c.a1b << 16) | c.a2a); c.a2a = (c.a2a + 1) & 0xFFFF;
    if (c.ntrl === 0) { c.done = true; c.doTransfer = false; return; }
    if (c.ctl & 0x40) { c.das = this.rawRead((c.a1b << 16) | c.a2a) | (this.rawRead((c.a1b << 16) | ((c.a2a + 1) & 0xFFFF)) << 8); c.a2a = (c.a2a + 2) & 0xFFFF; }
    c.doTransfer = true;
  }
  hdmaRun() {
    const O = SNES_DMA_OFFS;
    for (let i = 0; i < 8; i++) {
      const c = this.ch[i];
      if (c.done || !(this.hdmaEn & (1 << i))) continue;
      if (c.doTransfer) {
        const offs = O[c.ctl & 7], ind = c.ctl & 0x40;
        for (let k = 0; k < offs.length; k++) {
          let v;
          if (ind) { v = this.rawRead((c.dasb << 16) | c.das); c.das = (c.das + 1) & 0xFFFF; }
          else { v = this.rawRead((c.a1b << 16) | c.a2a); c.a2a = (c.a2a + 1) & 0xFFFF; }
          this.writeB((c.bbad + offs[k]) & 0xFF, v);
        }
        this.cyc += 8 * offs.length + 8;
      }
      c.ntrl = (c.ntrl - 1) & 0xFF; c.doTransfer = (c.ntrl & 0x80) !== 0;
      if ((c.ntrl & 0x7F) === 0) this.hdmaLoad(c);
    }
  }
  /* ---------- quadro ---------- */
  irqTarget() {
    // posição (em ciclos mestres) do IRQ na linha atual, ou -1
    const mode = (this.nmitimen >> 4) & 3;
    if (!mode) return -1;
    if (mode === 1) return this.htime * 4 + 14;
    if (this.line !== this.vtime) return -1;
    return mode === 2 ? 10 : this.htime * 4 + 14;
  }
  runLine() {
    const ppu = this.ppu, cpu = this.cpu, v = this.line;
    let irqAt = this.irqTarget(), rendered = false;
    if (v === 0) { this.rdnmi &= 0x7F; this.hdmaInit(); }
    if (v === 225) {
      this.rdnmi |= 0x80; if (this.nmitimen & 0x80) this.nmiPending = true;
      if (this.nmitimen & 1) { for (let i = 0; i < 4; i++) this.joyAuto[i] = this.joy[i]; this.hvbjoy = 1; }
    } else if (v === 228) this.hvbjoy = 0;
    while (true) {
      if (!rendered && this.cyc >= SNES_HBLANK) {
        rendered = true;
        if (v >= 1 && v <= 224) ppu.renderLine(v - 1);
        if (v <= 224 && this.hdmaEn) this.hdmaRun();
      }
      if (irqAt >= 0 && this.cyc >= irqAt) { irqAt = -1; this.timeup = 0x80; this.irqLine = true; }
      if (this.cyc >= SNES_LINE) break;
      cpu.step();
    }
    this.cyc -= SNES_LINE;
    this.apu.sync(this.cyc + SNES_LINE, true);
    this.line = v + 1;
  }
  runFrame() {
    this.ppu.beginFrame();
    for (let i = 0; i < SNES_LINES; i++) this.runLine();
    this.line = 0; this.frameCount++;
  }
}
const SNES_DMA_OFFS = [[0], [0, 1], [0, 0], [0, 0, 1, 1], [0, 1, 2, 3], [0, 1, 0, 1], [0, 0], [0, 0, 1, 1]];
// tabelas com tamanho em potência de dois para o módulo acima
SNES_DMA_OFFS[0] = [0]; SNES_DMA_OFFS[1] = [0, 1]; SNES_DMA_OFFS[2] = [0, 0]; SNES_DMA_OFFS[3] = [0, 0, 1, 1];

if (typeof module !== 'undefined') module.exports = { SNES };
