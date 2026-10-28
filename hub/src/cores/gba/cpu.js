'use strict';
/* CPU ARM7TDMI do GBA: conjuntos ARM (32 bits) e Thumb (16 bits), 7 modos com registradores
 * "banked", exceções (SWI, IRQ, instrução indefinida). Convenção de PC: durante a execução,
 * r[15] vale endereço da instrução + 8 (ARM) ou + 4 (Thumb), como no pipeline real. */

const GBA_MODE_USR = 0x10, GBA_MODE_FIQ = 0x11, GBA_MODE_IRQ = 0x12, GBA_MODE_SVC = 0x13,
  GBA_MODE_ABT = 0x17, GBA_MODE_UND = 0x1B, GBA_MODE_SYS = 0x1F;
const GBA_MIDX = new Int8Array(32).fill(-1);
GBA_MIDX[0x10] = 0; GBA_MIDX[0x1F] = 0; GBA_MIDX[0x11] = 1; GBA_MIDX[0x12] = 2;
GBA_MIDX[0x13] = 3; GBA_MIDX[0x17] = 4; GBA_MIDX[0x1B] = 5;

class ARM7 {
  constructor(bus) {
    this.bus = bus;
    this.r = new Uint32Array(16);
    this.b13 = new Uint32Array(6); this.b14 = new Uint32Array(6); this.spsr = new Uint32Array(6);
    this.usrHi = new Uint32Array(5); this.fiqHi = new Uint32Array(5);
    this.n = 0; this.z = 0; this.c = 0; this.v = 0; this.i = 1; this.f = 1; this.t = 0; this.mode = GBA_MODE_SVC;
    this.sc = 0; this.pcWritten = false;
    this.irqPending = false; this.halted = false; this.swiHook = null;
    this.reset(false);
  }

  reset(skipBios) {
    this.r.fill(0); this.b13.fill(0); this.b14.fill(0); this.spsr.fill(0); this.usrHi.fill(0); this.fiqHi.fill(0);
    this.n = this.z = this.c = this.v = 0; this.t = 0; this.pcWritten = false; this.irqPending = false; this.halted = false;
    if (skipBios) { // estado em que a BIOS deixa o console antes de pular para a ROM
      this.i = 0; this.f = 0; this.mode = GBA_MODE_SYS;
      this.b13[0] = 0x03007F00; this.b13[2] = 0x03007FA0; this.b13[3] = 0x03007FE0;
      this.r[13] = 0x03007F00; this.r[15] = 0x08000000;
    } else { this.i = 1; this.f = 1; this.mode = GBA_MODE_SVC; this.r[15] = 0; }
  }

  /* ---------- CPSR / modos ---------- */
  getCpsr() { return ((this.n << 31) | (this.z << 30) | (this.c << 29) | (this.v << 28) | (this.i << 7) | (this.f << 6) | (this.t << 5) | this.mode) >>> 0; }
  setCpsr(v) {
    this.n = (v >>> 31) & 1; this.z = (v >>> 30) & 1; this.c = (v >>> 29) & 1; this.v = (v >>> 28) & 1;
    this.i = (v >>> 7) & 1; this.f = (v >>> 6) & 1; this.t = (v >>> 5) & 1;
    const m = v & 0x1F;
    if (m !== this.mode && GBA_MIDX[m] >= 0) this.switchMode(m);
  }
  getSpsr() {
    if (this.mode === GBA_MODE_USR || this.mode === GBA_MODE_SYS) return this.getCpsr();
    return this.spsr[GBA_MIDX[this.mode]];
  }
  switchMode(nm) {
    const o = GBA_MIDX[this.mode], n = GBA_MIDX[nm], r = this.r;
    if (o !== n) {
      this.b13[o] = r[13]; this.b14[o] = r[14];
      if (o === 1) for (let k = 0; k < 5; k++) { this.fiqHi[k] = r[8 + k]; r[8 + k] = this.usrHi[k]; }
      if (n === 1) for (let k = 0; k < 5; k++) { this.usrHi[k] = r[8 + k]; r[8 + k] = this.fiqHi[k]; }
      r[13] = this.b13[n]; r[14] = this.b14[n];
    }
    this.mode = nm;
  }
  getUser(k) {
    const m = this.mode;
    if (k >= 8 && k <= 12) return m === GBA_MODE_FIQ ? this.usrHi[k - 8] : this.r[k];
    if ((k === 13 || k === 14) && m !== GBA_MODE_USR && m !== GBA_MODE_SYS) return k === 13 ? this.b13[0] : this.b14[0];
    return this.r[k];
  }
  setUser(k, v) {
    const m = this.mode;
    if (k >= 8 && k <= 12 && m === GBA_MODE_FIQ) this.usrHi[k - 8] = v;
    else if ((k === 13 || k === 14) && m !== GBA_MODE_USR && m !== GBA_MODE_SYS) { if (k === 13) this.b13[0] = v; else this.b14[0] = v; }
    else this.r[k] = v;
  }

