'use strict';
/* CPU Z80 (Master System / Game Gear): todas as instruções documentadas e as não documentadas
 * mais usadas (IXH/IXL, SLL, flags X/Y, DDCB com cópia no registrador). Tempo por instrução.
 * O barramento fornece read(a), write(a,v), portIn(p), portOut(p,v) e a linha de interrupção irq. */
const Z_S = 0x80, Z_Z = 0x40, Z_Y = 0x20, Z_H = 0x10, Z_X = 0x08, Z_P = 0x04, Z_N = 0x02, Z_C = 0x01;
const Z_PAR = new Uint8Array(256), Z_SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 1; for (let b = 0; b < 8; b++) if ((i >> b) & 1) p ^= 1;
  Z_PAR[i] = p ? Z_P : 0;
  Z_SZP[i] = (i & (Z_S | Z_Y | Z_X)) | (i === 0 ? Z_Z : 0) | Z_PAR[i];
}

class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.R = new Uint8Array(8);   // B C D E H L (livre) A
    this.R2 = new Uint8Array(8);  // sombra
    this.reset();
  }
  reset() {
    this.R.fill(0); this.R2.fill(0); this.R[7] = 0xFF; this.f = 0xFF; this.f2 = 0xFF;
    this.ix = 0xFFFF; this.iy = 0xFFFF; this.sp = 0xFFFF; this.pc = 0; this.i = 0; this.r = 0;
    this.iff1 = false; this.iff2 = false; this.im = 1; this.halted = false; this.eiWait = false;
    this.nmi = false; this.irqLine = false; this.idx = 0; this.cycles = 0;
  }
  /* ---- helpers de memória ---- */
  rd16(a) { const b = this.bus; return b.read(a) | (b.read((a + 1) & 0xFFFF) << 8); }
  wr16(a, v) { const b = this.bus; b.write(a, v & 255); b.write((a + 1) & 0xFFFF, v >> 8); }
  push(v) { const b = this.bus; this.sp = (this.sp - 1) & 0xFFFF; b.write(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xFFFF; b.write(this.sp, v & 255); }
  pop() { const b = this.bus, lo = b.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF; const hi = b.read(this.sp); this.sp = (this.sp + 1) & 0xFFFF; return lo | (hi << 8); }
  fetch() { const v = this.bus.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7F); }
  /* pares */
  get bc() { return (this.R[0] << 8) | this.R[1]; } set bc(v) { this.R[0] = v >> 8; this.R[1] = v; }
  get de() { return (this.R[2] << 8) | this.R[3]; } set de(v) { this.R[2] = v >> 8; this.R[3] = v; }
  get hl() { return (this.R[4] << 8) | this.R[5]; } set hl(v) { this.R[4] = v >> 8; this.R[5] = v; }
  get af() { return (this.R[7] << 8) | this.f; } set af(v) { this.R[7] = v >> 8; this.f = v & 255; }
  /* HL, IX ou IY conforme o prefixo */
  getHL() { return this.idx === 0 ? this.hl : this.idx === 1 ? this.ix : this.iy; }
  setHL(v) { if (this.idx === 0) this.hl = v; else if (this.idx === 1) this.ix = v & 0xFFFF; else this.iy = v & 0xFFFF; }
  rp(p) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHL() : this.sp; }
  setRp(p, v) { v &= 0xFFFF; if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setHL(v); else this.sp = v; }
  rp2(p) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHL() : this.af; }
  setRp2(p, v) { v &= 0xFFFF; if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setHL(v); else this.af = v; }
  /* registrador de 8 bits z (6 = não usar aqui); com prefixo H/L viram IXH/IXL */
  get8(z) {
    if (this.idx) { if (z === 4) return (this.idx === 1 ? this.ix : this.iy) >> 8; if (z === 5) return (this.idx === 1 ? this.ix : this.iy) & 255; }
    return this.R[z];
  }
  set8(z, v) {
    v &= 255;
    if (this.idx && (z === 4 || z === 5)) {
      const cur = this.idx === 1 ? this.ix : this.iy, n = z === 4 ? (v << 8) | (cur & 255) : (cur & 0xFF00) | v;
      if (this.idx === 1) this.ix = n; else this.iy = n; return;
    }
    this.R[z] = v;
  }
  /* ---- ALU ---- */
  alu(op, v) {
    const R = this.R, a = R[7]; let r;
    switch (op) {
      case 0: r = a + v; this.f = (r & 0xA8) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ r) & (v ^ r)) & 0x80) ? Z_P : 0) | ((r >> 8) & 1); R[7] = r; return;
      case 1: { const c = this.f & 1; r = a + v + c; this.f = (r & 0xA8) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ r) & (v ^ r)) & 0x80) ? Z_P : 0) | ((r >> 8) & 1); R[7] = r; return; }
      case 2: r = a - v; this.f = (r & 0xA8) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1); R[7] = r; return;
      case 3: { const c = this.f & 1; r = a - v - c; this.f = (r & 0xA8) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1); R[7] = r; return; }
      case 4: r = a & v; this.f = Z_SZP[r] | Z_H; R[7] = r; return;
      case 5: r = a ^ v; this.f = Z_SZP[r]; R[7] = r; return;
      case 6: r = a | v; this.f = Z_SZP[r]; R[7] = r; return;
      case 7: r = a - v; this.f = (r & 0x80) | (v & 0x28) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1); return;
    }
  }
  inc8(v) { const r = (v + 1) & 255; this.f = (this.f & Z_C) | (r & 0xA8) | (r === 0 ? Z_Z : 0) | ((v & 15) === 15 ? Z_H : 0) | (v === 0x7F ? Z_P : 0); return r; }
  dec8(v) { const r = (v - 1) & 255; this.f = (this.f & Z_C) | (r & 0xA8) | (r === 0 ? Z_Z : 0) | ((v & 15) === 0 ? Z_H : 0) | (v === 0x80 ? Z_P : 0) | Z_N; return r; }
  add16(a, b) { const r = a + b; this.f = (this.f & (Z_S | Z_Z | Z_P)) | ((r >> 8) & (Z_Y | Z_X)) | (((a ^ b ^ r) >> 8) & Z_H) | ((r >> 16) & 1); return r & 0xFFFF; }
  adc16(b) {
    const a = this.hl, c = this.f & 1, r = a + b + c;
    this.f = ((r >> 8) & 0xA8) | ((r & 0xFFFF) === 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ r) & (b ^ r)) & 0x8000) ? Z_P : 0) | ((r >> 16) & 1);
    this.hl = r;
  }
  sbc16(b) {
    const a = this.hl, c = this.f & 1, r = a - b - c;
    this.f = ((r >> 8) & 0xA8) | ((r & 0xFFFF) === 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ b) & (a ^ r)) & 0x8000) ? Z_P : 0) | Z_N | ((r >> 16) & 1);
    this.hl = r;
  }
  daa() {
    const R = this.R; let a = R[7], f = this.f, add = 0, c = f & 1;
    if ((f & Z_H) || (a & 15) > 9) add |= 6;
    if (c || a > 0x99) { add |= 0x60; c = 1; }
    const r = (f & Z_N) ? (a - add) & 255 : (a + add) & 255;
    const h = (f & Z_N) ? (((f & Z_H) && (a & 15) < 6) ? Z_H : 0) : ((a & 15) > 9 ? Z_H : 0);
    this.f = Z_SZP[r] | (f & Z_N) | h | c; R[7] = r;
  }
  /* rotações/deslocamentos do prefixo CB */
  rot(y, v) {
    let r, c;
    switch (y) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 255; break;       // RLC
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;        // RRC
      case 2: c = v >> 7; r = ((v << 1) | (this.f & 1)) & 255; break; // RL
      case 3: c = v & 1; r = (v >> 1) | ((this.f & 1) << 7); break;   // RR
      case 4: c = v >> 7; r = (v << 1) & 255; break;           // SLA
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;     // SRA
      case 6: c = v >> 7; r = ((v << 1) | 1) & 255; break;     // SLL
      default: c = v & 1; r = v >> 1; break;                   // SRL
    }
    this.f = Z_SZP[r] | c; return r;
  }
  cond(y) {
    const f = this.f;
    switch (y) { case 0: return !(f & Z_Z); case 1: return !!(f & Z_Z); case 2: return !(f & Z_C); case 3: return !!(f & Z_C); case 4: return !(f & Z_P); case 5: return !!(f & Z_P); case 6: return !(f & Z_S); default: return !!(f & Z_S); }
  }
  /* ---- passo: interrupções + uma instrução. Devolve ciclos ---- */
  step() {
    if (this.nmi) { this.nmi = false; this.halted = false; this.iff2 = this.iff1; this.iff1 = false; this.incR(); this.push(this.pc); this.pc = 0x66; return 11; }
    const can = !this.eiWait; this.eiWait = false;
    if (can && this.iff1 && this.irqLine) {
      this.halted = false; this.iff1 = this.iff2 = false; this.incR();
      if (this.im === 2) { this.push(this.pc); this.pc = this.rd16((this.i << 8) | 0xFF); return 19; }
      this.push(this.pc); this.pc = 0x38; return 13;
    }
    if (this.halted) { this.incR(); return 4; }
    this.idx = 0;
    let t = 0, op = this.fetch(); this.incR();
    while (op === 0xDD || op === 0xFD) { this.idx = op === 0xDD ? 1 : 2; t += 4; op = this.fetch(); this.incR(); }
    return t + this.exec(op);
  }
  exec(op) {
    const R = this.R, bus = this.bus, idx = this.idx;
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    // endereço do operando (HL) / (IX+d) / (IY+d); extra = ciclos a mais no modo indexado
    const mem = () => {
      if (!idx) return this.hl;
      const d = this.fetch(); return ((idx === 1 ? this.ix : this.iy) + (d << 24 >> 24)) & 0xFFFF;
    };
    switch (x) {
      case 0:
        switch (z) {
          case 0:
            if (y === 0) return 4;
            if (y === 1) { const t = R[7]; R[7] = this.R2[7]; this.R2[7] = t; const f = this.f; this.f = this.f2; this.f2 = f; return 4; }
            if (y === 2) { const d = this.fetch() << 24 >> 24; R[0] = (R[0] - 1) & 255; if (R[0]) { this.pc = (this.pc + d) & 0xFFFF; return 13; } return 8; }
            if (y === 3) { const d = this.fetch() << 24 >> 24; this.pc = (this.pc + d) & 0xFFFF; return 12; }
            { const d = this.fetch() << 24 >> 24; if (this.cond(y - 4)) { this.pc = (this.pc + d) & 0xFFFF; return 12; } return 7; }
          case 1:
            if (!q) { this.setRp(p, this.fetch16()); return 10; }
            { const v = this.add16(this.getHL(), this.rp(p)); this.setHL(v); return 11; }
          case 2:
            if (!q) {
              if (p === 0) { bus.write(this.bc, R[7]); return 7; }
              if (p === 1) { bus.write(this.de, R[7]); return 7; }
              if (p === 2) { this.wr16(this.fetch16(), this.getHL()); return 16; }
              bus.write(this.fetch16(), R[7]); return 13;
            }
            if (p === 0) { R[7] = bus.read(this.bc); return 7; }
            if (p === 1) { R[7] = bus.read(this.de); return 7; }
            if (p === 2) { this.setHL(this.rd16(this.fetch16())); return 16; }
            R[7] = bus.read(this.fetch16()); return 13;
          case 3: this.setRp(p, this.rp(p) + (q ? -1 : 1)); return 6;
          case 4: case 5: {
            const f = z === 4 ? 'inc8' : 'dec8';
            if (y === 6) { const a = mem(); bus.write(a, this[f](bus.read(a))); return idx ? 23 - 4 : 11; }
            this.set8(y, this[f](this.get8(y))); return 4;
          }
          case 6:
            if (y === 6) { if (idx) { const a = mem(); bus.write(a, this.fetch()); return 15; } bus.write(this.hl, this.fetch()); return 10; }
            this.set8(y, this.fetch()); return 7;
          default:
            switch (y) {
              case 0: { const a = R[7], c = a >> 7; R[7] = ((a << 1) | c) & 255; this.f = (this.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c; return 4; }
              case 1: { const a = R[7], c = a & 1; R[7] = (a >> 1) | (c << 7); this.f = (this.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c; return 4; }
              case 2: { const a = R[7], c = a >> 7; R[7] = ((a << 1) | (this.f & 1)) & 255; this.f = (this.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c; return 4; }
              case 3: { const a = R[7], c = a & 1; R[7] = (a >> 1) | ((this.f & 1) << 7); this.f = (this.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c; return 4; }
              case 4: this.daa(); return 4;
              case 5: R[7] ^= 255; this.f = (this.f & (Z_S | Z_Z | Z_P | Z_C)) | Z_H | Z_N | (R[7] & 0x28); return 4;
              case 6: this.f = (this.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | Z_C; return 4;
              default: this.f = (this.f & (Z_S | Z_Z | Z_P)) | ((this.f & 1) ? Z_H : 0) | (R[7] & 0x28) | ((this.f & 1) ^ 1); return 4;
            }
        }
      case 1:
        if (y === 6 && z === 6) { this.halted = true; return 4; }
        if (y === 6) { const a = mem(); bus.write(a, R[z]); return idx ? 15 : 7; }
        if (z === 6) { const a = mem(); R[y] = bus.read(a); return idx ? 15 : 7; }
        this.set8(y, this.get8(z)); return 4;
      case 2:
        if (z === 6) { const a = mem(); this.alu(y, bus.read(a)); return idx ? 15 : 7; }
        this.alu(y, this.get8(z)); return 4;
      default:
        switch (z) {
          case 0: if (this.cond(y)) { this.pc = this.pop(); return 11; } return 5;
          case 1:
            if (!q) { this.setRp2(p, this.pop()); return 10; }
            if (p === 0) { this.pc = this.pop(); return 10; }
            if (p === 1) { for (let i = 0; i < 6; i++) { const t = R[i]; R[i] = this.R2[i]; this.R2[i] = t; } return 4; }
            if (p === 2) { this.pc = this.getHL(); return 4; }
            this.sp = this.getHL(); return 6;
          case 2: { const a = this.fetch16(); if (this.cond(y)) this.pc = a; return 10; }
          case 3:
            switch (y) {
              case 0: this.pc = this.fetch16(); return 10;
              case 1: return this.cb();
              case 2: bus.portOut(this.fetch() | (R[7] << 8), R[7]); return 11;
              case 3: R[7] = bus.portIn(this.fetch() | (R[7] << 8)); return 11;
              case 4: { const v = this.rd16(this.sp); this.wr16(this.sp, this.getHL()); this.setHL(v); return 19; }
              case 5: { const d = this.de, h = this.hl; this.de = h; this.hl = d; return 4; }
              case 6: this.iff1 = this.iff2 = false; return 4;
              default: this.iff1 = this.iff2 = true; this.eiWait = true; return 4;
            }
          case 4: { const a = this.fetch16(); if (this.cond(y)) { this.push(this.pc); this.pc = a; return 17; } return 10; }
          case 5:
            if (!q) { this.push(this.rp2(p)); return 11; }
            if (p === 0) { const a = this.fetch16(); this.push(this.pc); this.pc = a; return 17; }
            if (p === 2) return this.ed();
            return 4; // DD/FD repetido já tratado em step()
          case 6: this.alu(y, this.fetch()); return 7;
          default: this.push(this.pc); this.pc = y << 3; return 11;
        }
    }
  }
  /* prefixo CB (e DDCB/FDCB) */
  cb() {
    const R = this.R, bus = this.bus, idx = this.idx;
    let a = 0, op, t;
    if (idx) { const d = this.fetch() << 24 >> 24; a = ((idx === 1 ? this.ix : this.iy) + d) & 0xFFFF; op = this.fetch(); t = 4; } // R não incrementa no 2º opcode
    else { op = this.fetch(); this.incR(); t = 0; }
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const memop = idx || z === 6;
    if (!idx && z === 6) a = this.hl;
    const v = memop ? bus.read(a) : R[z];
    if (x === 1) {
      const m = v & (1 << y);
      this.f = (this.f & Z_C) | Z_H | (m ? 0 : Z_Z | Z_P) | (y === 7 && m ? Z_S : 0) | (memop ? ((a >> 8) & 0x28) : (v & 0x28));
      return idx ? 16 : z === 6 ? 12 : 8;
    }
    let r;
    if (x === 0) r = this.rot(y, v); else if (x === 2) r = v & ~(1 << y); else r = v | (1 << y);
    if (memop) { bus.write(a, r); if (idx && z !== 6) R[z] = r; return idx ? 19 : 15; }
    R[z] = r; return 8;
  }
  /* prefixo ED */
  ed() {
    const R = this.R, bus = this.bus;
    this.idx = 0;
    const op = this.fetch(); this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: { const v = bus.portIn(this.bc); this.f = (this.f & Z_C) | Z_SZP[v]; if (y !== 6) R[y] = v; return 12; }
        case 1: bus.portOut(this.bc, y === 6 ? 0 : R[y]); return 12;
        case 2: if (q) this.adc16(this.rp(p)); else this.sbc16(this.rp(p)); return 15;
        case 3: if (q) this.setRp(p, this.rd16(this.fetch16())); else this.wr16(this.fetch16(), this.rp(p)); return 20;
        case 4: { const a = R[7], r = 0 - a; this.f = (r & 0xA8) | ((r & 255) === 0 ? Z_Z : 0) | ((a ^ r) & Z_H) | (a === 0x80 ? Z_P : 0) | Z_N | (a !== 0 ? Z_C : 0); R[7] = r & 255; return 8; }
        case 5: this.pc = this.pop(); this.iff1 = this.iff2; return 14;
        case 6: this.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return 8;
        default:
          switch (y) {
            case 0: this.i = R[7]; return 9;
            case 1: this.r = R[7]; return 9;
            case 2: R[7] = this.i; this.f = (this.f & Z_C) | Z_SZP[R[7]] & ~Z_P | (this.iff2 ? Z_P : 0); return 9;
            case 3: R[7] = this.r; this.f = (this.f & Z_C) | Z_SZP[R[7]] & ~Z_P | (this.iff2 ? Z_P : 0); return 9;
            case 4: { const a = bus.read(this.hl), n = R[7]; bus.write(this.hl, ((n & 15) << 4) | (a >> 4)); R[7] = (n & 0xF0) | (a & 15); this.f = (this.f & Z_C) | Z_SZP[R[7]]; return 18; }
            case 5: { const a = bus.read(this.hl), n = R[7]; bus.write(this.hl, ((a << 4) | (n & 15)) & 255); R[7] = (n & 0xF0) | (a >> 4); this.f = (this.f & Z_C) | Z_SZP[R[7]]; return 18; }
            default: return 8;
          }
      }
    }
    if (x === 2 && y >= 4 && z < 4) return this.block(y, z);
    return 8;
  }
  block(y, z) {
    const R = this.R, bus = this.bus, dec = (y & 1) === 1, rep = y >= 6, d = dec ? -1 : 1;
    switch (z) {
      case 0: { // LDI/LDD/LDIR/LDDR
        const v = bus.read(this.hl); bus.write(this.de, v);
        this.hl = this.hl + d; this.de = this.de + d; this.bc = (this.bc - 1) & 0xFFFF;
        const n = (v + R[7]) & 255;
        this.f = (this.f & (Z_S | Z_Z | Z_C)) | ((n & 2) ? Z_Y : 0) | (n & 8) | (this.bc ? Z_P : 0);
        if (rep && this.bc) { this.pc = (this.pc - 2) & 0xFFFF; return 21; } return 16;
      }
      case 1: { // CPI/CPD/CPIR/CPDR
        const v = bus.read(this.hl), a = R[7], r = (a - v) & 255, h = ((a ^ v ^ r) & Z_H) ? 1 : 0;
        this.hl = this.hl + d; this.bc = (this.bc - 1) & 0xFFFF;
        const n = (r - h) & 255;
        this.f = (this.f & Z_C) | (r & Z_S) | (r === 0 ? Z_Z : 0) | (h ? Z_H : 0) | ((n & 2) ? Z_Y : 0) | (n & 8) | (this.bc ? Z_P : 0) | Z_N;
        if (rep && this.bc && r !== 0) { this.pc = (this.pc - 2) & 0xFFFF; return 21; } return 16;
      }
      case 2: { // INI/IND/INIR/INDR
        const v = bus.portIn(this.bc); bus.write(this.hl, v);
        R[0] = (R[0] - 1) & 255; this.hl = this.hl + d;
        const k = v + ((R[1] + d) & 255);
        this.f = (R[0] & 0xA8) | (R[0] === 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? Z_H | Z_C : 0) | Z_PAR[((k & 7) ^ R[0]) & 255];
        if (rep && R[0]) { this.pc = (this.pc - 2) & 0xFFFF; return 21; } return 16;
      }
      default: { // OUTI/OUTD/OTIR/OTDR
        const v = bus.read(this.hl); R[0] = (R[0] - 1) & 255; bus.portOut(this.bc, v); this.hl = this.hl + d;
        const k = v + R[5];
        this.f = (R[0] & 0xA8) | (R[0] === 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? Z_H | Z_C : 0) | Z_PAR[((k & 7) ^ R[0]) & 255];
        if (rep && R[0]) { this.pc = (this.pc - 2) & 0xFFFF; return 21; } return 16;
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Z80 };
