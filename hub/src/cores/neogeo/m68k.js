'use strict';
/* CPU Motorola 68000 (Neo Geo): conjunto completo de instruções, exceções e interrupções por nível.
 * Tempo aproximado por instrução (base + custo do modo de endereçamento), suficiente para jogos.
 * O barramento fornece r8(a), r16(a), w8(a,v), w16(a,v); a CPU monta os acessos de 32 bits. */
const M68_MSB = [0x80, 0x8000, 0x80000000 | 0], M68_MASK = [0xFF, 0xFFFF, 0xFFFFFFFF];
const m68sg = (v, s) => s === 0 ? (v << 24) >> 24 : s === 1 ? (v << 16) >> 16 : v | 0;
const M68_EAC = [[0, 0, 4, 4, 6, 8, 10, 8, 12, 8, 10, 4], [0, 0, 8, 8, 10, 12, 14, 12, 16, 12, 14, 8]]; // custo por modo (índice: modo 0-6, 7.0=7, 7.1=8, 7.2=9, 7.3=10, 7.4=11), [byte/word, long]

class M68K {
  constructor(bus) {
    this.bus = bus; this.d = new Int32Array(8); this.a = new Int32Array(8);
    this.pc = 0; this.usp = 0; this.sr = 0x2700; this.x = 0; this.n = 0; this.z = 0; this.v = 0; this.c = 0;
    this.stopped = false; this.irq = 0; this.cyc = 0; this.eaT = 0; this.eaA = 0; this.eaV = 0; this.op = 0;
  }
  reset() {
    this.sr = 0x2700; this.x = this.n = this.z = this.v = this.c = 0; this.stopped = false; this.irq = 0; this.usp = 0;
    this.d.fill(0); this.a.fill(0);
    this.a[7] = (this.r16(0) << 16) | this.r16(2); this.pc = (this.r16(4) << 16) | this.r16(6);
  }
  /* ---- memória ---- */
  r16(a) { return this.bus.r16(a & 0xFFFFFE); }
  rd(a, s) { a &= 0xFFFFFF; const b = this.bus; return s === 0 ? (b.r8(a) << 24) >> 24 : s === 1 ? (b.r16(a & 0xFFFFFE) << 16) >> 16 : ((b.r16(a & 0xFFFFFE) << 16) | b.r16((a + 2) & 0xFFFFFE)) | 0; }
  wr(a, s, v) { a &= 0xFFFFFF; const b = this.bus; if (s === 0) b.w8(a, v & 255); else if (s === 1) b.w16(a & 0xFFFFFE, v & 0xFFFF); else { b.w16(a & 0xFFFFFE, (v >>> 16) & 0xFFFF); b.w16((a + 2) & 0xFFFFFE, v & 0xFFFF); } }
  fetch() { const v = this.bus.r16(this.pc & 0xFFFFFE); this.pc = (this.pc + 2) | 0; return v; }
  fetchS() { return (this.fetch() << 16) >> 16; }
  fetch32() { const h = this.fetch(); return ((h << 16) | this.fetch()) | 0; }
  push16(v) { this.a[7] -= 2; this.wr(this.a[7], 1, v); }
  push32(v) { this.a[7] -= 4; this.wr(this.a[7], 2, v); }
  pop16() { const v = this.rd(this.a[7], 1); this.a[7] += 2; return v & 0xFFFF; }
  pop32() { const v = this.rd(this.a[7], 2); this.a[7] += 4; return v; }
  /* ---- registrador de status ---- */
  getSR() { return (this.sr & 0xA700) | (this.x << 4) | (this.n << 3) | (this.z << 2) | (this.v << 1) | this.c; }
  setSR(v) {
    const was = this.sr & 0x2000; this.sr = v & 0xA700;
    this.x = (v >> 4) & 1; this.n = (v >> 3) & 1; this.z = (v >> 2) & 1; this.v = (v >> 1) & 1; this.c = v & 1;
    if (was !== (this.sr & 0x2000)) { const t = this.a[7]; this.a[7] = this.usp; this.usp = t; }
  }
  setCCR(v) { this.x = (v >> 4) & 1; this.n = (v >> 3) & 1; this.z = (v >> 2) & 1; this.v = (v >> 1) & 1; this.c = v & 1; }
  exception(vec, pcSave) {
    const old = this.getSR();
    if (!(this.sr & 0x2000)) { this.sr |= 0x2000; const t = this.a[7]; this.a[7] = this.usp; this.usp = t; }
    this.sr &= ~0x8000; // sem trace
    this.push32(pcSave === undefined ? this.pc : pcSave); this.push16(old);
    this.pc = (this.r16(vec * 4) << 16) | this.r16(vec * 4 + 2); this.stopped = false; this.cyc += 34;
  }
  cond(c) {
    switch (c) {
      case 0: return true; case 1: return false;
      case 2: return !this.c && !this.z; case 3: return !!(this.c | this.z);
      case 4: return !this.c; case 5: return !!this.c; case 6: return !this.z; case 7: return !!this.z;
      case 8: return !this.v; case 9: return !!this.v; case 10: return !this.n; case 11: return !!this.n;
      case 12: return this.n === this.v; case 13: return this.n !== this.v;
      case 14: return !this.z && this.n === this.v; default: return !!this.z || this.n !== this.v;
    }
  }
  /* ---- endereçamento efetivo ---- */
  ea(mode, reg, s) {
    const a = this.a;
    switch (mode) {
      case 0: this.eaT = 1; this.eaA = reg; break;
      case 1: this.eaT = 2; this.eaA = reg; break;
      case 2: this.eaT = 0; this.eaA = a[reg]; break;
      case 3: this.eaT = 0; this.eaA = a[reg]; a[reg] += (s === 0 && reg === 7) ? 2 : (1 << s); break;
      case 4: a[reg] -= (s === 0 && reg === 7) ? 2 : (1 << s); this.eaT = 0; this.eaA = a[reg]; break;
      case 5: this.eaT = 0; this.eaA = a[reg] + this.fetchS(); break;
      case 6: this.eaT = 0; this.eaA = a[reg] + this.index(); break;
      default:
        this.eaT = 0;
        if (reg === 0) this.eaA = this.fetchS();
        else if (reg === 1) this.eaA = this.fetch32();
        else if (reg === 2) { const b = this.pc; this.eaA = b + this.fetchS(); }
        else if (reg === 3) { const b = this.pc; this.eaA = b + this.index(); }
        else if (reg === 4) { this.eaT = 3; this.eaV = s === 2 ? this.fetch32() : s === 1 ? this.fetchS() : (this.fetch() << 24) >> 24; }
        else throw 0;
    }
    this.cyc += M68_EAC[s === 2 ? 1 : 0][mode < 7 ? mode : 7 + reg];
  }
  index() {
    const e = this.fetch(), r = (e >> 12) & 7, v = (e & 0x8000) ? this.a[r] : this.d[r];
    return ((e << 24) >> 24) + ((e & 0x800) ? v : (v << 16) >> 16);
  }
  readEA(s) {
    switch (this.eaT) {
      case 1: return m68sg(this.d[this.eaA], s);
      case 2: return m68sg(this.a[this.eaA], s);
      case 3: return this.eaV;
      default: return this.rd(this.eaA, s);
    }
  }
  writeEA(s, v) {
    if (this.eaT === 1) { const i = this.eaA, d = this.d[i]; this.d[i] = s === 0 ? (d & ~0xFF) | (v & 0xFF) : s === 1 ? (d & ~0xFFFF) | (v & 0xFFFF) : v; }
    else if (this.eaT === 2) this.a[this.eaA] = v;
    else this.wr(this.eaA, s, v);
  }
  /* ---- aritmética com flags ---- */
  nz(r, s) { this.n = r < 0 ? 1 : 0; this.z = r === 0 ? 1 : 0; }
  add(S, D, s, cx, xz) {
    const m = M68_MASK[s], u = (S & m) >>> 0, w = (D & m) >>> 0, r = u + w + cx, res = m68sg(r, s), ms = M68_MSB[s];
    this.c = this.x = r > m ? 1 : 0; this.v = ((u ^ r) & (w ^ r) & ms) ? 1 : 0; this.n = res < 0 ? 1 : 0;
    if (xz) { if (res !== 0) this.z = 0; } else this.z = res === 0 ? 1 : 0;
    return res;
  }
  sub(S, D, s, cx, xz, noX) {
    const m = M68_MASK[s], u = (S & m) >>> 0, w = (D & m) >>> 0, r = w - u - cx, res = m68sg(r, s), ms = M68_MSB[s];
    this.c = (u + cx) > w ? 1 : 0; if (!noX) this.x = this.c; this.v = ((u ^ w) & (w ^ r) & ms) ? 1 : 0; this.n = res < 0 ? 1 : 0;
    if (xz) { if (res !== 0) this.z = 0; } else this.z = res === 0 ? 1 : 0;
    return res;
  }
  logic(r, s) { r = m68sg(r, s); this.n = r < 0 ? 1 : 0; this.z = r === 0 ? 1 : 0; this.v = 0; this.c = 0; return r; }
  shift(type, left, val, cnt, s) {
    const bits = 8 << s, m = M68_MASK[s]; let v = (val & m) >>> 0, c = 0, vf = 0, x = this.x;
    if (cnt === 0) { this.c = type === 2 ? this.x : 0; this.v = 0; const r0 = m68sg(v, s); this.n = r0 < 0 ? 1 : 0; this.z = r0 === 0 ? 1 : 0; return r0; }
    const msb = 2 ** (bits - 1);
    for (let i = 0; i < cnt; i++) {
      if (left) {
        c = (v & msb) ? 1 : 0;
        if (type === 0) { const nm = (v * 2) % (msb * 2); if (((nm & msb) ? 1 : 0) !== c) vf = 1; v = nm; }
        else if (type === 1) v = (v * 2) % (msb * 2);
        else if (type === 2) { v = ((v * 2) % (msb * 2)) + x; x = c; }
        else v = ((v * 2) % (msb * 2)) + c;
      } else {
        c = v & 1;
        if (type === 0) v = Math.floor(v / 2) + (v & msb);
        else if (type === 1) v = Math.floor(v / 2);
        else if (type === 2) { v = Math.floor(v / 2) + (x ? msb : 0); x = c; }
        else v = Math.floor(v / 2) + (c ? msb : 0);
      }
    }
    this.c = c; if (type !== 3) this.x = type === 2 ? x : c; this.v = type === 0 ? vf : 0;
    const r = m68sg(v >>> 0, s); this.n = r < 0 ? 1 : 0; this.z = r === 0 ? 1 : 0; return r;
  }
  /* ---- execução ---- */
  step() {
    this.cyc = 0;
    if (this.irq > 0 && (this.irq > ((this.sr >> 8) & 7) || this.irq === 7)) {
      const lv = this.irq, old = this.getSR();
      if (!(this.sr & 0x2000)) { this.sr |= 0x2000; const t = this.a[7]; this.a[7] = this.usp; this.usp = t; }
      this.sr = (this.sr & ~0x8700) | (lv << 8); this.push32(this.pc); this.push16(old);
      const vec = 24 + lv; this.pc = (this.r16(vec * 4) << 16) | this.r16(vec * 4 + 2); this.stopped = false; return 44;
    }
    if (this.stopped) return 4;
    const start = (this.pc - 0) | 0, op = this.fetch(); this.op = op;
    try { this.exec(op); } catch (e) { if (e === 0) { this.pc = start; this.exception(4, start); } else throw e; }
    return this.cyc + 4;
  }
  exec(op) {
    const d = this.d, a = this.a, rx = (op >> 9) & 7, ry = op & 7, mode = (op >> 3) & 7, sz = (op >> 6) & 3;
    switch (op >> 12) {
      case 0: return this.g0(op, rx, ry, mode, sz);
      case 1: case 2: case 3: {
        const s = (op >> 12) === 1 ? 0 : (op >> 12) === 3 ? 1 : 2, dm = (op >> 6) & 7;
        this.ea(mode, ry, s); const v = this.readEA(s);
        if (dm === 1) { a[rx] = m68sg(v, s); return; }
        this.ea(dm, rx, s); this.writeEA(s, v); this.logic(v, s); return;
      }
      case 4: return this.g4(op, rx, ry, mode, sz);
      case 5: {
        if (sz === 3) {
          const cc = (op >> 8) & 15;
          if (mode === 1) { // DBcc
            const base = this.pc, disp = this.fetchS();
            if (!this.cond(cc)) { const w = ((d[ry] & 0xFFFF) - 1) & 0xFFFF; d[ry] = (d[ry] & ~0xFFFF) | w; if (w !== 0xFFFF) { this.pc = base + disp; this.cyc += 2; } else this.cyc += 6; } else this.cyc += 4;
          } else { this.ea(mode, ry, 0); const t = this.cond(cc); this.writeEA(0, t ? -1 : 0); this.cyc += t ? 2 : 0; }
          return;
        }
        let q = rx || 8; this.ea(mode, ry, sz);
        if (this.eaT === 2) { a[this.eaA] += (op & 0x100) ? -q : q; this.cyc += 4; return; }
        const v = this.readEA(sz); this.writeEA(sz, (op & 0x100) ? this.sub(q, v, sz, 0, false) : this.add(q, v, sz, 0, false)); if (sz === 2 && this.eaT === 1) this.cyc += 4; return;
      }
      case 6: {
        const base = this.pc; let disp = op & 0xFF; if (disp === 0) disp = this.fetchS(); else disp = (disp << 24) >> 24;
        const cc = (op >> 8) & 15;
        if (cc === 1) { this.push32(this.pc); this.pc = base + disp; this.cyc += 14; return; }
        if (this.cond(cc)) { this.pc = base + disp; this.cyc += 2; } else this.cyc += (op & 0xFF) === 0 ? 4 : 0; return;
      }
      case 7: { const v = (op << 24) >> 24; d[rx] = v; this.logic(v, 2); return; }
      case 8: case 12: return this.g8c(op, rx, ry, mode, sz);
      case 9: case 13: {
        const sub = (op >> 12) === 9;
        if (sz === 3) { const s = (op & 0x100) ? 2 : 1; this.ea(mode, ry, s); const v = this.readEA(s); a[rx] = sub ? a[rx] - v : a[rx] + v; this.cyc += 4; return; }
        if ((op & 0x130) === 0x100) { // ADDX/SUBX
          if (op & 8) { this.ea(4, ry, sz); const sv = this.rd(this.eaA, sz); this.ea(4, rx, sz); const dv = this.rd(this.eaA, sz); this.wr(this.eaA, sz, sub ? this.sub(sv, dv, sz, this.x, true) : this.add(sv, dv, sz, this.x, true)); }
          else { const sv = m68sg(d[ry], sz), dv = m68sg(d[rx], sz), r = sub ? this.sub(sv, dv, sz, this.x, true) : this.add(sv, dv, sz, this.x, true); d[rx] = sz === 0 ? (d[rx] & ~0xFF) | (r & 0xFF) : sz === 1 ? (d[rx] & ~0xFFFF) | (r & 0xFFFF) : r; }
          return;
        }
        this.ea(mode, ry, sz);
        if (op & 0x100) { const dv = this.readEA(sz), sv = m68sg(d[rx], sz); this.writeEA(sz, sub ? this.sub(sv, dv, sz, 0, false) : this.add(sv, dv, sz, 0, false)); }
        else { const sv = this.readEA(sz), dv = m68sg(d[rx], sz), r = sub ? this.sub(sv, dv, sz, 0, false) : this.add(sv, dv, sz, 0, false); d[rx] = sz === 0 ? (d[rx] & ~0xFF) | (r & 0xFF) : sz === 1 ? (d[rx] & ~0xFFFF) | (r & 0xFFFF) : r; if (sz === 2) this.cyc += 4; }
        return;
      }
      case 10: this.pc = (this.pc - 2) | 0; return this.exception(10, this.pc);
      case 11: {
        if (sz === 3) { const s = (op & 0x100) ? 2 : 1; this.ea(mode, ry, s); const v = this.readEA(s); this.sub(v, a[rx], 2, 0, false, true); return; }
        if (!(op & 0x100)) { this.ea(mode, ry, sz); this.sub(this.readEA(sz), m68sg(d[rx], sz), sz, 0, false, true); return; }
        if (mode === 1) { this.ea(3, ry, sz); const sv = this.rd(this.eaA, sz); this.ea(3, rx, sz); const dv = this.rd(this.eaA, sz); this.sub(sv, dv, sz, 0, false, true); return; }
        this.ea(mode, ry, sz); const dv = this.readEA(sz); this.writeEA(sz, this.logic(dv ^ d[rx], sz)); return;
      }
      case 14: {
        if (sz === 3) { // deslocamento de memória (1 posição)
          this.ea(mode, ry, 1); const v = this.readEA(1); this.writeEA(1, this.shift((op >> 9) & 3, !!(op & 0x100), v, 1, 1)); return;
        }
        const type = (op >> 3) & 3, cnt = (op & 0x20) ? (d[rx] & 63) : (rx || 8), r = this.shift(type, !!(op & 0x100), d[ry], cnt, sz);
        d[ry] = sz === 0 ? (d[ry] & ~0xFF) | (r & 0xFF) : sz === 1 ? (d[ry] & ~0xFFFF) | (r & 0xFFFF) : r; this.cyc += 2 * cnt + (sz === 2 ? 4 : 0); return;
      }
      default: this.pc = (this.pc - 2) | 0; return this.exception(11, this.pc);
    }
  }
  /* grupo 0: imediatos e operações de bit */
  g0(op, rx, ry, mode, sz) {
    const d = this.d;
    if ((op & 0x138) === 0x108) { // MOVEP
      const disp = this.fetchS(), addr = this.a[ry] + disp, dir = (op >> 6) & 3;
      if (dir === 0 || dir === 1) { const n = dir === 0 ? 2 : 4; let v = 0; for (let i = 0; i < n; i++) v = (v << 8) | (this.bus.r8((addr + i * 2) & 0xFFFFFF) & 255); d[rx] = dir === 0 ? (d[rx] & ~0xFFFF) | (v & 0xFFFF) : v; }
      else { const n = dir === 2 ? 2 : 4, v = d[rx]; for (let i = 0; i < n; i++) this.bus.w8((addr + i * 2) & 0xFFFFFF, (v >> (8 * (n - 1 - i))) & 255); }
      this.cyc += 12; return;
    }
    if ((op & 0x100) || (op & 0xF00) === 0x800) { // BTST/BCHG/BCLR/BSET
      const imm = !(op & 0x100), t = (op >> 6) & 3; let bit;
      if (imm) bit = this.fetch() & 255; else bit = d[rx];
      if (mode === 0) { bit &= 31; const v = d[ry]; this.z = (v >>> bit) & 1 ? 0 : 1; if (t === 1) d[ry] = v ^ (1 << bit); else if (t === 2) d[ry] = v & ~(1 << bit); else if (t === 3) d[ry] = v | (1 << bit); this.cyc += t ? 4 : 2; }
      else { bit &= 7; this.ea(mode, ry, 0); const v = this.readEA(0) & 255; this.z = (v >> bit) & 1 ? 0 : 1; if (t) this.writeEA(0, t === 1 ? v ^ (1 << bit) : t === 2 ? v & ~(1 << bit) : v | (1 << bit)); }
      return;
    }
    const k = (op >> 9) & 7; // 0 ORI, 1 ANDI, 2 SUBI, 3 ADDI, 5 EORI, 6 CMPI
    if (sz === 3 || k === 4 || k === 7) throw 0;
    if (mode === 7 && ry === 4 && (k === 0 || k === 1 || k === 5)) { // para CCR / SR
      const imm = this.fetch();
      if (sz === 0) { const c = this.getSR() & 0xFF, n = k === 0 ? c | imm : k === 1 ? c & imm : c ^ imm; this.setCCR(n); }
      else if (sz === 1) { if (!(this.sr & 0x2000)) { this.pc -= 2; this.exception(8, this.pc - 2); return; } const c = this.getSR(), n = k === 0 ? c | imm : k === 1 ? c & imm : c ^ imm; this.setSR(n); }
      else throw 0;
      this.cyc += 16; return;
    }
    const imm = sz === 2 ? this.fetch32() : sz === 1 ? this.fetchS() : (this.fetch() << 24) >> 24;
    this.ea(mode, ry, sz); const v = this.readEA(sz);
    switch (k) {
      case 0: this.writeEA(sz, this.logic(v | imm, sz)); break;
      case 1: this.writeEA(sz, this.logic(v & imm, sz)); break;
      case 2: this.writeEA(sz, this.sub(imm, v, sz, 0, false)); break;
      case 3: this.writeEA(sz, this.add(imm, v, sz, 0, false)); break;
      case 5: this.writeEA(sz, this.logic(v ^ imm, sz)); break;
      case 6: this.sub(imm, v, sz, 0, false, true); break;
    }
    if (this.eaT === 1 && sz === 2) this.cyc += 4;
  }
  /* grupo 4: miscelâneas */
  g4(op, rx, ry, mode, sz) {
    const d = this.d, a = this.a;
    if ((op & 0xF1C0) === 0x41C0) { this.ea(mode, ry, 2); a[rx] = this.eaA; return; } // LEA
    if ((op & 0xF1C0) === 0x4180) { // CHK
      this.ea(mode, ry, 1); const b = this.readEA(1), v = (d[rx] << 16) >> 16;
      if (v < 0) { this.n = 1; this.exception(6, this.pc); } else if (v > b) { this.n = 0; this.exception(6, this.pc); } return;
    }
    if ((op & 0xFB80) === 0x4880 && mode !== 0) return this.movem(op, ry, mode); // MOVEM
    switch (op & 0xFFC0) {
      case 0x40C0: this.ea(mode, ry, 1); this.writeEA(1, this.getSR()); return; // MOVE from SR
      case 0x44C0: this.ea(mode, ry, 1); this.setCCR(this.readEA(1)); return;
      case 0x46C0: if (!(this.sr & 0x2000)) { this.exception(8, this.pc - 2); return; } this.ea(mode, ry, 1); this.setSR(this.readEA(1)); return;
      case 0x4800: { this.ea(mode, ry, 0); const v = this.readEA(0) & 255; let lo = -(v & 15) - this.x, hi = -(v >> 4), c = 0; if (lo < 0) { lo += 10; hi--; } if (hi < 0) { hi += 10; c = 1; } const r = ((hi & 15) << 4) | lo; this.c = this.x = c; if (r) this.z = 0; this.writeEA(0, r); return; } // NBCD
      case 0x4840: if (mode === 0) { const v = d[ry]; d[ry] = (v << 16) | (v >>> 16); this.logic(d[ry], 2); } else { this.ea(mode, ry, 2); this.push32(this.eaA); } return; // SWAP / PEA
      case 0x4AC0: { this.ea(mode, ry, 0); const v = this.readEA(0); this.logic(v, 0); this.writeEA(0, v | 0x80); return; } // TAS
      case 0x4E80: this.ea(mode, ry, 2); this.push32(this.pc); this.pc = this.eaA; this.cyc += 8; return; // JSR
      case 0x4EC0: this.ea(mode, ry, 2); this.pc = this.eaA; this.cyc += 4; return; // JMP
    }
    if ((op & 0xFFF8) === 0x4880) { const v = (d[ry] << 24) >> 24; d[ry] = (d[ry] & ~0xFFFF) | (v & 0xFFFF); this.logic(v, 1); return; } // EXT.W
    if ((op & 0xFFF8) === 0x48C0) { d[ry] = (d[ry] << 16) >> 16; this.logic(d[ry], 2); return; } // EXT.L
    if ((op & 0xFFF0) === 0x4E40) return this.exception(32 + (op & 15), this.pc); // TRAP
    if ((op & 0xFFF8) === 0x4E50) { const disp = this.fetchS(); this.push32(a[ry]); a[ry] = a[7]; a[7] += disp; return; } // LINK
    if ((op & 0xFFF8) === 0x4E58) { a[7] = a[ry]; a[ry] = this.pop32(); return; } // UNLK
    if ((op & 0xFFF0) === 0x4E60) { if (!(this.sr & 0x2000)) { this.exception(8, this.pc - 2); return; } if (op & 8) a[ry] = this.usp; else this.usp = a[ry]; return; }
    switch (op) {
      case 0x4E70: if (!(this.sr & 0x2000)) this.exception(8, this.pc - 2); else this.bus.resetLine && this.bus.resetLine(); this.cyc += 128; return;
      case 0x4E71: return;
      case 0x4E72: if (!(this.sr & 0x2000)) { this.exception(8, this.pc - 2); return; } this.setSR(this.fetch()); this.stopped = true; return;
      case 0x4E73: { if (!(this.sr & 0x2000)) { this.exception(8, this.pc - 2); return; } const s = this.pop16(); this.pc = this.pop32(); this.setSR(s); this.cyc += 12; return; }
      case 0x4E75: this.pc = this.pop32(); this.cyc += 12; return;
      case 0x4E76: if (this.v) this.exception(7, this.pc); return;
      case 0x4E77: { this.setCCR(this.pop16()); this.pc = this.pop32(); this.cyc += 12; return; }
      case 0x4AFC: throw 0;
    }
    const k = (op >> 8) & 15; // 0 NEGX, 2 CLR, 4 NEG, 6 NOT, A TST
    if (sz === 3) throw 0;
    this.ea(mode, ry, sz);
    switch (k) {
      case 0: this.writeEA(sz, this.sub(this.readEA(sz), 0, sz, this.x, true)); return;
      case 2: this.readEA(sz); this.writeEA(sz, 0); this.n = 0; this.z = 1; this.v = 0; this.c = 0; return;
      case 4: this.writeEA(sz, this.sub(this.readEA(sz), 0, sz, 0, false)); return;
      case 6: this.writeEA(sz, this.logic(~this.readEA(sz), sz)); return;
      case 10: this.logic(this.readEA(sz), sz); return;
      default: throw 0;
    }
  }
  movem(op, ry, mode) {
    const s = (op & 0x40) ? 2 : 1, mask = this.fetch(), d = this.d, a = this.a, sb = 1 << s; let n = 0;
    if (!(op & 0x400)) { // registradores -> memória
      if (mode === 4) { let ad = a[ry]; for (let i = 0; i < 16; i++) if (mask & (1 << i)) { const r = 15 - i; ad -= sb; this.wr(ad, s, r < 8 ? d[r] : a[r - 8]); n++; } a[ry] = ad; }
      else { this.ea(mode, ry, s); let ad = this.eaA; for (let i = 0; i < 16; i++) if (mask & (1 << i)) { this.wr(ad, s, i < 8 ? d[i] : a[i - 8]); ad += sb; n++; } }
    } else {
      let ad; if (mode === 3) ad = a[ry]; else { this.ea(mode, ry, s); ad = this.eaA; }
      for (let i = 0; i < 16; i++) if (mask & (1 << i)) { const v = this.rd(ad, s); if (i < 8) d[i] = v; else a[i - 8] = v; ad += sb; n++; }
      if (mode === 3) a[ry] = ad;
    }
    this.cyc += 8 + n * (s === 2 ? 8 : 4);
  }
  /* grupos 8 (OR/DIV/SBCD) e C (AND/MUL/ABCD/EXG) */
  g8c(op, rx, ry, mode, sz) {
    const d = this.d, a = this.a, isC = (op >> 12) === 12;
    if (sz === 3) { // DIVU/DIVS ou MULU/MULS
      const signed = !!(op & 0x100); this.ea(mode, ry, 1);
      if (isC) { const s = this.readEA(1), dv = (d[rx] << 16) >> 16, r = signed ? Math.imul(s, dv) : Math.imul(s & 0xFFFF, d[rx] & 0xFFFF); d[rx] = r; this.logic(r, 2); this.cyc += 66; }
      else {
        const s = this.readEA(1); if (s === 0) { this.exception(5, this.pc); return; }
        if (signed) { const q = Math.trunc(d[rx] / s), r = d[rx] % s; if (q > 32767 || q < -32768) { this.v = 1; this.c = 0; this.n = 1; this.z = 0; } else { d[rx] = ((r & 0xFFFF) << 16) | (q & 0xFFFF); this.n = q < 0 ? 1 : 0; this.z = q === 0 ? 1 : 0; this.v = 0; this.c = 0; } }
        else { const dd = d[rx] >>> 0, ss = s & 0xFFFF, q = Math.floor(dd / ss), r = dd % ss; if (q > 0xFFFF) { this.v = 1; this.c = 0; this.n = 1; this.z = 0; } else { d[rx] = (r << 16) | q; this.n = (q & 0x8000) ? 1 : 0; this.z = q === 0 ? 1 : 0; this.v = 0; this.c = 0; } }
        this.cyc += signed ? 150 : 130;
      }
      return;
    }
    if ((op & 0x1F0) === 0x100) { // SBCD / ABCD
      const mem = !!(op & 8); let sv, dv;
      if (mem) { this.ea(4, ry, 0); sv = this.rd(this.eaA, 0) & 255; this.ea(4, rx, 0); dv = this.rd(this.eaA, 0) & 255; } else { sv = d[ry] & 255; dv = d[rx] & 255; }
      let r, c;
      if (isC) { let lo = (sv & 15) + (dv & 15) + this.x, hi = (sv >> 4) + (dv >> 4); if (lo > 9) { lo -= 10; hi++; } c = 0; if (hi > 9) { hi -= 10; c = 1; } r = (hi << 4) | lo; }
      else { let lo = (dv & 15) - (sv & 15) - this.x, hi = (dv >> 4) - (sv >> 4); if (lo < 0) { lo += 10; hi--; } c = 0; if (hi < 0) { hi += 10; c = 1; } r = ((hi & 15) << 4) | lo; }
      this.c = this.x = c; if (r) this.z = 0;
      if (mem) this.wr(this.eaA, 0, r); else d[rx] = (d[rx] & ~0xFF) | r; return;
    }
    if (isC && (op & 0x130) === 0x100) { // EXG
      const m = (op >> 3) & 31;
      if (m === 8) { const t = d[rx]; d[rx] = d[ry]; d[ry] = t; } else if (m === 9) { const t = a[rx]; a[rx] = a[ry]; a[ry] = t; } else if (m === 17) { const t = d[rx]; d[rx] = a[ry]; a[ry] = t; }
      return;
    }
    this.ea(mode, ry, sz);
    if (op & 0x100) { const dv = this.readEA(sz); this.writeEA(sz, this.logic(isC ? dv & d[rx] : dv | d[rx], sz)); }
    else { const sv = this.readEA(sz), r = this.logic(isC ? sv & d[rx] : sv | d[rx], sz); d[rx] = sz === 0 ? (d[rx] & ~0xFF) | (r & 0xFF) : sz === 1 ? (d[rx] & ~0xFFFF) | (r & 0xFFFF) : r; if (sz === 2) this.cyc += 4; }
  }
}
if (typeof module !== 'undefined') module.exports = { M68K };