  /* ---------- exceções ---------- */
  exception(vec, mode, lr) {
    const old = this.getCpsr();
    this.switchMode(mode);
    this.spsr[GBA_MIDX[mode]] = old;
    this.r[14] = lr;
    this.t = 0; this.i = 1;
    if (mode === GBA_MODE_FIQ) this.f = 1;
    this.r[15] = vec; this.pcWritten = true;
  }
  undef(pc) { this.exception(0x04, GBA_MODE_UND, pc + (this.t ? 2 : 4)); return 3; }
  swi(num, pc) {
    if (this.swiHook && this.swiHook(num, pc)) return 3;
    this.exception(0x08, GBA_MODE_SVC, pc + (this.t ? 2 : 4));
    return 3;
  }

  /* ---------- helpers ---------- */
  setPC(v) { this.r[15] = this.t ? (v & ~1) : (v & ~3); this.pcWritten = true; }
  bx(v) { if (v & 1) { this.t = 1; this.setPC(v); } else { this.t = 0; this.setPC(v); } }
  setNZ(v) { this.n = v >>> 31; this.z = v === 0 ? 1 : 0; }
  cond(c) {
    switch (c) {
      case 0: return this.z === 1; case 1: return this.z === 0;
      case 2: return this.c === 1; case 3: return this.c === 0;
      case 4: return this.n === 1; case 5: return this.n === 0;
      case 6: return this.v === 1; case 7: return this.v === 0;
      case 8: return this.c === 1 && this.z === 0; case 9: return this.c === 0 || this.z === 1;
      case 10: return this.n === this.v; case 11: return this.n !== this.v;
      case 12: return this.z === 0 && this.n === this.v; case 13: return this.z === 1 || this.n !== this.v;
      case 14: return true;
      default: return false;
    }
  }
  addc(a, b, cin, s) {
    const sum = a + b + cin, res = sum >>> 0;
    if (s) {
      this.c = sum > 0xFFFFFFFF ? 1 : 0;
      this.v = ((~(a ^ b) & (a ^ res)) >>> 31) & 1;
      this.n = res >>> 31; this.z = res === 0 ? 1 : 0;
    }
    return res;
  }
  /* type: 0 LSL, 1 LSR, 2 ASR, 3 ROR. imm = quantidade vem de campo imediato (casos especiais de 0). Resultado do carry em this.sc */
  shiftOp(type, v, amt, imm) {
    switch (type) {
      case 0:
        if (amt === 0) { this.sc = this.c; return v; }
        if (amt < 32) { this.sc = (v >>> (32 - amt)) & 1; return (v << amt) >>> 0; }
        if (amt === 32) { this.sc = v & 1; return 0; }
        this.sc = 0; return 0;
      case 1:
        if (imm && amt === 0) amt = 32;
        if (amt === 0) { this.sc = this.c; return v; }
        if (amt < 32) { this.sc = (v >>> (amt - 1)) & 1; return v >>> amt; }
        if (amt === 32) { this.sc = v >>> 31; return 0; }
        this.sc = 0; return 0;
      case 2:
        if (imm && amt === 0) amt = 32;
        if (amt === 0) { this.sc = this.c; return v; }
        if (amt < 32) { this.sc = (v >>> (amt - 1)) & 1; return (v >> amt) >>> 0; }
        this.sc = v >>> 31; return (v >> 31) >>> 0;
      default:
        if (imm && amt === 0) { const c = this.c; this.sc = v & 1; return ((v >>> 1) | (c << 31)) >>> 0; }
        if (amt === 0) { this.sc = this.c; return v; }
        amt &= 31;
        if (amt === 0) { this.sc = v >>> 31; return v; }
        this.sc = (v >>> (amt - 1)) & 1; return ((v >>> amt) | (v << (32 - amt))) >>> 0;
    }
  }
  ldr32(a) { const v = this.bus.read32(a & ~3), s = (a & 3) << 3; return s ? ((v >>> s) | (v << (32 - s))) >>> 0 : v; }
  ldrh(a) { const v = this.bus.read16(a & ~1); return (a & 1) ? ((v >>> 8) | (v << 24)) >>> 0 : v; }
  ldrsb(a) { return (this.bus.read8(a) << 24 >> 24) >>> 0; }
  ldrsh(a) { return (a & 1) ? this.ldrsb(a) : (this.bus.read16(a) << 16 >> 16) >>> 0; }

