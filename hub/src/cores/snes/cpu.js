'use strict';
/* CPU 65C816 do SNES (Ricoh 5A22). Interpretador por instrução, com custo de memória por acesso
 * (o barramento acumula os ciclos mestres). Modos nativo/emulação, M/X de 8 ou 16 bits, BCD. */
const SN_N = 0x80, SN_V = 0x40, SN_M = 0x20, SN_X = 0x10, SN_D = 0x08, SN_I = 0x04, SN_Z = 0x02, SN_C = 0x01;

class CPU65816 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0; this.s = 0x1FF; this.d = 0; this.db = 0; this.pb = 0; this.pc = 0;
    this.p = 0x34; this.e = 1; this.wai = false; this.stp = false;
  }
  reset() {
    this.a = 0; this.x = 0; this.y = 0; this.s = 0x1FF; this.d = 0; this.db = 0; this.pb = 0;
    this.p = 0x34; this.e = 1; this.wai = false; this.stp = false;
    this.pc = this.rd16(0xFFFC);
  }
  /* ---- acesso ---- */
  rd8(a) { return this.bus.read(a); }
  rd16(a) { const b = this.bus; return b.read(a) | (b.read((a + 1) & 0xFFFFFF) << 8); }
  rd24(a) { const b = this.bus; return b.read(a) | (b.read((a + 1) & 0xFFFFFF) << 8) | (b.read((a + 2) & 0xFFFFFF) << 16); }
  wr8(a, v) { this.bus.write(a, v & 0xFF); }
  wr16(a, v) { const b = this.bus; b.write(a, v & 0xFF); b.write((a + 1) & 0xFFFFFF, (v >> 8) & 0xFF); }
  wr16r(a, v) { const b = this.bus; b.write((a + 1) & 0xFFFFFF, (v >> 8) & 0xFF); b.write(a, v & 0xFF); } // leitura-modificação-escrita: byte alto primeiro
  fetch8() { const v = this.bus.read((this.pb << 16) | this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const l = this.fetch8(); return l | (this.fetch8() << 8); }
  fetch24() { const l = this.fetch16(); return l | (this.fetch8() << 16); }
  idle(n) { this.bus.idle(n); }
  /* pilha (sempre banco 0) */
  push8(v) { this.bus.write(this.s, v & 0xFF); this.s = this.e ? (0x100 | ((this.s - 1) & 0xFF)) : ((this.s - 1) & 0xFFFF); }
  push16(v) { this.push8(v >> 8); this.push8(v); }
  pull8() { this.s = this.e ? (0x100 | ((this.s + 1) & 0xFF)) : ((this.s + 1) & 0xFFFF); return this.bus.read(this.s); }
  pull16() { const l = this.pull8(); return l | (this.pull8() << 8); }
  /* ---- flags ---- */
  nz8(v) { this.p = (this.p & ~(SN_N | SN_Z)) | (v & 0x80) | ((v & 0xFF) === 0 ? SN_Z : 0); }
  nz16(v) { this.p = (this.p & ~(SN_N | SN_Z)) | ((v >> 8) & 0x80) | ((v & 0xFFFF) === 0 ? SN_Z : 0); }
  setP(v) {
    this.p = v & 0xFF;
    if (this.e) this.p |= 0x30;
    if (this.p & SN_X) { this.x &= 0xFF; this.y &= 0xFF; }
  }
  /* ---- modos de endereçamento (devolvem o endereço efetivo de 24 bits) ---- */
  dp() { const o = this.fetch8(); if (this.d & 0xFF) this.idle(1); return (this.d + o) & 0xFFFF; }
  dpX() { const o = this.fetch8(); if (this.d & 0xFF) this.idle(1); this.idle(1); return (this.d + o + ((this.p & SN_X) ? this.x & 0xFF : this.x)) & 0xFFFF; }
  dpY() { const o = this.fetch8(); if (this.d & 0xFF) this.idle(1); this.idle(1); return (this.d + o + ((this.p & SN_X) ? this.y & 0xFF : this.y)) & 0xFFFF; }
  abs() { return (this.db << 16) | this.fetch16(); }
  absX(w) { const base = (this.db << 16) | this.fetch16(), ea = (base + this.x) & 0xFFFFFF; if (w || !(this.p & SN_X) || ((base ^ ea) & 0xFF00)) this.idle(1); return ea; }
  absY(w) { const base = (this.db << 16) | this.fetch16(), ea = (base + this.y) & 0xFFFFFF; if (w || !(this.p & SN_X) || ((base ^ ea) & 0xFF00)) this.idle(1); return ea; }
  long() { return this.fetch24(); }
  longX() { return (this.fetch24() + this.x) & 0xFFFFFF; }
  dpInd() { const a = this.dp(); return (this.db << 16) | this.rd16(a); }
  dpIndX() { const a = this.dpX(); return (this.db << 16) | this.rd16(a); }
  dpIndY(w) { const a = this.dp(), base = (this.db << 16) | this.rd16(a), ea = (base + this.y) & 0xFFFFFF; if (w || !(this.p & SN_X) || ((base ^ ea) & 0xFF00)) this.idle(1); return ea; }
  dpIndLong() { return this.rd24(this.dp()); }
  dpIndLongY() { return (this.rd24(this.dp()) + this.y) & 0xFFFFFF; }
  sr() { const o = this.fetch8(); this.idle(1); return (this.s + o) & 0xFFFF; }
  srIndY() { const o = this.fetch8(); this.idle(1); const ptr = this.rd16((this.s + o) & 0xFFFF); this.idle(1); return (((this.db << 16) | ptr) + this.y) & 0xFFFFFF; }
  immM() { const a = (this.pb << 16) | this.pc; this.pc = (this.pc + ((this.p & SN_M) ? 1 : 2)) & 0xFFFF; return a; }
  immX() { const a = (this.pb << 16) | this.pc; this.pc = (this.pc + ((this.p & SN_X) ? 1 : 2)) & 0xFFFF; return a; }
  /* modo do grupo ALU (cc=01) pelos bits 2-4; w = escrita (custo extra de índice) */
  aluEA(bbb, w) {
    switch (bbb) {
      case 0: return this.dpIndX();
      case 1: return this.dp();
      case 2: return this.immM();
      case 3: return this.abs();
      case 4: return this.dpIndY(w);
      case 5: return this.dpX();
      case 6: return this.absY(w);
      default: return this.absX(w);
    }
  }
  /* modo do grupo cc=11 (long) */
  alu3EA(bbb, w) {
    switch (bbb) {
      case 0: return this.sr();
      case 1: return this.dpIndLong();
      case 3: return this.long();
      case 4: return this.srIndY();
      case 5: return this.dpIndLongY();
      default: return this.longX();
    }
  }
  /* ---- operações aritméticas ---- */
  adc(v) {
    const p = this.p, c = p & SN_C;
    if (p & SN_M) {
      const a = this.a & 0xFF; let r;
      if (!(p & SN_D)) { r = a + v + c; this.p = (p & ~(SN_V | SN_C)) | (~(a ^ v) & (a ^ r) & 0x80 ? SN_V : 0) | (r > 0xFF ? SN_C : 0); }
      else {
        r = (a & 0xF) + (v & 0xF) + c; if (r > 9) r += 6;
        const cc = r > 0xF ? 0x10 : 0; r = (a & 0xF0) + (v & 0xF0) + cc + (r & 0xF);
        let vf = (~(a ^ v) & (a ^ r) & 0x80) ? SN_V : 0; if (r > 0x9F) r += 0x60;
        this.p = (p & ~(SN_V | SN_C)) | vf | (r > 0xFF ? SN_C : 0);
      }
      r &= 0xFF; this.a = (this.a & 0xFF00) | r; this.nz8(r);
    } else {
      const a = this.a; let r;
      if (!(p & SN_D)) { r = a + v + c; this.p = (p & ~(SN_V | SN_C)) | (~(a ^ v) & (a ^ r) & 0x8000 ? SN_V : 0) | (r > 0xFFFF ? SN_C : 0); }
      else {
        r = (a & 0xF) + (v & 0xF) + c; if (r > 9) r += 6;
        let cc = r > 0xF ? 0x10 : 0; r = (a & 0xF0) + (v & 0xF0) + cc + (r & 0xF); if (r > 0x9F) r += 0x60;
        cc = r > 0xFF ? 0x100 : 0; r = (a & 0xF00) + (v & 0xF00) + cc + (r & 0xFF); if (r > 0x9FF) r += 0x600;
        cc = r > 0xFFF ? 0x1000 : 0; r = (a & 0xF000) + (v & 0xF000) + cc + (r & 0xFFF);
        const vf = (~(a ^ v) & (a ^ r) & 0x8000) ? SN_V : 0; if (r > 0x9FFF) r += 0x6000;
        this.p = (p & ~(SN_V | SN_C)) | vf | (r > 0xFFFF ? SN_C : 0);
      }
      r &= 0xFFFF; this.a = r; this.nz16(r);
    }
  }
  sbc(v) {
    const p = this.p, c = p & SN_C;
    if (p & SN_M) {
      v = (v ^ 0xFF) & 0xFF; const a = this.a & 0xFF; let r;
      if (!(p & SN_D)) { r = a + v + c; this.p = (p & ~(SN_V | SN_C)) | (~(a ^ v) & (a ^ r) & 0x80 ? SN_V : 0) | (r > 0xFF ? SN_C : 0); }
      else {
        r = (a & 0xF) + (v & 0xF) + c; if (r <= 0xF) r -= 6;
        const cc = r > 0xF ? 0x10 : 0; r = (a & 0xF0) + (v & 0xF0) + cc + (r & 0xF);
        const vf = (~(a ^ v) & (a ^ r) & 0x80) ? SN_V : 0; if (r <= 0xFF) r -= 0x60;
        this.p = (p & ~(SN_V | SN_C)) | vf | (r > 0xFF ? SN_C : 0);
      }
      r &= 0xFF; this.a = (this.a & 0xFF00) | r; this.nz8(r);
    } else {
      v = (v ^ 0xFFFF) & 0xFFFF; const a = this.a; let r;
      if (!(p & SN_D)) { r = a + v + c; this.p = (p & ~(SN_V | SN_C)) | (~(a ^ v) & (a ^ r) & 0x8000 ? SN_V : 0) | (r > 0xFFFF ? SN_C : 0); }
      else {
        r = (a & 0xF) + (v & 0xF) + c; if (r <= 0xF) r -= 6;
        let cc = r > 0xF ? 0x10 : 0; r = (a & 0xF0) + (v & 0xF0) + cc + (r & 0xF); if (r <= 0xFF) r -= 0x60;
        cc = r > 0xFF ? 0x100 : 0; r = (a & 0xF00) + (v & 0xF00) + cc + (r & 0xFF); if (r <= 0xFFF) r -= 0x600;
        cc = r > 0xFFF ? 0x1000 : 0; r = (a & 0xF000) + (v & 0xF000) + cc + (r & 0xFFF);
        const vf = (~(a ^ v) & (a ^ r) & 0x8000) ? SN_V : 0; if (r <= 0xFFFF) r -= 0x6000;
        this.p = (p & ~(SN_V | SN_C)) | vf | (r > 0xFFFF ? SN_C : 0);
      }
      r &= 0xFFFF; this.a = r; this.nz16(r);
    }
  }
  /* comparação genérica de 8 ou 16 bits */
  cmp(reg, v, is8) {
    if (is8) { reg &= 0xFF; const r = reg - v; this.p = (this.p & ~SN_C) | (reg >= v ? SN_C : 0); this.nz8(r & 0xFF); }
    else { reg &= 0xFFFF; const r = reg - v; this.p = (this.p & ~SN_C) | (reg >= v ? SN_C : 0); this.nz16(r & 0xFFFF); }
  }
  /* deslocamentos: kind 0 ASL, 1 ROL, 2 LSR, 3 ROR; devolve o novo valor */
  shift(kind, v, is8) {
    const c = this.p & SN_C, top = is8 ? 0x80 : 0x8000, mask = is8 ? 0xFF : 0xFFFF; let r, co;
    switch (kind) {
      case 0: co = v & top; r = (v << 1) & mask; break;
      case 1: co = v & top; r = ((v << 1) | c) & mask; break;
      case 2: co = v & 1; r = v >> 1; break;
      default: co = v & 1; r = (v >> 1) | (c ? top : 0); break;
    }
    this.p = (this.p & ~SN_C) | (co ? SN_C : 0);
    if (is8) this.nz8(r); else this.nz16(r);
    return r;
  }
  /* RMW de memória: kind 0-3 deslocamentos, 4 DEC, 5 INC */
  rmw(kind, ea) {
    if (this.p & SN_M) {
      const v = this.rd8(ea); this.idle(1); let r;
      if (kind < 4) r = this.shift(kind, v, true); else { r = (v + (kind === 4 ? -1 : 1)) & 0xFF; this.nz8(r); }
      this.wr8(ea, r);
    } else {
      const v = this.rd16(ea); this.idle(1); let r;
      if (kind < 4) r = this.shift(kind, v, false); else { r = (v + (kind === 4 ? -1 : 1)) & 0xFFFF; this.nz16(r); }
      this.wr16r(ea, r);
    }
  }
  rmwA(kind) {
    this.idle(1);
    if (this.p & SN_M) {
      const v = this.a & 0xFF; let r;
      if (kind < 4) r = this.shift(kind, v, true); else { r = (v + (kind === 4 ? -1 : 1)) & 0xFF; this.nz8(r); }
      this.a = (this.a & 0xFF00) | r;
    } else {
      let r; if (kind < 4) r = this.shift(kind, this.a, false); else { r = (this.a + (kind === 4 ? -1 : 1)) & 0xFFFF; this.nz16(r); }
      this.a = r;
    }
  }
  branch(cond) {
    const o = this.fetch8();
    if (cond) { this.idle(1); this.pc = (this.pc + (o << 24 >> 24)) & 0xFFFF; }
  }
  /* ---- interrupções ---- */
  interrupt(kind) { // 0 NMI, 1 IRQ, 2 BRK, 3 COP
    const nat = !this.e;
    if (nat) this.push8(this.pb);
    this.push16(this.pc);
    this.push8(nat ? this.p : ((this.p & ~0x10) | (kind >= 2 ? 0x10 : 0)));
    this.p = (this.p & ~SN_D) | SN_I; this.pb = 0;
    const vec = nat ? [0xFFEA, 0xFFEE, 0xFFE6, 0xFFE4][kind] : [0xFFFA, 0xFFFE, 0xFFFE, 0xFFF4][kind];
    this.pc = this.rd16(vec);
  }
  /* ---- execução de uma instrução ---- */
  step() {
    const bus = this.bus;
    if (bus.nmiPending) {
      bus.nmiPending = false; this.wai = false;
      if (!this.stp) { this.idle(2); this.interrupt(0); return; }
    }
    if (bus.irqLine && !this.stp) {
      if (this.wai) this.wai = false;
      if (!(this.p & SN_I)) { this.idle(2); this.interrupt(1); return; }
    }
    if (this.wai || this.stp) { this.idle(1); return; }
    const op = this.fetch8(), cc = op & 3, bbb = (op >> 2) & 7, grp = op >> 5;
    if (cc === 1 && op !== 0x89) { this.aluOp(grp, this.aluEA(bbb, grp === 4), grp); return; }
    if (cc === 3 && (bbb === 0 || bbb === 1 || bbb === 3 || bbb === 4 || bbb === 5 || bbb === 7)) { this.aluOp(grp, this.alu3EA(bbb, grp === 4), grp); return; }
    if (cc === 2 && bbb === 4) { this.aluOp(grp, this.dpInd(), grp); return; }
    this.other(op);
  }
  /* ALU: 0 ORA 1 AND 2 EOR 3 ADC 4 STA 5 LDA 6 CMP 7 SBC */
  aluOp(kind, ea) {
    const m8 = (this.p & SN_M) !== 0;
    if (kind === 4) { if (m8) this.wr8(ea, this.a); else this.wr16(ea, this.a); return; }
    const v = m8 ? this.rd8(ea) : this.rd16(ea);
    switch (kind) {
      case 0: if (m8) { const r = (this.a | v) & 0xFF; this.a = (this.a & 0xFF00) | r; this.nz8(r); } else { this.a |= v; this.nz16(this.a); } break;
      case 1: if (m8) { const r = this.a & v & 0xFF; this.a = (this.a & 0xFF00) | r; this.nz8(r); } else { this.a &= v; this.nz16(this.a); } break;
      case 2: if (m8) { const r = (this.a ^ v) & 0xFF; this.a = (this.a & 0xFF00) | r; this.nz8(r); } else { this.a ^= v; this.nz16(this.a); } break;
      case 3: this.adc(v); break;
      case 5: if (m8) { this.a = (this.a & 0xFF00) | v; this.nz8(v); } else { this.a = v; this.nz16(v); } break;
      case 6: this.cmp(this.a, v, m8); break;
      default: this.sbc(v); break;
    }
  }
  /* carga/guarda/compara de X e Y */
  ldx(ea) { if (this.p & SN_X) { this.x = this.rd8(ea); this.nz8(this.x); } else { this.x = this.rd16(ea); this.nz16(this.x); } }
  ldy(ea) { if (this.p & SN_X) { this.y = this.rd8(ea); this.nz8(this.y); } else { this.y = this.rd16(ea); this.nz16(this.y); } }
  stIdx(ea, v) { if (this.p & SN_X) this.wr8(ea, v); else this.wr16(ea, v); }
  cmpIdx(reg, ea) { const x8 = (this.p & SN_X) !== 0; this.cmp(reg, x8 ? this.rd8(ea) : this.rd16(ea), x8); }
  bit(ea, imm) {
    const m8 = (this.p & SN_M) !== 0, v = m8 ? this.rd8(ea) : this.rd16(ea), r = m8 ? (this.a & v & 0xFF) : (this.a & v & 0xFFFF);
    this.p = (this.p & ~SN_Z) | (r === 0 ? SN_Z : 0);
    if (!imm) { const nb = m8 ? 0x80 : 0x8000, vb = m8 ? 0x40 : 0x4000; this.p = (this.p & ~(SN_N | SN_V)) | (v & nb ? SN_N : 0) | (v & vb ? SN_V : 0); }
  }
  tsb(ea, reset) {
    const m8 = (this.p & SN_M) !== 0, v = m8 ? this.rd8(ea) : this.rd16(ea);
    this.p = (this.p & ~SN_Z) | ((this.a & v & (m8 ? 0xFF : 0xFFFF)) === 0 ? SN_Z : 0); this.idle(1);
    const r = reset ? (v & ~this.a) : (v | this.a);
    if (m8) this.wr8(ea, r); else this.wr16r(ea, r);
  }
  block(dir) { // MVN (dir=1) / MVP (dir=-1)
    const dbk = this.fetch8(), sbk = this.fetch8();
    this.db = dbk;
    const v = this.rd8((sbk << 16) | this.x); this.wr8((dbk << 16) | this.y, v); this.idle(2);
    const x8 = (this.p & SN_X) !== 0, mk = x8 ? 0xFF : 0xFFFF;
    this.x = (this.x + dir) & mk; this.y = (this.y + dir) & mk;
    this.a = (this.a - 1) & 0xFFFF;
    if (this.a !== 0xFFFF) this.pc = (this.pc - 3) & 0xFFFF;
  }
  other(op) {
    switch (op) {
      /* ---- controle ---- */
      case 0x00: this.fetch8(); this.interrupt(2); break; // BRK
      case 0x02: this.fetch8(); this.interrupt(3); break; // COP
      case 0x42: this.fetch8(); break; // WDM
      case 0xEA: this.idle(1); break; // NOP
      case 0xCB: this.idle(2); this.wai = true; break; // WAI
      case 0xDB: this.idle(2); this.stp = true; break; // STP
      case 0x40: // RTI
        this.idle(2);
        if (this.e) { this.setP(this.pull8()); this.pc = this.pull16(); }
        else { this.setP(this.pull8()); this.pc = this.pull16(); this.pb = this.pull8(); }
        break;
      case 0x60: this.idle(3); this.pc = (this.pull16() + 1) & 0xFFFF; break; // RTS
      case 0x6B: this.idle(2); { const l = this.pull16(); this.pb = this.pull8(); this.pc = (l + 1) & 0xFFFF; } break; // RTL
      case 0x20: { const a = this.fetch16(); this.idle(1); this.push16((this.pc - 1) & 0xFFFF); this.pc = a; } break; // JSR abs
      case 0xFC: { // JSR (abs,X)
        const lo = this.fetch8(); this.push16(this.pc); const hi = this.fetch8(); this.idle(1);
        const ptr = ((lo | (hi << 8)) + this.x) & 0xFFFF; this.pc = this.rd16((this.pb << 16) | ptr);
      } break;
      case 0x22: { // JSL
        const a = this.fetch16(); this.push8(this.pb); this.idle(1); const b = this.fetch8();
        this.push16((this.pc - 1) & 0xFFFF); this.pc = a; this.pb = b;
      } break;
      case 0x4C: this.pc = this.fetch16(); break; // JMP abs
      case 0x5C: { const a = this.fetch16(), b = this.fetch8(); this.pc = a; this.pb = b; } break; // JML long
      case 0x6C: { const a = this.fetch16(); this.pc = this.rd16(a); } break; // JMP (abs)  (banco 0)
      case 0x7C: { const a = (this.fetch16() + this.x) & 0xFFFF; this.idle(1); this.pc = this.rd16((this.pb << 16) | a); } break; // JMP (abs,X)
      case 0xDC: { const a = this.fetch16(), v = this.rd24(a); this.pc = v & 0xFFFF; this.pb = (v >> 16) & 0xFF; } break; // JML [abs]
      case 0x80: this.branch(true); break;
      case 0x82: { const o = this.fetch16(); this.idle(1); this.pc = (this.pc + o) & 0xFFFF; } break; // BRL
      case 0x10: this.branch(!(this.p & SN_N)); break;
      case 0x30: this.branch(!!(this.p & SN_N)); break;
      case 0x50: this.branch(!(this.p & SN_V)); break;
      case 0x70: this.branch(!!(this.p & SN_V)); break;
      case 0x90: this.branch(!(this.p & SN_C)); break;
      case 0xB0: this.branch(!!(this.p & SN_C)); break;
      case 0xD0: this.branch(!(this.p & SN_Z)); break;
      case 0xF0: this.branch(!!(this.p & SN_Z)); break;
      /* ---- flags ---- */
      case 0x18: this.p &= ~SN_C; this.idle(1); break;
      case 0x38: this.p |= SN_C; this.idle(1); break;
      case 0x58: this.p &= ~SN_I; this.idle(1); break;
      case 0x78: this.p |= SN_I; this.idle(1); break;
      case 0xB8: this.p &= ~SN_V; this.idle(1); break;
      case 0xD8: this.p &= ~SN_D; this.idle(1); break;
      case 0xF8: this.p |= SN_D; this.idle(1); break;
      case 0xC2: { const v = this.fetch8(); this.idle(1); this.setP(this.p & ~v); } break; // REP
      case 0xE2: { const v = this.fetch8(); this.idle(1); this.setP(this.p | v); } break; // SEP
      case 0xFB: { // XCE
        this.idle(1); const c = this.p & SN_C, e = this.e;
        this.e = c ? 1 : 0; this.p = (this.p & ~SN_C) | (e ? SN_C : 0);
        if (this.e) { this.p |= 0x30; this.s = 0x100 | (this.s & 0xFF); this.x &= 0xFF; this.y &= 0xFF; }
      } break;
      /* ---- pilha ---- */
      case 0x48: this.idle(1); if (this.p & SN_M) this.push8(this.a); else this.push16(this.a); break; // PHA
      case 0x68: this.idle(2); if (this.p & SN_M) { const v = this.pull8(); this.a = (this.a & 0xFF00) | v; this.nz8(v); } else { this.a = this.pull16(); this.nz16(this.a); } break; // PLA
      case 0xDA: this.idle(1); if (this.p & SN_X) this.push8(this.x); else this.push16(this.x); break; // PHX
      case 0xFA: this.idle(2); if (this.p & SN_X) { this.x = this.pull8(); this.nz8(this.x); } else { this.x = this.pull16(); this.nz16(this.x); } break; // PLX
      case 0x5A: this.idle(1); if (this.p & SN_X) this.push8(this.y); else this.push16(this.y); break; // PHY
      case 0x7A: this.idle(2); if (this.p & SN_X) { this.y = this.pull8(); this.nz8(this.y); } else { this.y = this.pull16(); this.nz16(this.y); } break; // PLY
      case 0x08: this.idle(1); this.push8(this.p); break; // PHP
      case 0x28: this.idle(2); this.setP(this.pull8()); break; // PLP
      case 0x8B: this.idle(1); this.push8(this.db); break; // PHB
      case 0xAB: this.idle(2); this.db = this.pull8(); this.nz8(this.db); break; // PLB
      case 0x0B: this.idle(1); this.push16(this.d); break; // PHD
      case 0x2B: this.idle(2); this.d = this.pull16(); this.nz16(this.d); break; // PLD
      case 0x4B: this.idle(1); this.push8(this.pb); break; // PHK
      case 0xF4: { const v = this.fetch16(); this.push16(v); } break; // PEA
      case 0xD4: { const a = this.dp(); this.push16(this.rd16(a)); } break; // PEI
      case 0x62: { const o = this.fetch16(); this.idle(1); this.push16((this.pc + o) & 0xFFFF); } break; // PER
      /* ---- transferências ---- */
      case 0xAA: this.idle(1); if (this.p & SN_X) { this.x = this.a & 0xFF; this.nz8(this.x); } else { this.x = this.a; this.nz16(this.x); } break; // TAX
      case 0xA8: this.idle(1); if (this.p & SN_X) { this.y = this.a & 0xFF; this.nz8(this.y); } else { this.y = this.a; this.nz16(this.y); } break; // TAY
      case 0x8A: this.idle(1); if (this.p & SN_M) { this.a = (this.a & 0xFF00) | (this.x & 0xFF); this.nz8(this.a); } else { this.a = this.x; this.nz16(this.a); } break; // TXA
      case 0x98: this.idle(1); if (this.p & SN_M) { this.a = (this.a & 0xFF00) | (this.y & 0xFF); this.nz8(this.a); } else { this.a = this.y; this.nz16(this.a); } break; // TYA
      case 0x9A: this.idle(1); this.s = this.e ? (0x100 | (this.x & 0xFF)) : this.x; break; // TXS
      case 0xBA: this.idle(1); if (this.p & SN_X) { this.x = this.s & 0xFF; this.nz8(this.x); } else { this.x = this.s; this.nz16(this.x); } break; // TSX
      case 0x9B: this.idle(1); if (this.p & SN_X) { this.y = this.x & 0xFF; this.nz8(this.y); } else { this.y = this.x; this.nz16(this.y); } break; // TXY
      case 0xBB: this.idle(1); if (this.p & SN_X) { this.x = this.y & 0xFF; this.nz8(this.x); } else { this.x = this.y; this.nz16(this.x); } break; // TYX
      case 0x5B: this.idle(1); this.d = this.a; this.nz16(this.d); break; // TCD
      case 0x7B: this.idle(1); this.a = this.d; this.nz16(this.a); break; // TDC
      case 0x1B: this.idle(1); this.s = this.e ? (0x100 | (this.a & 0xFF)) : this.a; break; // TCS
      case 0x3B: this.idle(1); this.a = this.s; this.nz16(this.a); break; // TSC
      case 0xEB: { this.idle(2); this.a = ((this.a & 0xFF) << 8) | ((this.a >> 8) & 0xFF); this.nz8(this.a & 0xFF); } break; // XBA
      /* ---- incrementos ---- */
      case 0xE8: this.idle(1); if (this.p & SN_X) { this.x = (this.x + 1) & 0xFF; this.nz8(this.x); } else { this.x = (this.x + 1) & 0xFFFF; this.nz16(this.x); } break; // INX
      case 0xC8: this.idle(1); if (this.p & SN_X) { this.y = (this.y + 1) & 0xFF; this.nz8(this.y); } else { this.y = (this.y + 1) & 0xFFFF; this.nz16(this.y); } break; // INY
      case 0xCA: this.idle(1); if (this.p & SN_X) { this.x = (this.x - 1) & 0xFF; this.nz8(this.x); } else { this.x = (this.x - 1) & 0xFFFF; this.nz16(this.x); } break; // DEX
      case 0x88: this.idle(1); if (this.p & SN_X) { this.y = (this.y - 1) & 0xFF; this.nz8(this.y); } else { this.y = (this.y - 1) & 0xFFFF; this.nz16(this.y); } break; // DEY
      case 0x1A: this.rmwA(5); break; // INC A
      case 0x3A: this.rmwA(4); break; // DEC A
      /* ---- deslocamentos ---- */
      case 0x0A: this.rmwA(0); break; case 0x2A: this.rmwA(1); break; case 0x4A: this.rmwA(2); break; case 0x6A: this.rmwA(3); break;
      case 0x06: this.rmw(0, this.dp()); break; case 0x0E: this.rmw(0, this.abs()); break; case 0x16: this.rmw(0, this.dpX()); break; case 0x1E: this.rmw(0, this.absX(true)); break;
      case 0x26: this.rmw(1, this.dp()); break; case 0x2E: this.rmw(1, this.abs()); break; case 0x36: this.rmw(1, this.dpX()); break; case 0x3E: this.rmw(1, this.absX(true)); break;
      case 0x46: this.rmw(2, this.dp()); break; case 0x4E: this.rmw(2, this.abs()); break; case 0x56: this.rmw(2, this.dpX()); break; case 0x5E: this.rmw(2, this.absX(true)); break;
      case 0x66: this.rmw(3, this.dp()); break; case 0x6E: this.rmw(3, this.abs()); break; case 0x76: this.rmw(3, this.dpX()); break; case 0x7E: this.rmw(3, this.absX(true)); break;
      case 0xC6: this.rmw(4, this.dp()); break; case 0xCE: this.rmw(4, this.abs()); break; case 0xD6: this.rmw(4, this.dpX()); break; case 0xDE: this.rmw(4, this.absX(true)); break;
      case 0xE6: this.rmw(5, this.dp()); break; case 0xEE: this.rmw(5, this.abs()); break; case 0xF6: this.rmw(5, this.dpX()); break; case 0xFE: this.rmw(5, this.absX(true)); break;
      /* ---- X / Y ---- */
      case 0xA2: this.ldx(this.immX()); break; case 0xA6: this.ldx(this.dp()); break; case 0xAE: this.ldx(this.abs()); break; case 0xB6: this.ldx(this.dpY()); break; case 0xBE: this.ldx(this.absY(false)); break;
      case 0xA0: this.ldy(this.immX()); break; case 0xA4: this.ldy(this.dp()); break; case 0xAC: this.ldy(this.abs()); break; case 0xB4: this.ldy(this.dpX()); break; case 0xBC: this.ldy(this.absX(false)); break;
      case 0x86: this.stIdx(this.dp(), this.x); break; case 0x8E: this.stIdx(this.abs(), this.x); break; case 0x96: this.stIdx(this.dpY(), this.x); break;
      case 0x84: this.stIdx(this.dp(), this.y); break; case 0x8C: this.stIdx(this.abs(), this.y); break; case 0x94: this.stIdx(this.dpX(), this.y); break;
      case 0xE0: this.cmpIdx(this.x, this.immX()); break; case 0xE4: this.cmpIdx(this.x, this.dp()); break; case 0xEC: this.cmpIdx(this.x, this.abs()); break;
      case 0xC0: this.cmpIdx(this.y, this.immX()); break; case 0xC4: this.cmpIdx(this.y, this.dp()); break; case 0xCC: this.cmpIdx(this.y, this.abs()); break;
      /* ---- BIT, TSB, TRB, STZ ---- */
      case 0x89: this.bit(this.immM(), true); break;
      case 0x24: this.bit(this.dp()); break; case 0x2C: this.bit(this.abs()); break; case 0x34: this.bit(this.dpX()); break; case 0x3C: this.bit(this.absX(false)); break;
      case 0x04: this.tsb(this.dp(), false); break; case 0x0C: this.tsb(this.abs(), false); break;
      case 0x14: this.tsb(this.dp(), true); break; case 0x1C: this.tsb(this.abs(), true); break;
      case 0x64: this.stz(this.dp()); break; case 0x74: this.stz(this.dpX()); break; case 0x9C: this.stz(this.abs()); break; case 0x9E: this.stz(this.absX(true)); break;
      /* ---- cópia de bloco ---- */
      case 0x54: this.block(1); break;
      case 0x44: this.block(-1); break;
      default: throw new Error('Opcode 65816 não implementado: ' + op.toString(16));
    }
  }
  stz(ea) { if (this.p & SN_M) this.wr8(ea, 0); else this.wr16(ea, 0); }
}

if (typeof module !== 'undefined') module.exports = { CPU65816 };
