'use strict';
/* NES emulator feito do zero — CPU 6502, PPU, APU, mappers 0/1/2/3/4/7 */

const MIR_H = 0, MIR_V = 1, MIR_S0 = 2, MIR_S1 = 3, MIR_4 = 4;

/* ============================== CARTUCHO ============================== */
class Cartridge {
  constructor(buf) {
    const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (d.length < 16 || d[0] !== 0x4E || d[1] !== 0x45 || d[2] !== 0x53 || d[3] !== 0x1A)
      throw new Error('Arquivo inválido: não é uma ROM .nes (iNES)');
    const prgBanks = d[4], chrBanks = d[5], f6 = d[6], f7 = d[7];
    this.mapper = (f7 & 0xF0) | (f6 >> 4);
    this.mirror = (f6 & 8) ? MIR_4 : ((f6 & 1) ? MIR_V : MIR_H);
    this.battery = !!(f6 & 2);
    let off = 16 + ((f6 & 4) ? 512 : 0);
    this.prg = d.slice(off, off + prgBanks * 16384); off += prgBanks * 16384;
    if (chrBanks > 0) { this.chr = d.slice(off, off + chrBanks * 8192); this.chrRam = false; }
    else { this.chr = new Uint8Array(8192); this.chrRam = true; }
    this.prgRam = new Uint8Array(8192);
    if (this.prg.length === 0) throw new Error('ROM sem dados de programa');
    if (![0, 1, 2, 3, 4, 7].includes(this.mapper))
      throw new Error('Mapper ' + this.mapper + ' ainda não é suportado');
    this.irq = false;
    this.reset();
  }

  reset() {
    this.sr = 0x10; this.ctrl = 0x0C; this.chr0 = 0; this.chr1 = 0; this.prgReg = 0; // MMC1
    this.bank = 0;                                                                     // 2,3,7
    this.bsel = 0; this.regs = [0, 2, 4, 5, 6, 7, 0, 1];                               // MMC3
    this.irqLatch = 0; this.irqCounter = 0; this.irqReload = false; this.irqEnable = false;
    this.n8 = Math.max(2, this.prg.length >> 13);
    this.irq = false;
    if (this.mapper === 1) this.mmc1Mirror();
  }

  prgAddr(a) {
    const len = this.prg.length;
    switch (this.mapper) {
      case 1: {
        const mode = (this.ctrl >> 2) & 3;
        if (mode < 2) return (((this.prgReg & 0xE) << 14) + (a - 0x8000)) % len;
        let b;
        if (mode === 2) b = a < 0xC000 ? 0 : (this.prgReg & 0xF);
        else b = a < 0xC000 ? (this.prgReg & 0xF) : ((len >> 14) - 1);
        return ((b << 14) + (a & 0x3FFF)) % len;
      }
      case 2: {
        const b = a < 0xC000 ? this.bank : (len >> 14) - 1;
        return ((b << 14) + (a & 0x3FFF)) % len;
      }
      case 4: {
        const slot = (a >> 13) & 3; let b;
        if (slot === 3) b = this.n8 - 1;
        else if (slot === 1) b = this.regs[7];
        else b = ((slot === 0) === ((this.bsel & 0x40) === 0)) ? this.regs[6] : this.n8 - 2;
        return (((b & 0x3F) % this.n8) << 13) + (a & 0x1FFF);
      }
      case 7: return (((this.bank & 7) << 15) + (a - 0x8000)) % len;
      default: return (a - 0x8000) % len; // 0, 3
    }
  }

  chrAddr(a) {
    const len = this.chr.length;
    switch (this.mapper) {
      case 1:
        if (!(this.ctrl & 0x10)) return (((this.chr0 & 0x1E) << 12) + a) % len;
        return a < 0x1000 ? ((this.chr0 << 12) + a) % len : ((this.chr1 << 12) + (a & 0xFFF)) % len;
      case 3: return ((this.bank << 13) + a) % len;
      case 4: {
        let x = a; if (this.bsel & 0x80) x ^= 0x1000;
        const slot = x >> 10; let b; const r = this.regs;
        switch (slot) {
          case 0: b = r[0] & 0xFE; break; case 1: b = r[0] | 1; break;
          case 2: b = r[1] & 0xFE; break; case 3: b = r[1] | 1; break;
          default: b = r[slot - 2];
        }
        return (((b % (len >> 10)) << 10) + (a & 0x3FF));
      }
      default: return a;
    }
  }

  cpuRead(a) {
    if (a >= 0x8000) {
      const v = this.prg[this.prgAddr(a)], g = this.gg;
      if (g) for (let i = 0; i < g.length; i++) if (g[i].addr === a && (g[i].cmp < 0 || g[i].cmp === v)) return g[i].val;
      return v;
    }
    if (a >= 0x6000) return this.prgRam[a - 0x6000];
    return 0;
  }

  cpuWrite(a, v) {
    if (a >= 0x6000 && a < 0x8000) { this.prgRam[a - 0x6000] = v; return; }
    if (a < 0x8000) return;
    switch (this.mapper) {
      case 1: this.mmc1Write(a, v); break;
      case 2: this.bank = v; break;
      case 3: this.bank = v & 3; break;
      case 7: this.bank = v; this.mirror = (v & 0x10) ? MIR_S1 : MIR_S0; break;
      case 4: this.mmc3Write(a, v); break;
    }
  }

  mmc1Write(a, v) {
    if (v & 0x80) { this.sr = 0x10; this.ctrl |= 0x0C; this.mmc1Mirror(); return; }
    const last = this.sr & 1;
    this.sr = (this.sr >> 1) | ((v & 1) << 4);
    if (last) {
      const r = (a >> 13) & 3, val = this.sr;
      if (r === 0) { this.ctrl = val; this.mmc1Mirror(); }
      else if (r === 1) this.chr0 = val;
      else if (r === 2) this.chr1 = val;
      else this.prgReg = val;
      this.sr = 0x10;
    }
  }
  mmc1Mirror() { this.mirror = [MIR_S0, MIR_S1, MIR_V, MIR_H][this.ctrl & 3]; }

  mmc3Write(a, v) {
    const even = !(a & 1);
    if (a < 0xA000) { if (even) this.bsel = v; else this.regs[this.bsel & 7] = v; }
    else if (a < 0xC000) { if (even && this.mirror !== MIR_4) this.mirror = (v & 1) ? MIR_H : MIR_V; }
    else if (a < 0xE000) { if (even) this.irqLatch = v; else { this.irqCounter = 0; this.irqReload = true; } }
    else { if (even) { this.irqEnable = false; this.irq = false; } else this.irqEnable = true; }
  }

  scanline() { // chamado uma vez por scanline renderizada (MMC3)
    if (this.mapper !== 4) return;
    if (this.irqCounter === 0 || this.irqReload) { this.irqCounter = this.irqLatch; this.irqReload = false; }
    else this.irqCounter--;
    if (this.irqCounter === 0 && this.irqEnable) this.irq = true;
  }

  chrRead(a) { return this.chr[this.chrAddr(a)]; }
  chrWrite(a, v) { if (this.chrRam) this.chr[this.chrAddr(a)] = v; }
}