  /* ---------- um passo: executa uma instrução (ou atende IRQ). Retorna ciclos. ---------- */
  step() {
    if (this.halted) { if (this.irqPending) this.halted = false; else return 1; }
    if (this.irqPending && !this.i) {
      this.exception(0x18, GBA_MODE_IRQ, this.r[15] + 4);
      return 3;
    }
    const bus = this.bus, r = this.r;
    bus.cycles = 0;
    const pc = r[15];
    this.pcWritten = false;
    let extra = 0;
    if (this.t) {
      let instr;
      const rg = pc >>> 24;
      // busca rápida: ROM (3 ciclos de espera) e IWRAM, sem passar pelo switch do barramento
      if ((rg === 8 || rg === 9) && (pc & 0x1FFFFFE) < bus.romLen) { instr = bus.rom.u16[(pc & 0x1FFFFFE) >> 1]; bus.cycles = 3; }
      else if (rg === 3) { instr = bus.iwram.u16[(pc & 0x7FFE) >> 1]; bus.cycles = 1; }
      else instr = bus.read16(pc);
      r[15] = pc + 4;
      extra = this.execThumb(instr, pc);
      if (!this.pcWritten) r[15] = pc + 2;
    } else {
      let instr;
      const rg = pc >>> 24;
      if ((rg === 8 || rg === 9) && (pc & 0x1FFFFFC) + 4 <= bus.romLen) { instr = bus.rom.u32[(pc & 0x1FFFFFC) >> 2]; bus.cycles = 6; }
      else if (rg === 3) { instr = bus.iwram.u32[(pc & 0x7FFC) >> 2]; bus.cycles = 1; }
      else instr = bus.read32(pc);
      r[15] = pc + 8;
      if (this.cond(instr >>> 28)) extra = this.execArm(instr, pc);
      if (!this.pcWritten) r[15] = pc + 4;
    }
    return bus.cycles + extra;
  }

