'use strict';
/* CPU Sharp LR35902 (Game Boy / Game Boy Color). step() executa uma instrução e devolve os ciclos
 * de relógio (T-cycles, 4 por ciclo de máquina). */
const GB_CYC = new Uint8Array([
  4, 12, 8, 8, 4, 4, 8, 4, 20, 8, 8, 8, 4, 4, 8, 4,  4, 12, 8, 8, 4, 4, 8, 4, 12, 8, 8, 8, 4, 4, 8, 4,
  8, 12, 8, 8, 4, 4, 8, 4, 8, 8, 8, 8, 4, 4, 8, 4,  8, 12, 8, 8, 12, 12, 12, 4, 8, 8, 8, 8, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  8, 8, 8, 8, 8, 8, 4, 8, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  8, 12, 12, 16, 12, 16, 8, 16, 8, 16, 12, 4, 12, 24, 8, 16,  8, 12, 12, 4, 12, 16, 8, 16, 8, 16, 12, 4, 12, 4, 8, 16,
  12, 12, 8, 4, 4, 16, 8, 16, 16, 4, 16, 4, 4, 4, 8, 16,  12, 12, 8, 4, 4, 16, 8, 16, 12, 8, 16, 4, 4, 4, 8, 16
]);

class GBCPU {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.z = 0; this.n = 0; this.hc = 0; this.cy = 0;
    this.sp = 0; this.pc = 0;
    this.ime = 0; this.imeNext = 0; this.halted = false; this.haltBug = false; this.stopped = false;
  }
  get f() { return (this.z << 7) | (this.n << 6) | (this.hc << 5) | (this.cy << 4); }
  set f(v) { this.z = (v >> 7) & 1; this.n = (v >> 6) & 1; this.hc = (v >> 5) & 1; this.cy = (v >> 4) & 1; }
  get af() { return (this.a << 8) | this.f; }
  get bc() { return (this.b << 8) | this.c; }
  get de() { return (this.d << 8) | this.e; }
  get hl() { return (this.h << 8) | this.l; }
  fetch() { const v = this.bus.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const l = this.fetch(); return l | (this.fetch() << 8); }
  push(v) { this.sp = (this.sp - 1) & 0xFFFF; this.bus.write(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xFFFF; this.bus.write(this.sp, v & 255); }
  pop() { const l = this.bus.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF; const h = this.bus.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF; return l | (h << 8); }
  get(i) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.bus.read((this.h << 8) | this.l); default: return this.a;
    }
  }
  set(i, v) {
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.bus.write((this.h << 8) | this.l, v); break; default: this.a = v;
    }
  }
  getRR(i) { switch (i) { case 0: return (this.b << 8) | this.c; case 1: return (this.d << 8) | this.e; case 2: return (this.h << 8) | this.l; default: return this.sp; } }
  setRR(i, v) {
    switch (i) {
      case 0: this.b = v >> 8; this.c = v & 255; break; case 1: this.d = v >> 8; this.e = v & 255; break;
      case 2: this.h = v >> 8; this.l = v & 255; break; default: this.sp = v;
    }
  }
  cond(i) { switch (i) { case 0: return !this.z; case 1: return !!this.z; case 2: return !this.cy; default: return !!this.cy; } }
  alu(k, v) {
    const a = this.a; let r;
    switch (k) {
      case 0: r = a + v; this.hc = ((a & 15) + (v & 15)) > 15 ? 1 : 0; this.cy = r > 255 ? 1 : 0; this.n = 0; this.a = r & 255; this.z = this.a === 0 ? 1 : 0; break;
      case 1: { const c = this.cy; r = a + v + c; this.hc = ((a & 15) + (v & 15) + c) > 15 ? 1 : 0; this.cy = r > 255 ? 1 : 0; this.n = 0; this.a = r & 255; this.z = this.a === 0 ? 1 : 0; break; }
      case 2: r = a - v; this.hc = (a & 15) < (v & 15) ? 1 : 0; this.cy = r < 0 ? 1 : 0; this.n = 1; this.a = r & 255; this.z = this.a === 0 ? 1 : 0; break;
      case 3: { const c = this.cy; r = a - v - c; this.hc = ((a & 15) - (v & 15) - c) < 0 ? 1 : 0; this.cy = r < 0 ? 1 : 0; this.n = 1; this.a = r & 255; this.z = this.a === 0 ? 1 : 0; break; }
      case 4: this.a = a & v; this.z = this.a === 0 ? 1 : 0; this.n = 0; this.hc = 1; this.cy = 0; break;
      case 5: this.a = a ^ v; this.z = this.a === 0 ? 1 : 0; this.n = 0; this.hc = 0; this.cy = 0; break;
      case 6: this.a = a | v; this.z = this.a === 0 ? 1 : 0; this.n = 0; this.hc = 0; this.cy = 0; break;
      default: r = a - v; this.hc = (a & 15) < (v & 15) ? 1 : 0; this.cy = r < 0 ? 1 : 0; this.n = 1; this.z = (r & 255) === 0 ? 1 : 0;
    }
  }
  inc(v) { const r = (v + 1) & 255; this.z = r === 0 ? 1 : 0; this.n = 0; this.hc = (v & 15) === 15 ? 1 : 0; return r; }
  dec(v) { const r = (v - 1) & 255; this.z = r === 0 ? 1 : 0; this.n = 1; this.hc = (v & 15) === 0 ? 1 : 0; return r; }
  addHL(v) { const hl = (this.h << 8) | this.l, r = hl + v; this.n = 0; this.hc = ((hl & 0xFFF) + (v & 0xFFF)) > 0xFFF ? 1 : 0; this.cy = r > 0xFFFF ? 1 : 0; this.h = (r >> 8) & 255; this.l = r & 255; }
  spOff(e) { // e: byte com sinal; define flags de ADD SP,e / LD HL,SP+e
    const sp = this.sp, r = (sp + e) & 0xFFFF;
    this.z = 0; this.n = 0; this.hc = ((sp & 15) + (e & 15)) > 15 ? 1 : 0; this.cy = ((sp & 255) + (e & 255)) > 255 ? 1 : 0;
    return r;
  }
  daa() {
    let a = this.a;
    if (!this.n) {
      if (this.cy || a > 0x99) { a += 0x60; this.cy = 1; }
      if (this.hc || (a & 15) > 9) a += 6;
    } else {
      if (this.cy) a -= 0x60;
      if (this.hc) a -= 6;
    }
    this.a = a & 255; this.z = this.a === 0 ? 1 : 0; this.hc = 0;
  }
  /* instruções CB: devolve o ciclo extra */
  cb() {
    const op = this.fetch(), r = op & 7, k = op >> 6, bit = (op >> 3) & 7;
    let v = this.get(r), cyc = r === 6 ? 16 : 8;
    if (k === 1) { this.z = (v >> bit) & 1 ? 0 : 1; this.n = 0; this.hc = 1; return r === 6 ? 12 : 8; }
    if (k === 2) { v &= ~(1 << bit); this.set(r, v); return cyc; }
    if (k === 3) { v |= 1 << bit; this.set(r, v); return cyc; }
    let o;
    switch (bit) {
      case 0: o = ((v << 1) | (v >> 7)) & 255; this.cy = v >> 7; break;                 // RLC
      case 1: o = ((v >> 1) | (v << 7)) & 255; this.cy = v & 1; break;                  // RRC
      case 2: o = ((v << 1) | this.cy) & 255; this.cy = v >> 7; break;                  // RL
      case 3: o = ((v >> 1) | (this.cy << 7)) & 255; this.cy = v & 1; break;            // RR
      case 4: o = (v << 1) & 255; this.cy = v >> 7; break;                              // SLA
      case 5: o = (v >> 1) | (v & 0x80); this.cy = v & 1; break;                        // SRA
      case 6: o = ((v << 4) | (v >> 4)) & 255; this.cy = 0; break;                      // SWAP
      default: o = v >> 1; this.cy = v & 1;                                             // SRL
    }
    this.z = o === 0 ? 1 : 0; this.n = 0; this.hc = 0;
    this.set(r, o);
    return cyc;
  }
  interrupt(vec) { this.ime = 0; this.push(this.pc); this.pc = vec; }
  step() {
    const bus = this.bus;
    const pend = bus.ifl & bus.ie & 0x1F;
    if (this.halted) {
      if (pend) this.halted = false; else return 4;
    }
    if (this.ime && pend) {
      for (let i = 0; i < 5; i++) if (pend & (1 << i)) { bus.ifl &= ~(1 << i); this.interrupt(0x40 + i * 8); return 20; }
    }
    if (this.imeNext) { this.ime = 1; this.imeNext = 0; }
    let op = bus.read(this.pc);
    if (this.haltBug) { this.haltBug = false; } else this.pc = (this.pc + 1) & 0xFFFF;
    let cyc = GB_CYC[op];
    switch (op) {
      case 0x00: break;
      case 0x01: case 0x11: case 0x21: case 0x31: this.setRR(op >> 4, this.fetch16()); break;
      case 0x02: bus.write((this.b << 8) | this.c, this.a); break;
      case 0x12: bus.write((this.d << 8) | this.e, this.a); break;
      case 0x22: { const hl = (this.h << 8) | this.l; bus.write(hl, this.a); this.setRR(2, (hl + 1) & 0xFFFF); break; }
      case 0x32: { const hl = (this.h << 8) | this.l; bus.write(hl, this.a); this.setRR(2, (hl - 1) & 0xFFFF); break; }
      case 0x03: case 0x13: case 0x23: case 0x33: this.setRR(op >> 4, (this.getRR(op >> 4) + 1) & 0xFFFF); break;
      case 0x0B: case 0x1B: case 0x2B: case 0x3B: this.setRR(op >> 4, (this.getRR(op >> 4) - 1) & 0xFFFF); break;
      case 0x04: case 0x0C: case 0x14: case 0x1C: case 0x24: case 0x2C: case 0x34: case 0x3C: { const r = (op >> 3) & 7; this.set(r, this.inc(this.get(r))); break; }
      case 0x05: case 0x0D: case 0x15: case 0x1D: case 0x25: case 0x2D: case 0x35: case 0x3D: { const r = (op >> 3) & 7; this.set(r, this.dec(this.get(r))); break; }
      case 0x06: case 0x0E: case 0x16: case 0x1E: case 0x26: case 0x2E: case 0x36: case 0x3E: this.set((op >> 3) & 7, this.fetch()); break;
      case 0x07: this.cy = this.a >> 7; this.a = ((this.a << 1) | this.cy) & 255; this.z = 0; this.n = 0; this.hc = 0; break;
      case 0x0F: this.cy = this.a & 1; this.a = ((this.a >> 1) | (this.cy << 7)) & 255; this.z = 0; this.n = 0; this.hc = 0; break;
      case 0x17: { const c = this.cy; this.cy = this.a >> 7; this.a = ((this.a << 1) | c) & 255; this.z = 0; this.n = 0; this.hc = 0; break; }
      case 0x1F: { const c = this.cy; this.cy = this.a & 1; this.a = ((this.a >> 1) | (c << 7)) & 255; this.z = 0; this.n = 0; this.hc = 0; break; }
      case 0x08: { const a = this.fetch16(); bus.write(a, this.sp & 255); bus.write((a + 1) & 0xFFFF, this.sp >> 8); break; }
      case 0x09: case 0x19: case 0x29: case 0x39: this.addHL(this.getRR(op >> 4)); break;
      case 0x0A: this.a = bus.read((this.b << 8) | this.c); break;
      case 0x1A: this.a = bus.read((this.d << 8) | this.e); break;
      case 0x2A: { const hl = (this.h << 8) | this.l; this.a = bus.read(hl); this.setRR(2, (hl + 1) & 0xFFFF); break; }
      case 0x3A: { const hl = (this.h << 8) | this.l; this.a = bus.read(hl); this.setRR(2, (hl - 1) & 0xFFFF); break; }
      case 0x10: this.fetch(); bus.stop(); break;
      case 0x18: { const e = this.fetch() << 24 >> 24; this.pc = (this.pc + e) & 0xFFFF; break; }
      case 0x20: case 0x28: case 0x30: case 0x38: { const e = this.fetch() << 24 >> 24; if (this.cond((op >> 3) & 3)) { this.pc = (this.pc + e) & 0xFFFF; cyc = 12; } break; }
      case 0x27: this.daa(); break;
      case 0x2F: this.a ^= 255; this.n = 1; this.hc = 1; break;
      case 0x37: this.n = 0; this.hc = 0; this.cy = 1; break;
      case 0x3F: this.n = 0; this.hc = 0; this.cy ^= 1; break;
      case 0x76:
        if (!this.ime && (bus.ifl & bus.ie & 0x1F)) this.haltBug = true; else this.halted = true;
        break;
      case 0xC0: case 0xC8: case 0xD0: case 0xD8: if (this.cond((op >> 3) & 3)) { this.pc = this.pop(); cyc = 20; } break;
      case 0xC1: case 0xD1: case 0xE1: { const v = this.pop(); this.setRR((op >> 4) & 3, v); break; }
      case 0xF1: { const v = this.pop(); this.a = v >> 8; this.f = v & 0xF0; break; }
      case 0xC5: case 0xD5: case 0xE5: this.push(this.getRR((op >> 4) & 3)); break;
      case 0xF5: this.push(this.af); break;
      case 0xC2: case 0xCA: case 0xD2: case 0xDA: { const a = this.fetch16(); if (this.cond((op >> 3) & 3)) { this.pc = a; cyc = 16; } break; }
      case 0xC3: this.pc = this.fetch16(); break;
      case 0xC4: case 0xCC: case 0xD4: case 0xDC: { const a = this.fetch16(); if (this.cond((op >> 3) & 3)) { this.push(this.pc); this.pc = a; cyc = 24; } break; }
      case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE: this.alu((op >> 3) & 7, this.fetch()); break;
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF: this.push(this.pc); this.pc = op & 0x38; break;
      case 0xC9: this.pc = this.pop(); break;
      case 0xD9: this.pc = this.pop(); this.ime = 1; break;
      case 0xCB: cyc = this.cb(); break;
      case 0xCD: { const a = this.fetch16(); this.push(this.pc); this.pc = a; break; }
      case 0xE0: bus.write(0xFF00 | this.fetch(), this.a); break;
      case 0xF0: this.a = bus.read(0xFF00 | this.fetch()); break;
      case 0xE2: bus.write(0xFF00 | this.c, this.a); break;
      case 0xF2: this.a = bus.read(0xFF00 | this.c); break;
      case 0xE8: { const e = this.fetch() << 24 >> 24; this.sp = this.spOff(e); break; }
      case 0xF8: { const e = this.fetch() << 24 >> 24; const r = this.spOff(e); this.h = r >> 8; this.l = r & 255; break; }
      case 0xF9: this.sp = (this.h << 8) | this.l; break;
      case 0xE9: this.pc = (this.h << 8) | this.l; break;
      case 0xEA: bus.write(this.fetch16(), this.a); break;
      case 0xFA: this.a = bus.read(this.fetch16()); break;
      case 0xF3: this.ime = 0; this.imeNext = 0; break;
      case 0xFB: this.imeNext = 1; break;
      default:
        if (op >= 0x40 && op < 0x80) this.set((op >> 3) & 7, this.get(op & 7));
        else if (op >= 0x80 && op < 0xC0) this.alu((op >> 3) & 7, this.get(op & 7));
        // opcodes indefinidos: tratados como NOP
    }
    return cyc;
  }
}

if (typeof module !== 'undefined') module.exports = { GBCPU };
