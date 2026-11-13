#include "snes_cpu.h"

namespace emuhub {

void Snes65816::reset() {
  a = x = y = 0; s = 0x1FF; d = db = pb = 0; p = 0x34; e = 1; wai = stp = false; bad_opcode = -1;
  pc = rd16(0xFFFC);
}

int Snes65816::rd16(std::uint32_t ad) { const int l = rd8(ad); return l | (rd8((ad + 1) & 0xFFFFFF) << 8); }
int Snes65816::rd24(std::uint32_t ad) { const int l = rd8(ad); const int m = rd8((ad + 1) & 0xFFFFFF); return l | (m << 8) | (rd8((ad + 2) & 0xFFFFFF) << 16); }
void Snes65816::wr16(std::uint32_t ad, int v) { wr8(ad, v); wr8((ad + 1) & 0xFFFFFF, v >> 8); }
void Snes65816::wr16r(std::uint32_t ad, int v) { wr8((ad + 1) & 0xFFFFFF, v >> 8); wr8(ad, v); }
int Snes65816::fetch8() { const int v = rd8((static_cast<std::uint32_t>(pb) << 16) | pc); pc = (pc + 1) & 0xFFFF; return v; }
int Snes65816::fetch16() { const int l = fetch8(); return l | (fetch8() << 8); }
int Snes65816::fetch24() { const int l = fetch16(); return l | (fetch8() << 16); }

void Snes65816::push8(int v) { wr8(s, v); s = e ? (0x100 | ((s - 1) & 0xFF)) : ((s - 1) & 0xFFFF); }
void Snes65816::push16(int v) { push8(v >> 8); push8(v); }
int Snes65816::pull8() { s = e ? (0x100 | ((s + 1) & 0xFF)) : ((s + 1) & 0xFFFF); return rd8(s); }
int Snes65816::pull16() { const int l = pull8(); return l | (pull8() << 8); }

void Snes65816::nz8(int v) { p = (p & ~(N | Z)) | (v & 0x80) | ((v & 0xFF) == 0 ? Z : 0); }
void Snes65816::nz16(int v) { p = (p & ~(N | Z)) | ((v >> 8) & 0x80) | ((v & 0xFFFF) == 0 ? Z : 0); }
void Snes65816::set_p(int v) {
  p = v & 0xFF;
  if (e) p |= 0x30;
  if (p & X) { x &= 0xFF; y &= 0xFF; }
}

/* ---- modos de endereçamento ---- */
std::uint32_t Snes65816::dp() { const int o = fetch8(); if (d & 0xFF) idle(1); return (d + o) & 0xFFFF; }
std::uint32_t Snes65816::dp_x() { const int o = fetch8(); if (d & 0xFF) idle(1); idle(1); return (d + o + ((p & X) ? x & 0xFF : x)) & 0xFFFF; }
std::uint32_t Snes65816::dp_y() { const int o = fetch8(); if (d & 0xFF) idle(1); idle(1); return (d + o + ((p & X) ? y & 0xFF : y)) & 0xFFFF; }
std::uint32_t Snes65816::abs_() { return (static_cast<std::uint32_t>(db) << 16) | fetch16(); }
std::uint32_t Snes65816::abs_x(bool w) {
  const std::uint32_t base = (static_cast<std::uint32_t>(db) << 16) | fetch16(), ea = (base + x) & 0xFFFFFF;
  if (w || !(p & X) || ((base ^ ea) & 0xFF00)) idle(1);
  return ea;
}
std::uint32_t Snes65816::abs_y(bool w) {
  const std::uint32_t base = (static_cast<std::uint32_t>(db) << 16) | fetch16(), ea = (base + y) & 0xFFFFFF;
  if (w || !(p & X) || ((base ^ ea) & 0xFF00)) idle(1);
  return ea;
}
std::uint32_t Snes65816::long_() { return fetch24(); }
std::uint32_t Snes65816::long_x() { return (fetch24() + x) & 0xFFFFFF; }
std::uint32_t Snes65816::dp_ind() { const std::uint32_t ad = dp(); return (static_cast<std::uint32_t>(db) << 16) | rd16(ad); }
std::uint32_t Snes65816::dp_ind_x() { const std::uint32_t ad = dp_x(); return (static_cast<std::uint32_t>(db) << 16) | rd16(ad); }
std::uint32_t Snes65816::dp_ind_y(bool w) {
  const std::uint32_t ad = dp(), base = (static_cast<std::uint32_t>(db) << 16) | rd16(ad), ea = (base + y) & 0xFFFFFF;
  if (w || !(p & X) || ((base ^ ea) & 0xFF00)) idle(1);
  return ea;
}
std::uint32_t Snes65816::dp_ind_long() { return rd24(dp()); }
std::uint32_t Snes65816::dp_ind_long_y() { return (rd24(dp()) + y) & 0xFFFFFF; }
std::uint32_t Snes65816::sr() { const int o = fetch8(); idle(1); return (s + o) & 0xFFFF; }
std::uint32_t Snes65816::sr_ind_y() {
  const int o = fetch8(); idle(1); const int ptr = rd16((s + o) & 0xFFFF); idle(1);
  return (((static_cast<std::uint32_t>(db) << 16) | ptr) + y) & 0xFFFFFF;
}
std::uint32_t Snes65816::imm_m() { const std::uint32_t ad = (static_cast<std::uint32_t>(pb) << 16) | pc; pc = (pc + ((p & M) ? 1 : 2)) & 0xFFFF; return ad; }
std::uint32_t Snes65816::imm_x() { const std::uint32_t ad = (static_cast<std::uint32_t>(pb) << 16) | pc; pc = (pc + ((p & X) ? 1 : 2)) & 0xFFFF; return ad; }
std::uint32_t Snes65816::alu_ea(int bbb, bool w) {
  switch (bbb) {
    case 0: return dp_ind_x();
    case 1: return dp();
    case 2: return imm_m();
    case 3: return abs_();
    case 4: return dp_ind_y(w);
    case 5: return dp_x();
    case 6: return abs_y(w);
    default: return abs_x(w);
  }
}
std::uint32_t Snes65816::alu3_ea(int bbb) {
  switch (bbb) {
    case 0: return sr();
    case 1: return dp_ind_long();
    case 3: return long_();
    case 4: return sr_ind_y();
    case 5: return dp_ind_long_y();
    default: return long_x();
  }
}

/* ---- aritmética ---- */
void Snes65816::adc(int v) {
  const int pp = p, c = pp & C;
  if (pp & M) {
    const int aa = a & 0xFF; int r;
    if (!(pp & D)) { r = aa + v + c; p = (pp & ~(V | C)) | ((~(aa ^ v) & (aa ^ r) & 0x80) ? V : 0) | (r > 0xFF ? C : 0); }
    else {
      r = (aa & 0xF) + (v & 0xF) + c; if (r > 9) r += 6;
      const int cc = r > 0xF ? 0x10 : 0; r = (aa & 0xF0) + (v & 0xF0) + cc + (r & 0xF);
      const int vf = ((~(aa ^ v) & (aa ^ r) & 0x80) ? V : 0); if (r > 0x9F) r += 0x60;
      p = (pp & ~(V | C)) | vf | (r > 0xFF ? C : 0);
    }
    r &= 0xFF; a = (a & 0xFF00) | r; nz8(r);
  } else {
    const int aa = a; int r;
    if (!(pp & D)) { r = aa + v + c; p = (pp & ~(V | C)) | ((~(aa ^ v) & (aa ^ r) & 0x8000) ? V : 0) | (r > 0xFFFF ? C : 0); }
    else {
      r = (aa & 0xF) + (v & 0xF) + c; if (r > 9) r += 6;
      int cc = r > 0xF ? 0x10 : 0; r = (aa & 0xF0) + (v & 0xF0) + cc + (r & 0xF); if (r > 0x9F) r += 0x60;
      cc = r > 0xFF ? 0x100 : 0; r = (aa & 0xF00) + (v & 0xF00) + cc + (r & 0xFF); if (r > 0x9FF) r += 0x600;
      cc = r > 0xFFF ? 0x1000 : 0; r = (aa & 0xF000) + (v & 0xF000) + cc + (r & 0xFFF);
      const int vf = ((~(aa ^ v) & (aa ^ r) & 0x8000) ? V : 0); if (r > 0x9FFF) r += 0x6000;
      p = (pp & ~(V | C)) | vf | (r > 0xFFFF ? C : 0);
    }
    r &= 0xFFFF; a = r; nz16(r);
  }
}
void Snes65816::sbc(int v) {
  const int pp = p, c = pp & C;
  if (pp & M) {
    v = (v ^ 0xFF) & 0xFF; const int aa = a & 0xFF; int r;
    if (!(pp & D)) { r = aa + v + c; p = (pp & ~(V | C)) | ((~(aa ^ v) & (aa ^ r) & 0x80) ? V : 0) | (r > 0xFF ? C : 0); }
    else {
      r = (aa & 0xF) + (v & 0xF) + c; if (r <= 0xF) r -= 6;
      const int cc = r > 0xF ? 0x10 : 0; r = (aa & 0xF0) + (v & 0xF0) + cc + (r & 0xF);
      const int vf = ((~(aa ^ v) & (aa ^ r) & 0x80) ? V : 0); if (r <= 0xFF) r -= 0x60;
      p = (pp & ~(V | C)) | vf | (r > 0xFF ? C : 0);
    }
    r &= 0xFF; a = (a & 0xFF00) | r; nz8(r);
  } else {
    v = (v ^ 0xFFFF) & 0xFFFF; const int aa = a; int r;
    if (!(pp & D)) { r = aa + v + c; p = (pp & ~(V | C)) | ((~(aa ^ v) & (aa ^ r) & 0x8000) ? V : 0) | (r > 0xFFFF ? C : 0); }
    else {
      r = (aa & 0xF) + (v & 0xF) + c; if (r <= 0xF) r -= 6;
      int cc = r > 0xF ? 0x10 : 0; r = (aa & 0xF0) + (v & 0xF0) + cc + (r & 0xF); if (r <= 0xFF) r -= 0x60;
      cc = r > 0xFF ? 0x100 : 0; r = (aa & 0xF00) + (v & 0xF00) + cc + (r & 0xFF); if (r <= 0xFFF) r -= 0x600;
      cc = r > 0xFFF ? 0x1000 : 0; r = (aa & 0xF000) + (v & 0xF000) + cc + (r & 0xFFF);
      const int vf = ((~(aa ^ v) & (aa ^ r) & 0x8000) ? V : 0); if (r <= 0xFFFF) r -= 0x6000;
      p = (pp & ~(V | C)) | vf | (r > 0xFFFF ? C : 0);
    }
    r &= 0xFFFF; a = r; nz16(r);
  }
}
void Snes65816::cmp(int reg, int v, bool is8) {
  if (is8) { reg &= 0xFF; const int r = reg - v; p = (p & ~C) | (reg >= v ? C : 0); nz8(r & 0xFF); }
  else { reg &= 0xFFFF; const int r = reg - v; p = (p & ~C) | (reg >= v ? C : 0); nz16(r & 0xFFFF); }
}
int Snes65816::shift(int kind, int v, bool is8) {
  const int c = p & C, top = is8 ? 0x80 : 0x8000, mask = is8 ? 0xFF : 0xFFFF; int r, co;
  switch (kind) {
    case 0: co = v & top; r = (v << 1) & mask; break;
    case 1: co = v & top; r = ((v << 1) | c) & mask; break;
    case 2: co = v & 1; r = v >> 1; break;
    default: co = v & 1; r = (v >> 1) | (c ? top : 0); break;
  }
  p = (p & ~C) | (co ? C : 0);
  if (is8) nz8(r); else nz16(r);
  return r;
}
void Snes65816::rmw(int kind, std::uint32_t ea) {
  if (p & M) {
    const int v = rd8(ea); idle(1); int r;
    if (kind < 4) r = shift(kind, v, true); else { r = (v + (kind == 4 ? -1 : 1)) & 0xFF; nz8(r); }
    wr8(ea, r);
  } else {
    const int v = rd16(ea); idle(1); int r;
    if (kind < 4) r = shift(kind, v, false); else { r = (v + (kind == 4 ? -1 : 1)) & 0xFFFF; nz16(r); }
    wr16r(ea, r);
  }
}
void Snes65816::rmw_a(int kind) {
  idle(1);
  if (p & M) {
    const int v = a & 0xFF; int r;
    if (kind < 4) r = shift(kind, v, true); else { r = (v + (kind == 4 ? -1 : 1)) & 0xFF; nz8(r); }
    a = (a & 0xFF00) | r;
  } else {
    int r; if (kind < 4) r = shift(kind, a, false); else { r = (a + (kind == 4 ? -1 : 1)) & 0xFFFF; nz16(r); }
    a = r;
  }
}
void Snes65816::branch(bool cond) {
  const int o = fetch8();
  if (cond) { idle(1); pc = (pc + static_cast<std::int8_t>(o)) & 0xFFFF; }
}

void Snes65816::interrupt(int kind) {  // 0 NMI, 1 IRQ, 2 BRK, 3 COP
  const bool nat = !e;
  if (nat) push8(pb);
  push16(pc);
  push8(nat ? p : ((p & ~0x10) | (kind >= 2 ? 0x10 : 0)));
  p = (p & ~D) | I; pb = 0;
  static const int vn[4] = {0xFFEA, 0xFFEE, 0xFFE6, 0xFFE4}, ve[4] = {0xFFFA, 0xFFFE, 0xFFFE, 0xFFF4};
  pc = rd16(nat ? vn[kind] : ve[kind]);
}

void Snes65816::step() {
  if (bus_->nmi_pending) {
    bus_->nmi_pending = false; wai = false;
    if (!stp) { idle(2); interrupt(0); return; }
  }
  if ((bus_->irq_line || bus_->gsu_irq) && !stp) {
    if (wai) wai = false;
    if (!(p & I)) { idle(2); interrupt(1); return; }
  }
  if (wai || stp) { idle(1); return; }
  const int op = fetch8(), cc = op & 3, bbb = (op >> 2) & 7, grp = op >> 5;
  if (cc == 1 && op != 0x89) { alu_op(grp, alu_ea(bbb, grp == 4)); return; }
  if (cc == 3 && (bbb == 0 || bbb == 1 || bbb == 3 || bbb == 4 || bbb == 5 || bbb == 7)) { alu_op(grp, alu3_ea(bbb)); return; }
  if (cc == 2 && bbb == 4) { alu_op(grp, dp_ind()); return; }
  other(op);
}

void Snes65816::alu_op(int kind, std::uint32_t ea) {
  const bool m8 = (p & M) != 0;
  if (kind == 4) { if (m8) wr8(ea, a); else wr16(ea, a); return; }
  const int v = m8 ? rd8(ea) : rd16(ea);
  switch (kind) {
    case 0: if (m8) { const int r = (a | v) & 0xFF; a = (a & 0xFF00) | r; nz8(r); } else { a |= v; nz16(a); } break;
    case 1: if (m8) { const int r = a & v & 0xFF; a = (a & 0xFF00) | r; nz8(r); } else { a &= v; nz16(a); } break;
    case 2: if (m8) { const int r = (a ^ v) & 0xFF; a = (a & 0xFF00) | r; nz8(r); } else { a ^= v; nz16(a); } break;
    case 3: adc(v); break;
    case 5: if (m8) { a = (a & 0xFF00) | v; nz8(v); } else { a = v; nz16(v); } break;
    case 6: cmp(a, v, m8); break;
    default: sbc(v); break;
  }
}
void Snes65816::ldx(std::uint32_t ea) { if (p & X) { x = rd8(ea); nz8(x); } else { x = rd16(ea); nz16(x); } }
void Snes65816::ldy(std::uint32_t ea) { if (p & X) { y = rd8(ea); nz8(y); } else { y = rd16(ea); nz16(y); } }
void Snes65816::st_idx(std::uint32_t ea, int v) { if (p & X) wr8(ea, v); else wr16(ea, v); }
void Snes65816::cmp_idx(int reg, std::uint32_t ea) { const bool x8 = (p & X) != 0; cmp(reg, x8 ? rd8(ea) : rd16(ea), x8); }
void Snes65816::bit(std::uint32_t ea, bool imm) {
  const bool m8 = (p & M) != 0; const int v = m8 ? rd8(ea) : rd16(ea), r = m8 ? (a & v & 0xFF) : (a & v & 0xFFFF);
  p = (p & ~Z) | (r == 0 ? Z : 0);
  if (!imm) { const int nb = m8 ? 0x80 : 0x8000, vb = m8 ? 0x40 : 0x4000; p = (p & ~(N | V)) | ((v & nb) ? N : 0) | ((v & vb) ? V : 0); }
}
void Snes65816::tsb(std::uint32_t ea, bool reset) {
  const bool m8 = (p & M) != 0; const int v = m8 ? rd8(ea) : rd16(ea);
  p = (p & ~Z) | ((a & v & (m8 ? 0xFF : 0xFFFF)) == 0 ? Z : 0); idle(1);
  const int r = reset ? (v & ~a) : (v | a);
  if (m8) wr8(ea, r); else wr16r(ea, r);
}
void Snes65816::block(int dir) {
  const int dbk = fetch8(), sbk = fetch8();
  db = dbk;
  const int v = rd8((static_cast<std::uint32_t>(sbk) << 16) | x); wr8((static_cast<std::uint32_t>(dbk) << 16) | y, v); idle(2);
  const bool x8 = (p & X) != 0; const int mk = x8 ? 0xFF : 0xFFFF;
  x = (x + dir) & mk; y = (y + dir) & mk;
  a = (a - 1) & 0xFFFF;
  if (a != 0xFFFF) pc = (pc - 3) & 0xFFFF;
}
void Snes65816::stz(std::uint32_t ea) { if (p & M) wr8(ea, 0); else wr16(ea, 0); }

#define LD_IDX(reg, expr) do { idle(1); if (p & X) { reg = (expr) & 0xFF; nz8(reg); } else { reg = (expr); nz16(reg); } } while (0)

void Snes65816::other(int op) {
  switch (op) {
    case 0x00: fetch8(); interrupt(2); break;
    case 0x02: fetch8(); interrupt(3); break;
    case 0x42: fetch8(); break;
    case 0xEA: idle(1); break;
    case 0xCB: idle(2); wai = true; break;
    case 0xDB: idle(2); stp = true; break;
    case 0x40:
      idle(2);
      if (e) { set_p(pull8()); pc = pull16(); }
      else { set_p(pull8()); pc = pull16(); pb = pull8(); }
      break;
    case 0x60: idle(3); pc = (pull16() + 1) & 0xFFFF; break;
    case 0x6B: { idle(2); const int l = pull16(); pb = pull8(); pc = (l + 1) & 0xFFFF; } break;
    case 0x20: { const int ad = fetch16(); idle(1); push16((pc - 1) & 0xFFFF); pc = ad; } break;
    case 0xFC: {
      const int lo = fetch8(); push16(pc); const int hi = fetch8(); idle(1);
      const int ptr = ((lo | (hi << 8)) + x) & 0xFFFF; pc = rd16((static_cast<std::uint32_t>(pb) << 16) | ptr);
    } break;
    case 0x22: {
      const int ad = fetch16(); push8(pb); idle(1); const int b = fetch8();
      push16((pc - 1) & 0xFFFF); pc = ad; pb = b;
    } break;
    case 0x4C: pc = fetch16(); break;
    case 0x5C: { const int ad = fetch16(), b = fetch8(); pc = ad; pb = b; } break;
    case 0x6C: { const int ad = fetch16(); pc = rd16(ad); } break;
    case 0x7C: { const int ad = (fetch16() + x) & 0xFFFF; idle(1); pc = rd16((static_cast<std::uint32_t>(pb) << 16) | ad); } break;
    case 0xDC: { const int ad = fetch16(), v = rd24(ad); pc = v & 0xFFFF; pb = (v >> 16) & 0xFF; } break;
    case 0x80: branch(true); break;
    case 0x82: { const int o = fetch16(); idle(1); pc = (pc + o) & 0xFFFF; } break;
    case 0x10: branch(!(p & N)); break;
    case 0x30: branch(p & N); break;
    case 0x50: branch(!(p & V)); break;
    case 0x70: branch(p & V); break;
    case 0x90: branch(!(p & C)); break;
    case 0xB0: branch(p & C); break;
    case 0xD0: branch(!(p & Z)); break;
    case 0xF0: branch(p & Z); break;
    case 0x18: p &= ~C; idle(1); break;
    case 0x38: p |= C; idle(1); break;
    case 0x58: p &= ~I; idle(1); break;
    case 0x78: p |= I; idle(1); break;
    case 0xB8: p &= ~V; idle(1); break;
    case 0xD8: p &= ~D; idle(1); break;
    case 0xF8: p |= D; idle(1); break;
    case 0xC2: { const int v = fetch8(); idle(1); set_p(p & ~v); } break;
    case 0xE2: { const int v = fetch8(); idle(1); set_p(p | v); } break;
    case 0xFB: {
      idle(1); const int c = p & C, oe = e;
      e = c ? 1 : 0; p = (p & ~C) | (oe ? C : 0);
      if (e) { p |= 0x30; s = 0x100 | (s & 0xFF); x &= 0xFF; y &= 0xFF; }
    } break;
    case 0x48: idle(1); if (p & M) push8(a); else push16(a); break;
    case 0x68: idle(2); if (p & M) { const int v = pull8(); a = (a & 0xFF00) | v; nz8(v); } else { a = pull16(); nz16(a); } break;
    case 0xDA: idle(1); if (p & X) push8(x); else push16(x); break;
    case 0xFA: idle(2); if (p & X) { x = pull8(); nz8(x); } else { x = pull16(); nz16(x); } break;
    case 0x5A: idle(1); if (p & X) push8(y); else push16(y); break;
    case 0x7A: idle(2); if (p & X) { y = pull8(); nz8(y); } else { y = pull16(); nz16(y); } break;
    case 0x08: idle(1); push8(p); break;
    case 0x28: idle(2); set_p(pull8()); break;
    case 0x8B: idle(1); push8(db); break;
    case 0xAB: idle(2); db = pull8(); nz8(db); break;
    case 0x0B: idle(1); push16(d); break;
    case 0x2B: idle(2); d = pull16(); nz16(d); break;
    case 0x4B: idle(1); push8(pb); break;
    case 0xF4: { const int v = fetch16(); push16(v); } break;
    case 0xD4: { const std::uint32_t ad = dp(); push16(rd16(ad)); } break;
    case 0x62: { const int o = fetch16(); idle(1); push16((pc + o) & 0xFFFF); } break;
    case 0xAA: LD_IDX(x, a); break;
    case 0xA8: LD_IDX(y, a); break;
    case 0x8A: idle(1); if (p & M) { a = (a & 0xFF00) | (x & 0xFF); nz8(a); } else { a = x; nz16(a); } break;
    case 0x98: idle(1); if (p & M) { a = (a & 0xFF00) | (y & 0xFF); nz8(a); } else { a = y; nz16(a); } break;
    case 0x9A: idle(1); s = e ? (0x100 | (x & 0xFF)) : x; break;
    case 0xBA: LD_IDX(x, s); break;
    case 0x9B: LD_IDX(y, x); break;
    case 0xBB: LD_IDX(x, y); break;
    case 0x5B: idle(1); d = a; nz16(d); break;
    case 0x7B: idle(1); a = d; nz16(a); break;
    case 0x1B: idle(1); s = e ? (0x100 | (a & 0xFF)) : a; break;
    case 0x3B: idle(1); a = s; nz16(a); break;
    case 0xEB: idle(2); a = ((a & 0xFF) << 8) | ((a >> 8) & 0xFF); nz8(a & 0xFF); break;
    case 0xE8: idle(1); if (p & X) { x = (x + 1) & 0xFF; nz8(x); } else { x = (x + 1) & 0xFFFF; nz16(x); } break;
    case 0xC8: idle(1); if (p & X) { y = (y + 1) & 0xFF; nz8(y); } else { y = (y + 1) & 0xFFFF; nz16(y); } break;
    case 0xCA: idle(1); if (p & X) { x = (x - 1) & 0xFF; nz8(x); } else { x = (x - 1) & 0xFFFF; nz16(x); } break;
    case 0x88: idle(1); if (p & X) { y = (y - 1) & 0xFF; nz8(y); } else { y = (y - 1) & 0xFFFF; nz16(y); } break;
    case 0x1A: rmw_a(5); break;
    case 0x3A: rmw_a(4); break;
    case 0x0A: rmw_a(0); break; case 0x2A: rmw_a(1); break; case 0x4A: rmw_a(2); break; case 0x6A: rmw_a(3); break;
    case 0x06: rmw(0, dp()); break; case 0x0E: rmw(0, abs_()); break; case 0x16: rmw(0, dp_x()); break; case 0x1E: rmw(0, abs_x(true)); break;
    case 0x26: rmw(1, dp()); break; case 0x2E: rmw(1, abs_()); break; case 0x36: rmw(1, dp_x()); break; case 0x3E: rmw(1, abs_x(true)); break;
    case 0x46: rmw(2, dp()); break; case 0x4E: rmw(2, abs_()); break; case 0x56: rmw(2, dp_x()); break; case 0x5E: rmw(2, abs_x(true)); break;
    case 0x66: rmw(3, dp()); break; case 0x6E: rmw(3, abs_()); break; case 0x76: rmw(3, dp_x()); break; case 0x7E: rmw(3, abs_x(true)); break;
    case 0xC6: rmw(4, dp()); break; case 0xCE: rmw(4, abs_()); break; case 0xD6: rmw(4, dp_x()); break; case 0xDE: rmw(4, abs_x(true)); break;
    case 0xE6: rmw(5, dp()); break; case 0xEE: rmw(5, abs_()); break; case 0xF6: rmw(5, dp_x()); break; case 0xFE: rmw(5, abs_x(true)); break;
    case 0xA2: ldx(imm_x()); break; case 0xA6: ldx(dp()); break; case 0xAE: ldx(abs_()); break; case 0xB6: ldx(dp_y()); break; case 0xBE: ldx(abs_y(false)); break;
    case 0xA0: ldy(imm_x()); break; case 0xA4: ldy(dp()); break; case 0xAC: ldy(abs_()); break; case 0xB4: ldy(dp_x()); break; case 0xBC: ldy(abs_x(false)); break;
    case 0x86: st_idx(dp(), x); break; case 0x8E: st_idx(abs_(), x); break; case 0x96: st_idx(dp_y(), x); break;
    case 0x84: st_idx(dp(), y); break; case 0x8C: st_idx(abs_(), y); break; case 0x94: st_idx(dp_x(), y); break;
    case 0xE0: cmp_idx(x, imm_x()); break; case 0xE4: cmp_idx(x, dp()); break; case 0xEC: cmp_idx(x, abs_()); break;
    case 0xC0: cmp_idx(y, imm_x()); break; case 0xC4: cmp_idx(y, dp()); break; case 0xCC: cmp_idx(y, abs_()); break;
    case 0x89: bit(imm_m(), true); break;
    case 0x24: bit(dp(), false); break; case 0x2C: bit(abs_(), false); break; case 0x34: bit(dp_x(), false); break; case 0x3C: bit(abs_x(false), false); break;
    case 0x04: tsb(dp(), false); break; case 0x0C: tsb(abs_(), false); break;
    case 0x14: tsb(dp(), true); break; case 0x1C: tsb(abs_(), true); break;
    case 0x64: stz(dp()); break; case 0x74: stz(dp_x()); break; case 0x9C: stz(abs_()); break; case 0x9E: stz(abs_x(true)); break;
    case 0x54: block(1); break;
    case 0x44: block(-1); break;
    default: bad_opcode = op; break;
  }
}


void Snes65816::state(StateIO& s) {
  s.v(a); s.v(x); s.v(y); s.v(this->s); s.v(d); s.v(db); s.v(pb); s.v(pc); s.v(p); s.v(e); s.v(wai); s.v(stp);
}

}  // namespace emuhub