  /* ============================== ARM ============================== */
  execArm(i, pc) {
    const r = this.r;
    switch ((i >>> 25) & 7) {
      case 0:
        if ((i & 0x0FFFFFF0) === 0x012FFF10) { this.bx(r[i & 15]); return 2; }
        if ((i & 0x90) === 0x90) {
          if ((i & 0x0FC000F0) === 0x00000090) return this.mul(i);
          if ((i & 0x0F8000F0) === 0x00800090) return this.mull(i);
          if ((i & 0x0FB000F0) === 0x01000090) return this.swp(i);
          if (i & 0x60) return this.halfword(i);
          return this.undef(pc);
        }
        return this.dataProc(i, pc);
      case 1: return this.dataProc(i, pc);
      case 2: return this.single(i);
      case 3: if (i & 0x10) return this.undef(pc); return this.single(i);
      case 4: return this.ldmstm((i >>> 16) & 15, i & 0xFFFF, (i >>> 20) & 1, (i >>> 24) & 1, (i >>> 23) & 1, (i >>> 21) & 1, (i >>> 22) & 1);
      case 5: {
        const off = ((i & 0xFFFFFF) << 8) >> 6;
        if (i & 0x01000000) r[14] = pc + 4;
        this.setPC(pc + 8 + off);
        return 2;
      }
      case 7: if (i & 0x01000000) return this.swi(i & 0xFFFFFF, pc); return this.undef(pc);
      default: return this.undef(pc); // coprocessadores não existem no GBA
    }
  }

  dataProc(i, pc) {
    const r = this.r, op = (i >>> 21) & 15, S = (i >>> 20) & 1;
    if (op >= 8 && op <= 11 && !S) return this.psr(i, pc);
    const rn = (i >>> 16) & 15, rd = (i >>> 12) & 15;
    let op2, a, extra = 0;
    if (i & 0x02000000) {
      const rot = ((i >>> 8) & 15) * 2, imm = i & 0xFF;
      if (rot) { op2 = ((imm >>> rot) | (imm << (32 - rot))) >>> 0; this.sc = op2 >>> 31; } else { op2 = imm; this.sc = this.c; }
      a = r[rn];
    } else {
      const rm = i & 15, type = (i >>> 5) & 3;
      if (i & 0x10) { // deslocamento por registrador: PC lê como +12
        let v = r[rm]; a = r[rn];
        if (rm === 15) v = (v + 4) >>> 0;
        if (rn === 15) a = (a + 4) >>> 0;
        op2 = this.shiftOp(type, v, r[(i >>> 8) & 15] & 0xFF, false); extra = 1;
      } else {
        op2 = this.shiftOp(type, r[rm], (i >>> 7) & 31, true); a = r[rn];
      }
    }
    let res = 0, write = true, logical = false;
    switch (op) {
      case 0: res = (a & op2) >>> 0; logical = true; break;
      case 1: res = (a ^ op2) >>> 0; logical = true; break;
      case 2: res = this.addc(a, ~op2 >>> 0, 1, S); break;
      case 3: res = this.addc(op2, ~a >>> 0, 1, S); break;
      case 4: res = this.addc(a, op2, 0, S); break;
      case 5: res = this.addc(a, op2, this.c, S); break;
      case 6: res = this.addc(a, ~op2 >>> 0, this.c, S); break;
      case 7: res = this.addc(op2, ~a >>> 0, this.c, S); break;
      case 8: res = (a & op2) >>> 0; logical = true; write = false; break;
      case 9: res = (a ^ op2) >>> 0; logical = true; write = false; break;
      case 10: this.addc(a, ~op2 >>> 0, 1, 1); write = false; break;
      case 11: this.addc(a, op2, 0, 1); write = false; break;
      case 12: res = (a | op2) >>> 0; logical = true; break;
      case 13: res = op2; logical = true; break;
      case 14: res = (a & ~op2) >>> 0; logical = true; break;
      default: res = ~op2 >>> 0; logical = true;
    }
    if (rd === 15 && write) {
      if (S) this.setCpsr(this.getSpsr());
      this.setPC(res);
      return extra + 2;
    }
    if (logical && S) { this.setNZ(res); this.c = this.sc; }
    if (write) r[rd] = res;
    return extra;
  }

