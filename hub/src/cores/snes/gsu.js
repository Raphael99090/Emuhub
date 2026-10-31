'use strict';
/* Super FX (GSU-1/GSU-2): RISC de 16 bits que desenha polígonos/pixels direto na RAM do cartucho.
 * Registradores R0-R15, flags Z/CY/S/OV, prefixos ALT1/ALT2/B (TO/FROM/WITH), cache de 512 bytes,
 * cache de pixels do PLOT e leitura de ROM por R14. A CPU enxerga tudo em $3000-$32FF.
 * Temporização aproximada: roda um bloco de ciclos por linha de vídeo. */
class GSU {
  constructor(sys, rom, ramBytes) {
    this.sys = sys; this.rom = rom;
    let m = 1; while (m < rom.length) m <<= 1; this.romMask = m - 1;
    this.ramMask = Math.max(ramBytes, 0x800) - 1; this.ram = new Uint8Array(this.ramMask + 1);
    this.r = new Uint16Array(16); this.cache = new Uint8Array(512); this.cvalid = new Uint8Array(32);
    this.pc0 = { off: 0xFFFF, bit: 0, data: new Uint8Array(8) }; this.pc1 = { off: 0xFFFF, bit: 0, data: new Uint8Array(8) };
    this.reset();
  }
  reset() {
    this.r.fill(0); this.cache.fill(0); this.cvalid.fill(0);
    this.z = false; this.cy = false; this.s = false; this.ov = false; this.running = false; this.irq = false;
    this.alt1 = false; this.alt2 = false; this.b = false; this.sreg = 0; this.dreg = 0;
    this.pbr = 0; this.rombr = 0; this.rambr = 0; this.cbr = 0; this.scbr = 0; this.scmr = 0; this.colr = 0; this.por = 0;
    this.cfgr = 0; this.clsr = 0; this.bramr = 0; this.latch = 0; this.ramaddr = 0; this.romBuf = 0;
    this.pipe = 1; this.jd = 0; this.jt = 0; this.budget = 0; this.cost = 1; this.irqLine = false;
    this.pc0.off = 0xFFFF; this.pc0.bit = 0; this.pc1.off = 0xFFFF; this.pc1.bit = 0;
  }
  /* ---- memória do ponto de vista do GSU ---- */
  mem(bank, a) {
    bank &= 0x7F;
    if (bank < 0x40) return this.rom[((bank << 15) | (a & 0x7FFF)) & this.romMask];
    if (bank < 0x60) return this.rom[(((bank & 0x1F) << 16) | a) & this.romMask];
    if (bank >= 0x70) return this.ram[(((bank & 1) << 16) | a) & this.ramMask];
    return 0;
  }
  code(a) {
    const off = (a - this.cbr) & 0xFFFF;
    if (off < 512) {
      const ln = off >> 4;
      if (!this.cvalid[ln]) {
        const base = (this.cbr + (ln << 4)) & 0xFFFF, o = ln << 4;
        for (let i = 0; i < 16; i++) this.cache[o + i] = this.mem(this.pbr, (base + i) & 0xFFFF);
        this.cvalid[ln] = 1; this.cost += 8;
      }
      return this.cache[off];
    }
    this.cost += 3;
    return this.mem(this.pbr, a);
  }
  ramAt(a) { return ((this.rambr << 16) | (a & 0xFFFF)) & this.ramMask; }
  rdW(a) { this.cost += 2; return this.ram[this.ramAt(a)] | (this.ram[this.ramAt(a ^ 1)] << 8); }
  wrW(a, v) { this.cost += 2; this.ram[this.ramAt(a)] = v & 0xFF; this.ram[this.ramAt(a ^ 1)] = v >> 8; }
  refresh() { this.romBuf = this.mem(this.rombr, this.r[14]); }
  setR(n, v) {
    v &= 0xFFFF;
    if (n === 15) { this.jt = v; this.jd = 1; return; }
    this.r[n] = v; if (n === 14) this.refresh();
  }
  /* ---- interface com a CPU ($3000-$32FF) ---- */
  sfr() {
    return (this.z ? 2 : 0) | (this.cy ? 4 : 0) | (this.s ? 8 : 0) | (this.ov ? 16 : 0) | (this.running ? 32 : 0) |
      (this.alt1 ? 0x100 : 0) | (this.alt2 ? 0x200 : 0) | (this.b ? 0x1000 : 0) | (this.irq ? 0x8000 : 0);
  }
  read(a) {
    if (a >= 0x3100 && a < 0x3300) return this.cache[a - 0x3100];
    if (a < 0x3020) { const n = (a >> 1) & 15, v = this.r[n]; return (a & 1) ? v >> 8 : v & 0xFF; }
    switch (a) {
      case 0x3030: return this.sfr() & 0xFF;
      case 0x3031: { const v = this.sfr() >> 8; this.irq = false; this.sys.gsuIrq = false; return v; }
      case 0x3034: return this.pbr;
      case 0x3036: return this.rombr;
      case 0x303B: return 4;
      case 0x303C: return this.rambr;
      case 0x303E: return this.cbr & 0xFF;
      case 0x303F: return this.cbr >> 8;
    }
    return 0;
  }
  write(a, v) {
    if (a >= 0x3100 && a < 0x3300) { const o = a - 0x3100; this.cache[o] = v; if ((o & 15) === 15) this.cvalid[o >> 4] = 1; return; }
    if (a < 0x3020) {
      const n = (a >> 1) & 15;
      if (!(a & 1)) { this.latch = v; return; }
      const val = (v << 8) | this.latch;
      this.r[n] = val; if (n === 14) this.refresh();
      if (n === 15) this.go();
      return;
    }
    switch (a) {
      case 0x3030: {
        const was = this.running; this.z = !!(v & 2); this.cy = !!(v & 4); this.s = !!(v & 8); this.ov = !!(v & 16);
        this.running = !!(v & 32);
        if (was && !this.running) { this.cbr = 0; this.cvalid.fill(0); }
        return;
      }
      case 0x3033: this.bramr = v & 1; return;
      case 0x3034: this.pbr = v & 0x7F; this.cvalid.fill(0); return;
      case 0x3037: this.cfgr = v; return;
      case 0x3038: this.scbr = v; return;
      case 0x3039: this.clsr = v & 1; return;
      case 0x303A: this.scmr = v; return;
    }
  }
  go() {
    this.running = true; this.jd = 0; this.alt1 = this.alt2 = this.b = false; this.sreg = this.dreg = 0;
    this.pipe = this.code(this.r[15]);
  }
  /* ---- execução ---- */
  run(master) {
    if (!this.running) { this.budget = 0; return; }
    this.budget += master * (this.clsr ? 1 : 0.5);
    while (this.running && this.budget > 0) this.budget -= this.step();
    if (!this.running) this.budget = 0;
  }
  byte() { const v = this.pipe; const r = this.r; r[15] = (r[15] + 1) & 0xFFFF; this.pipe = this.code(r[15]); return v; }
  step() {
    this.cost = 1;
    const r = this.r, op = this.pipe;
    r[15] = (r[15] + 1) & 0xFFFF; this.pipe = this.code(r[15]);
    this.exec(op);
    if (this.jd === 2) { r[15] = this.jt; this.pipe = this.code(r[15]); this.jd = 0; }
    else if (this.jd === 1) this.jd = 2;
    return this.cost;
  }
  nz(v) { this.s = (v & 0x8000) !== 0; this.z = v === 0; }
  wd(v) { this.setR(this.dreg, v); }
  color(c) {
    if (this.por & 4) return (this.colr & 0xF0) | (c >> 4);
    if (this.por & 8) return (this.colr & 0xF0) | (c & 15);
    return c;
  }
  exec(op) {
    const R = this.r, n = op & 15, a = (this.alt2 ? 2 : 0) | (this.alt1 ? 1 : 0), sr = R[this.sreg];
    let prefix = false, v;
    switch (op >> 4) {
      case 0:
        switch (n) {
          case 0: this.running = false; this.irq = true; if (!(this.cfgr & 0x80)) this.sys.gsuIrq = true; this.flush(this.pc1); this.flush(this.pc0); break;
          case 1: break;
          case 2: if (this.cbr !== (R[15] & 0xFFF0)) { this.cbr = R[15] & 0xFFF0; this.cvalid.fill(0); } break;
          case 3: this.cy = (sr & 1) !== 0; v = sr >> 1; this.s = false; this.z = v === 0; this.wd(v); break;
          case 4: v = ((sr << 1) | (this.cy ? 1 : 0)) & 0xFFFF; this.cy = (sr & 0x8000) !== 0; this.nz(v); this.wd(v); break;
          default: {
            const off = (this.byte() << 24) >> 24; let t;
            switch (n) {
              case 5: t = true; break; case 6: t = this.s === this.ov; break; case 7: t = this.s !== this.ov; break;
              case 8: t = !this.z; break; case 9: t = this.z; break; case 10: t = !this.s; break; case 11: t = this.s; break;
              case 12: t = !this.cy; break; case 13: t = this.cy; break; case 14: t = !this.ov; break; default: t = this.ov;
            }
            if (t) { this.jt = (R[15] + off) & 0xFFFF; this.jd = 1; }
          }
        }
        break;
      case 1: if (!this.b) { this.dreg = n; prefix = true; } else this.setR(n, sr); break;
      case 2: this.sreg = this.dreg = n; this.b = true; prefix = true; break;
      case 3:
        if (n < 12) { const ad = R[n]; this.ramaddr = ad; if (this.alt1) { this.ram[this.ramAt(ad)] = sr & 0xFF; this.cost += 2; } else this.wrW(ad, sr); }
        else if (n === 12) { v = (R[12] - 1) & 0xFFFF; R[12] = v; this.nz(v); if (v) { this.jt = R[13]; this.jd = 1; } }
        else { if (n === 13) this.alt1 = true; else if (n === 14) this.alt2 = true; else { this.alt1 = true; this.alt2 = true; } prefix = true; }
        break;
      case 4:
        if (n < 12) { const ad = R[n]; this.ramaddr = ad; if (this.alt1) { v = this.ram[this.ramAt(ad)]; this.cost += 2; } else v = this.rdW(ad); this.wd(v); }
        else if (n === 12) { if (this.alt1) this.rpix(); else this.plot(); }
        else if (n === 13) { v = ((sr << 8) | (sr >> 8)) & 0xFFFF; this.nz(v); this.wd(v); }
        else if (n === 14) { if (this.alt1) this.por = sr & 0x1F; else this.colr = this.color(sr & 0xFF); }
        else { v = ~sr & 0xFFFF; this.nz(v); this.wd(v); }
        break;
      case 5: {
        const m = this.alt2 ? n : R[n], c = this.alt1 && this.cy ? 1 : 0, t = sr + m + c;
        this.ov = (~(sr ^ m) & (m ^ t) & 0x8000) !== 0; this.cy = t >= 0x10000; v = t & 0xFFFF; this.nz(v); this.wd(v);
        break;
      }
      case 6: {
        const m = a === 2 ? n : R[n], c = a === 1 && !this.cy ? 1 : 0, t = sr - m - c;
        this.ov = ((sr ^ m) & (sr ^ t) & 0x8000) !== 0; this.cy = t >= 0; v = t & 0xFFFF; this.nz(v);
        if (a !== 3) this.wd(v);
        break;
      }
      case 7:
        if (n === 0) {
          v = (R[7] & 0xFF00) | (R[8] >> 8);
          this.s = (v & 0x8080) !== 0; this.ov = (v & 0xC0C0) !== 0; this.cy = (v & 0xE0E0) !== 0; this.z = (v & 0xF0F0) !== 0; this.wd(v);
        } else {
          const m = (a & 2) ? n : R[n];
          v = (a & 1) ? sr & ~m & 0xFFFF : sr & m; this.nz(v); this.wd(v);
        }
        break;
      case 8: {
        const m = (a & 2) ? n : R[n];
        v = (a & 1) ? ((sr & 255) * (m & 255)) & 0xFFFF : (((sr << 24) >> 24) * ((m << 24) >> 24)) & 0xFFFF;
        this.nz(v); this.wd(v); this.cost += this.clsr ? 1 : 0;
        break;
      }
      case 9:
        switch (n) {
          case 0: this.wrW(this.ramaddr, sr); break;
          case 1: case 2: case 3: case 4: this.setR(11, R[15] + n); break;
          case 5: v = ((sr << 24) >> 24) & 0xFFFF; this.nz(v); this.wd(v); break;
          case 6:
            this.cy = (sr & 1) !== 0;
            if (this.alt1) v = sr === 0xFFFF ? 0 : (((sr << 16) >> 16) >> 1) & 0xFFFF; else v = (((sr << 16) >> 16) >> 1) & 0xFFFF;
            this.nz(v); this.wd(v); break;
          case 7: v = ((this.cy ? 0x8000 : 0) | (sr >> 1)) & 0xFFFF; this.cy = (sr & 1) !== 0; this.nz(v); this.wd(v); break;
          case 14: v = sr & 0xFF; this.s = (v & 0x80) !== 0; this.z = v === 0; this.wd(v); break;
          case 15: {
            const p = ((sr << 16) >> 16) * ((R[6] << 16) >> 16);
            v = (p >> 16) & 0xFFFF; this.cy = (p & 0x8000) !== 0; this.nz(v);
            if (this.alt1) { R[4] = p & 0xFFFF; this.z = v === 0; }
            this.wd(v); this.cost += this.clsr ? 3 : 2;
            break;
          }
          default: // 8-13: JMP/LJMP
            if (this.alt1) { this.pbr = R[n] & 0x7F; this.cbr = sr & 0xFFF0; this.cvalid.fill(0); this.jt = sr; this.jd = 1; }
            else { this.jt = R[n]; this.jd = 1; }
        }
        break;
      case 10:
        if (a === 1) { const ad = this.byte() << 1; this.ramaddr = ad; this.setR(n, this.rdW(ad)); }
        else if (a === 2) { const ad = this.byte() << 1; this.ramaddr = ad; this.wrW(ad, R[n]); }
        else this.setR(n, (this.byte() << 24) >> 24);
        break;
      case 11:
        if (!this.b) { this.sreg = n; prefix = true; }
        else { v = R[n]; this.ov = (v & 0x80) !== 0; this.s = (v & 0x8000) !== 0; this.z = v === 0; this.wd(v); }
        break;
      case 12:
        if (n === 0) { v = sr >> 8; this.s = (v & 0x80) !== 0; this.z = v === 0; this.wd(v); }
        else { const m = (a & 2) ? n : R[n]; v = (a & 1) ? sr ^ m : sr | m; this.nz(v); this.wd(v); }
        break;
      case 13:
        if (n < 15) { v = (R[n] + 1) & 0xFFFF; this.setR(n, v); this.nz(v); }
        else if (a === 2) this.rambr = sr & 1;
        else if (a === 3) { this.rombr = sr & 0x7F; this.refresh(); }
        else this.colr = this.color(this.romBuf);
        break;
      case 14:
        if (n < 15) { v = (R[n] - 1) & 0xFFFF; this.setR(n, v); this.nz(v); }
        else { this.cost += 1; this.wd(a === 0 ? this.romBuf : a === 1 ? (this.romBuf << 8) | (sr & 0xFF) : a === 2 ? (sr & 0xFF00) | this.romBuf : ((this.romBuf << 24) >> 24) & 0xFFFF); }
        break;
      default: {
        const lo = this.byte(), hi = this.byte(), ad = lo | (hi << 8);
        if (a === 1) { this.ramaddr = ad; this.setR(n, this.rdW(ad)); }
        else if (a === 2) { this.ramaddr = ad; this.wrW(ad, R[n]); }
        else this.setR(n, ad);
      }
    }
    if (!prefix) { this.alt1 = this.alt2 = this.b = false; this.sreg = this.dreg = 0; }
  }
  /* ---- pixels ---- */
  get md() { return this.scmr & 3; }
  get ht() { return (((this.scmr >> 5) & 1) << 1) | ((this.scmr >> 2) & 1); }
  plot() {
    const R = this.r, x = R[1] & 0xFF, y = R[2] & 0xFF, md = this.scmr & 3;
    let c = this.colr;
    R[1] = (R[1] + 1) & 0xFFFF;
    if (!(this.por & 1)) {
      if (md === 3) { if (this.por & 8) { if ((c & 15) === 0) return; } else if (c === 0) return; }
      else if ((c & 15) === 0) return;
    }
    if ((this.por & 2) && md !== 3) { if ((x ^ y) & 1) c >>= 4; c &= 15; }
    const off = (y << 5) + (x >> 3);
    let p0 = this.pc0;
    if (off !== p0.off) {
      this.flush(this.pc1);
      const t = this.pc1; this.pc1 = p0; this.pc0 = t; p0 = t; // o cache atual vira o antigo e o antigo é reaproveitado
      p0.bit = 0; p0.off = off;
    }
    const xi = (x & 7) ^ 7; p0.data[xi] = c; p0.bit |= 1 << xi;
    if (p0.bit === 0xFF) { this.flush(this.pc1); this.flush(p0); }
  }
  tileAddr(off) {
    const x = (off << 3) & 0xFF, y = (off >> 5) & 0xFF, md = this.scmr & 3;
    let cn;
    switch ((this.por & 16) ? 3 : this.ht) {
      case 0: cn = ((x & 0xF8) << 1) + ((y & 0xF8) >> 3); break;
      case 1: cn = ((x & 0xF8) << 1) + ((x & 0xF8) >> 1) + ((y & 0xF8) >> 3); break;
      case 2: cn = ((x & 0xF8) << 1) + (x & 0xF8) + ((y & 0xF8) >> 3); break;
      default: cn = ((y & 0x80) << 2) + ((x & 0x80) << 1) + ((y & 0x78) << 1) + ((x & 0x78) >> 3);
    }
    const bpp = 2 << (md - (md >> 1));
    return { addr: (cn * (bpp << 3)) + (this.scbr << 10) + ((y & 7) * 2), bpp };
  }
  flush(c) {
    if (!c.bit) return;
    const { addr, bpp } = this.tileAddr(c.off), ram = this.ram, mk = this.ramMask;
    for (let n = 0; n < bpp; n++) {
      const by = ((n >> 1) << 4) + (n & 1);
      let d = 0; for (let x = 0; x < 8; x++) d |= ((c.data[x] >> n) & 1) << x;
      const ai = (addr + by) & mk;
      if (c.bit !== 0xFF) d = (d & c.bit) | (ram[ai] & ~c.bit & 0xFF);
      ram[ai] = d;
    }
    c.bit = 0; this.cost += 4;
  }
  rpix() {
    this.flush(this.pc1); this.flush(this.pc0);
    const R = this.r, x = R[1] & 0xFF, y = R[2] & 0xFF;
    const { addr, bpp } = this.tileAddr((y << 5) + (x >> 3)), xi = (x & 7) ^ 7;
    let d = 0;
    for (let n = 0; n < bpp; n++) d |= ((this.ram[(addr + ((n >> 1) << 4) + (n & 1)) & this.ramMask] >> xi) & 1) << n;
    this.nz(d); this.wd(d);
  }
}

if (typeof module !== 'undefined') module.exports = { GSU };