  psr(i, pc) {
    if ((i & 0x0FBF0FFF) === 0x010F0000) { // MRS
      this.r[(i >>> 12) & 15] = (i & 0x400000) ? this.getSpsr() : this.getCpsr();
      return 0;
    }
    if ((i & 0x0DB0F000) === 0x0120F000) { // MSR
      let v;
      if (i & 0x02000000) { const rot = ((i >>> 8) & 15) * 2, imm = i & 0xFF; v = rot ? ((imm >>> rot) | (imm << (32 - rot))) >>> 0 : imm; }
      else v = this.r[i & 15];
      let mask = 0;
      if (i & 0x80000) mask |= 0xFF000000;
      if (i & 0x40000) mask |= 0x00FF0000;
      if (i & 0x20000) mask |= 0x0000FF00;
      if (i & 0x10000) mask |= 0x000000FF;
      if (i & 0x400000) {
        if (this.mode !== GBA_MODE_USR && this.mode !== GBA_MODE_SYS) {
          const k = GBA_MIDX[this.mode];
          this.spsr[k] = ((this.spsr[k] & ~mask) | (v & mask)) >>> 0;
        }
      } else {
        if (this.mode === GBA_MODE_USR) mask &= 0xFF000000;
        this.setCpsr(((this.getCpsr() & ~mask) | (v & mask)) >>> 0);
      }
      return 0;
    }
    return this.undef(pc);
  }

  mul(i) {
    const r = this.r, rd = (i >>> 16) & 15, rn = (i >>> 12) & 15, rs = (i >>> 8) & 15, rm = i & 15;
    let res = Math.imul(r[rm], r[rs]);
    if (i & 0x200000) res += r[rn];
    res >>>= 0;
    r[rd] = res;
    if (i & 0x100000) this.setNZ(res);
    return 2;
  }
  mull(i) {
    const r = this.r, hi = (i >>> 16) & 15, lo = (i >>> 12) & 15, rs = (i >>> 8) & 15, rm = i & 15;
    const signed = (i & 0x400000) !== 0;
    let p = signed ? BigInt(r[rm] | 0) * BigInt(r[rs] | 0) : BigInt(r[rm]) * BigInt(r[rs]);
    if (i & 0x200000) p += (BigInt(r[hi]) << 32n) | BigInt(r[lo]);
    p = BigInt.asUintN(64, p);
    const l = Number(p & 0xFFFFFFFFn) >>> 0, h = Number(p >> 32n) >>> 0;
    r[lo] = l; r[hi] = h;
    if (i & 0x100000) { this.n = h >>> 31; this.z = (h | l) === 0 ? 1 : 0; }
    return 3;
  }
  swp(i) {
    const r = this.r, bus = this.bus, addr = r[(i >>> 16) & 15], rd = (i >>> 12) & 15, rm = i & 15;
    let t;
    if (i & 0x400000) { t = bus.read8(addr); bus.write8(addr, r[rm] & 0xFF); }
    else { t = this.ldr32(addr); bus.write32(addr & ~3, r[rm]); }
    r[rd] = t;
    return 3;
  }

  halfword(i) {
    const r = this.r, bus = this.bus;
    const rn = (i >>> 16) & 15, rd = (i >>> 12) & 15, P = (i >>> 24) & 1, U = (i >>> 23) & 1, W = (i >>> 21) & 1, L = (i >>> 20) & 1, sh = (i >>> 5) & 3;
    const off = (i & 0x400000) ? (((i >>> 4) & 0xF0) | (i & 15)) : r[i & 15];
    const base = r[rn], sv = r[rd];
    const offAddr = (U ? base + off : base - off) >>> 0;
    const addr = P ? offAddr : base;
    if ((!P || W) && rn !== 15) r[rn] = offAddr;
    if (L) {
      const v = sh === 1 ? this.ldrh(addr) : sh === 2 ? this.ldrsb(addr) : this.ldrsh(addr);
      if (rd === 15) { this.setPC(v); return 4; }
      r[rd] = v; return 1;
    }
    bus.write16(addr & ~1, (rd === 15 ? sv + 4 : sv) & 0xFFFF);
    return 0;
  }

  single(i) {
    const r = this.r, bus = this.bus;
    const rn = (i >>> 16) & 15, rd = (i >>> 12) & 15, P = (i >>> 24) & 1, U = (i >>> 23) & 1, B = (i >>> 22) & 1, W = (i >>> 21) & 1, L = (i >>> 20) & 1;
    const off = (i & 0x02000000) ? this.shiftOp((i >>> 5) & 3, r[i & 15], (i >>> 7) & 31, true) : (i & 0xFFF);
    const base = r[rn], sv = r[rd];
    const offAddr = (U ? base + off : base - off) >>> 0;
    const addr = P ? offAddr : base;
    if ((!P || W) && rn !== 15) r[rn] = offAddr;
    if (L) {
      const v = B ? bus.read8(addr) : this.ldr32(addr);
      if (rd === 15) { this.setPC(v); return 4; }
      r[rd] = v; return 1;
    }
    const v = rd === 15 ? (sv + 4) >>> 0 : sv;
    if (B) bus.write8(addr, v & 0xFF); else bus.write32(addr & ~3, v);
    return 0;
  }

  /* LDM/STM (ARM e Thumb). P=pré-indexado, U=sobe, W=writeback, S=banco de usuário / restaura CPSR */
  ldmstm(rn, list, L, P, U, W, S) {
    const r = this.r, bus = this.bus;
    let count = 0;
    for (let k = 0; k < 16; k++) if (list & (1 << k)) count++;
    let delta = count * 4;
    if (list === 0) { list = 0x8000; count = 1; delta = 0x40; } // lista vazia: transfere só r15
    const base = r[rn];
    let start, wb;
    if (U) { start = base + (P ? 4 : 0); wb = base + delta; }
    else { start = base - delta + (P ? 0 : 4); wb = base - delta; }
    start = (start & ~3) >>> 0; wb = wb >>> 0;
    const userBank = S && !(L && (list & 0x8000));
    let addr = start;
    if (L) {
      if (W) r[rn] = wb;
      for (let k = 0; k < 16; k++) {
        if (!(list & (1 << k))) continue;
        const v = bus.read32(addr); addr = (addr + 4) >>> 0;
        if (userBank) this.setUser(k, v);
        else if (k === 15) { if (S) this.setCpsr(this.getSpsr()); this.setPC(v); }
        else r[k] = v;
      }
      return count + 1 + ((list & 0x8000) ? 2 : 0);
    }
    let first = true;
    for (let k = 0; k < 16; k++) {
      if (!(list & (1 << k))) continue;
      let v = userBank ? this.getUser(k) : r[k];
      if (k === 15) v = (v + 4) >>> 0;
      bus.write32(addr, v); addr = (addr + 4) >>> 0;
      if (first) { first = false; if (W) r[rn] = wb; }
    }
    return count;
  }

  /* ============================== THUMB ============================== */
  execThumb(i, pc) {
    const r = this.r, bus = this.bus;
    switch (i >>> 13) {
      case 0: {
        const op = (i >>> 11) & 3;
        if (op === 3) { // soma/subtração com registrador ou imediato de 3 bits
          const rd = i & 7, a = r[(i >>> 3) & 7], n = (i >>> 6) & 7, o2 = (i & 0x400) ? n : r[n];
          r[rd] = (i & 0x200) ? this.addc(a, ~o2 >>> 0, 1, 1) : this.addc(a, o2, 0, 1);
        } else {
          const v = this.shiftOp(op, r[(i >>> 3) & 7], (i >>> 6) & 31, true);
          r[i & 7] = v; this.setNZ(v); this.c = this.sc;
        }
        return 0;
      }
      case 1: {
        const rd = (i >>> 8) & 7, imm = i & 0xFF;
        switch ((i >>> 11) & 3) {
          case 0: r[rd] = imm; this.setNZ(imm); break;
          case 1: this.addc(r[rd], ~imm >>> 0, 1, 1); break;
          case 2: r[rd] = this.addc(r[rd], imm, 0, 1); break;
          default: r[rd] = this.addc(r[rd], ~imm >>> 0, 1, 1);
        }
        return 0;
      }
      case 2: {
        if ((i & 0xFC00) === 0x4000) return this.thumbAlu(i);
        if ((i & 0xFC00) === 0x4400) { // registradores altos / BX
          const op = (i >>> 8) & 3, rs = ((i >>> 3) & 7) | (((i >>> 6) & 1) << 3), rd = (i & 7) | (((i >>> 7) & 1) << 3);
          switch (op) {
            case 0: { const v = (r[rd] + r[rs]) >>> 0; if (rd === 15) { this.setPC(v); return 2; } r[rd] = v; return 0; }
            case 1: this.addc(r[rd], ~r[rs] >>> 0, 1, 1); return 0;
            case 2: { const v = r[rs]; if (rd === 15) { this.setPC(v); return 2; } r[rd] = v; return 0; }
            default: this.bx(r[rs]); return 2;
          }
        }
        if ((i & 0xF800) === 0x4800) { // LDR rd,[pc,#imm]
          r[(i >>> 8) & 7] = bus.read32(((r[15] & ~3) + ((i & 0xFF) << 2)) >>> 0);
          return 1;
        }
        // 0101: load/store com registrador de offset
        const addr = (r[(i >>> 3) & 7] + r[(i >>> 6) & 7]) >>> 0, rd = i & 7, k = (i >>> 9) & 7;
        switch (k) {
          case 0: bus.write32(addr & ~3, r[rd]); return 0;           // STR
          case 1: bus.write16(addr & ~1, r[rd] & 0xFFFF); return 0;  // STRH
          case 2: bus.write8(addr, r[rd] & 0xFF); return 0;          // STRB
          case 3: r[rd] = this.ldrsb(addr); return 1;                // LDSB
          case 4: r[rd] = this.ldr32(addr); return 1;                // LDR
          case 5: r[rd] = this.ldrh(addr); return 1;                 // LDRH
          case 6: r[rd] = bus.read8(addr); return 1;                 // LDRB
          default: r[rd] = this.ldrsh(addr); return 1;               // LDSH
        }
      }
      case 3: { // load/store com offset imediato (word/byte)
        const B = (i >>> 12) & 1, L = (i >>> 11) & 1, off = (i >>> 6) & 31, rd = i & 7;
        const addr = (r[(i >>> 3) & 7] + (B ? off : off << 2)) >>> 0;
        if (L) { r[rd] = B ? bus.read8(addr) : this.ldr32(addr); return 1; }
        if (B) bus.write8(addr, r[rd] & 0xFF); else bus.write32(addr & ~3, r[rd]);
        return 0;
      }
      case 4: {
        const L = (i >>> 11) & 1;
        if (!(i & 0x1000)) { // halfword com offset imediato
          const addr = (r[(i >>> 3) & 7] + (((i >>> 6) & 31) << 1)) >>> 0, rd = i & 7;
          if (L) { r[rd] = this.ldrh(addr); return 1; }
          bus.write16(addr & ~1, r[rd] & 0xFFFF); return 0;
        }
        const rd = (i >>> 8) & 7, addr = (r[13] + ((i & 0xFF) << 2)) >>> 0; // relativo ao SP
        if (L) { r[rd] = this.ldr32(addr); return 1; }
        bus.write32(addr & ~3, r[rd]); return 0;
      }
      case 5: {
        if (!(i & 0x1000)) { // ADD rd, PC/SP, #imm
          const rd = (i >>> 8) & 7, imm = (i & 0xFF) << 2;
          r[rd] = (((i & 0x800) ? r[13] : (r[15] & ~3)) + imm) >>> 0;
          return 0;
        }
        if ((i & 0x0F00) === 0) { // ADD SP, #±imm
          const imm = (i & 0x7F) << 2;
          r[13] = (i & 0x80) ? r[13] - imm : r[13] + imm;
          return 0;
        }
        if ((i & 0x0600) === 0x0400) { // PUSH / POP
          const list = i & 0xFF, R = (i >>> 8) & 1;
          let count = R; for (let k = 0; k < 8; k++) if (list & (1 << k)) count++;
          if (i & 0x800) { // POP
            let a = r[13];
            for (let k = 0; k < 8; k++) if (list & (1 << k)) { r[k] = bus.read32(a); a = (a + 4) >>> 0; }
            if (R) { const v = bus.read32(a); a = (a + 4) >>> 0; r[13] = a; this.setPC(v); return count + 3; }
            r[13] = a; return count + 1;
          }
          let a = (r[13] - count * 4) >>> 0; r[13] = a; // PUSH
          for (let k = 0; k < 8; k++) if (list & (1 << k)) { bus.write32(a, r[k]); a = (a + 4) >>> 0; }
          if (R) bus.write32(a, r[14]);
          return count;
        }
        return this.undef(pc);
      }
      case 6: {
        if (!(i & 0x1000)) { // STMIA / LDMIA
          return this.ldmstm((i >>> 8) & 7, i & 0xFF, (i >>> 11) & 1, 0, 1, 1, 0);
        }
        const cnd = (i >>> 8) & 15;
        if (cnd === 15) return this.swi(i & 0xFF, pc);
        if (cnd === 14) return this.undef(pc);
        if (this.cond(cnd)) { this.setPC(pc + 4 + (((i & 0xFF) << 24 >> 24) << 1)); return 2; }
        return 0;
      }
      default: { // 111
        if (!(i & 0x1000)) { // 11100: desvio incondicional
          if (i & 0x0800) return this.undef(pc); // BLX (não existe em ARMv4T)
          this.setPC(pc + 4 + (((i & 0x7FF) << 21 >> 21) << 1));
          return 2;
        }
        if (!(i & 0x0800)) { // BL, primeira metade
          r[14] = (pc + 4 + (((i & 0x7FF) << 21 >> 21) << 12)) >>> 0;
          return 0;
        }
        const target = (r[14] + ((i & 0x7FF) << 1)) >>> 0; // BL, segunda metade
        r[14] = ((pc + 2) | 1) >>> 0;
        this.setPC(target);
        return 2;
      }
    }
  }

  thumbAlu(i) {
    const r = this.r, rd = i & 7, a = r[rd], b = r[(i >>> 3) & 7];
    let res;
    switch ((i >>> 6) & 15) {
      case 0: res = (a & b) >>> 0; this.setNZ(res); r[rd] = res; break;
      case 1: res = (a ^ b) >>> 0; this.setNZ(res); r[rd] = res; break;
      case 2: res = this.shiftOp(0, a, b & 0xFF, false); this.setNZ(res); this.c = this.sc; r[rd] = res; return 1;
      case 3: res = this.shiftOp(1, a, b & 0xFF, false); this.setNZ(res); this.c = this.sc; r[rd] = res; return 1;
      case 4: res = this.shiftOp(2, a, b & 0xFF, false); this.setNZ(res); this.c = this.sc; r[rd] = res; return 1;
      case 5: r[rd] = this.addc(a, b, this.c, 1); break;
      case 6: r[rd] = this.addc(a, ~b >>> 0, this.c, 1); break;
      case 7: res = this.shiftOp(3, a, b & 0xFF, false); this.setNZ(res); this.c = this.sc; r[rd] = res; return 1;
      case 8: this.setNZ((a & b) >>> 0); break;
      case 9: r[rd] = this.addc(0, ~b >>> 0, 1, 1); break;
      case 10: this.addc(a, ~b >>> 0, 1, 1); break;
      case 11: this.addc(a, b, 0, 1); break;
      case 12: res = (a | b) >>> 0; this.setNZ(res); r[rd] = res; break;
      case 13: res = Math.imul(a, b) >>> 0; this.setNZ(res); r[rd] = res; return 2;
      case 14: res = (a & ~b) >>> 0; this.setNZ(res); r[rd] = res; break;
      default: res = ~b >>> 0; this.setNZ(res); r[rd] = res;
    }
    return 0;
  }
}

if (typeof module !== 'undefined') module.exports = { ARM7, GBA_MODE_USR, GBA_MODE_FIQ, GBA_MODE_IRQ, GBA_MODE_SVC, GBA_MODE_SYS, GBA_MODE_UND };
