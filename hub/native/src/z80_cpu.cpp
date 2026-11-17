#include "z80_cpu.h"
#include <algorithm>
#include <cstring>

namespace emuhub {

namespace {
constexpr int Z_S = 0x80, Z_Z = 0x40, Z_Y = 0x20, Z_H = 0x10, Z_X = 0x08, Z_P = 0x04, Z_N = 0x02, Z_C = 0x01;
struct ZTables {
  std::uint8_t par[256], szp[256];
  ZTables() {
    for (int i = 0; i < 256; i++) {
      int p = 1;
      for (int b = 0; b < 8; b++) if ((i >> b) & 1) p ^= 1;
      par[i] = p ? Z_P : 0;
      szp[i] = static_cast<std::uint8_t>((i & (Z_S | Z_Y | Z_X)) | (i == 0 ? Z_Z : 0) | par[i]);
    }
  }
};
const ZTables& zt() { static const ZTables t; return t; }
inline int sx8(int v) { return static_cast<std::int8_t>(v); }

}  // namespace

#define SETF(expr) (c_.f = static_cast<std::uint8_t>(expr))

void Z80Cpu::reset() {
  std::memset(&c_, 0, sizeof c_);
  c_.R[7] = 0xFF; c_.f = 0xFF; c_.f2 = 0xFF;
  c_.ix = 0xFFFF; c_.iy = 0xFFFF; c_.sp = 0xFFFF; c_.pc = 0;
  c_.im = 1;
}

std::uint16_t Z80Cpu::rd16(std::uint16_t a) const {
  return static_cast<std::uint16_t>(bus_->read(a) | (bus_->read(static_cast<std::uint16_t>(a + 1)) << 8));
}
void Z80Cpu::wr16(std::uint16_t a, std::uint16_t v) {
  bus_->write(a, static_cast<std::uint8_t>(v & 255)); bus_->write(static_cast<std::uint16_t>(a + 1), static_cast<std::uint8_t>(v >> 8));
}
void Z80Cpu::push16(std::uint16_t v) {
  c_.sp = static_cast<std::uint16_t>(c_.sp - 1); bus_->write(c_.sp, static_cast<std::uint8_t>(v >> 8));
  c_.sp = static_cast<std::uint16_t>(c_.sp - 1); bus_->write(c_.sp, static_cast<std::uint8_t>(v & 255));
}
std::uint16_t Z80Cpu::pop16() {
  const int lo = bus_->read(c_.sp); c_.sp = static_cast<std::uint16_t>(c_.sp + 1);
  const int hi = bus_->read(c_.sp); c_.sp = static_cast<std::uint16_t>(c_.sp + 1);
  return static_cast<std::uint16_t>(lo | (hi << 8));
}
std::uint8_t Z80Cpu::fetch() { const std::uint8_t v = bus_->read(c_.pc); c_.pc = static_cast<std::uint16_t>(c_.pc + 1); return v; }
std::uint16_t Z80Cpu::fetch16() { const int lo = fetch(); return static_cast<std::uint16_t>(lo | (fetch() << 8)); }

void Z80Cpu::set_hl_idx(int v) {
  if (c_.idx == 0) set_hl(v); else if (c_.idx == 1) c_.ix = static_cast<std::uint16_t>(v); else c_.iy = static_cast<std::uint16_t>(v);
}
std::uint16_t Z80Cpu::rp(int p) const { return p == 0 ? bc() : p == 1 ? de() : p == 2 ? get_hl() : c_.sp; }
void Z80Cpu::set_rp(int p, int v) {
  v &= 0xFFFF;
  if (p == 0) set_bc(v); else if (p == 1) set_de(v); else if (p == 2) set_hl_idx(v); else c_.sp = static_cast<std::uint16_t>(v);
}
std::uint16_t Z80Cpu::rp2(int p) const { return p == 0 ? bc() : p == 1 ? de() : p == 2 ? get_hl() : af(); }
void Z80Cpu::set_rp2(int p, int v) {
  v &= 0xFFFF;
  if (p == 0) set_bc(v); else if (p == 1) set_de(v); else if (p == 2) set_hl_idx(v); else set_af(v);
}
std::uint8_t Z80Cpu::get8(int z) const {
  if (c_.idx) {
    if (z == 4) return static_cast<std::uint8_t>((c_.idx == 1 ? c_.ix : c_.iy) >> 8);
    if (z == 5) return static_cast<std::uint8_t>((c_.idx == 1 ? c_.ix : c_.iy) & 255);
  }
  return c_.R[z];
}
void Z80Cpu::set8(int z, int v) {
  v &= 255;
  if (c_.idx && (z == 4 || z == 5)) {
    const int cur = c_.idx == 1 ? c_.ix : c_.iy, n = z == 4 ? (v << 8) | (cur & 255) : (cur & 0xFF00) | v;
    if (c_.idx == 1) c_.ix = static_cast<std::uint16_t>(n); else c_.iy = static_cast<std::uint16_t>(n);
    return;
  }
  c_.R[z] = static_cast<std::uint8_t>(v);
}

void Z80Cpu::alu(int op, int v) {
  std::uint8_t* R = c_.R; const int a = R[7]; int r;
  const auto& T = zt();
  switch (op) {
    case 0: r = a + v; SETF((r & 0xA8) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ r) & (v ^ r)) & 0x80) ? Z_P : 0) | ((r >> 8) & 1)); R[7] = static_cast<std::uint8_t>(r); return;
    case 1: { const int c = c_.f & 1; r = a + v + c; SETF((r & 0xA8) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ r) & (v ^ r)) & 0x80) ? Z_P : 0) | ((r >> 8) & 1)); R[7] = static_cast<std::uint8_t>(r); return; }
    case 2: r = a - v; SETF((r & 0xA8) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1)); R[7] = static_cast<std::uint8_t>(r); return;
    case 3: { const int c = c_.f & 1; r = a - v - c; SETF((r & 0xA8) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1)); R[7] = static_cast<std::uint8_t>(r); return; }
    case 4: r = a & v; SETF(T.szp[r] | Z_H); R[7] = static_cast<std::uint8_t>(r); return;
    case 5: r = a ^ v; SETF(T.szp[r]); R[7] = static_cast<std::uint8_t>(r); return;
    case 6: r = a | v; SETF(T.szp[r]); R[7] = static_cast<std::uint8_t>(r); return;
    default: r = a - v; SETF((r & 0x80) | (v & 0x28) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ v ^ r) & Z_H) | ((((a ^ v) & (a ^ r)) & 0x80) ? Z_P : 0) | Z_N | ((r >> 8) & 1)); return;
  }
}
std::uint8_t Z80Cpu::inc8(int v) {
  const int r = (v + 1) & 255;
  SETF((c_.f & Z_C) | (r & 0xA8) | (r == 0 ? Z_Z : 0) | ((v & 15) == 15 ? Z_H : 0) | (v == 0x7F ? Z_P : 0));
  return static_cast<std::uint8_t>(r);
}
std::uint8_t Z80Cpu::dec8(int v) {
  const int r = (v - 1) & 255;
  SETF((c_.f & Z_C) | (r & 0xA8) | (r == 0 ? Z_Z : 0) | ((v & 15) == 0 ? Z_H : 0) | (v == 0x80 ? Z_P : 0) | Z_N);
  return static_cast<std::uint8_t>(r);
}
std::uint16_t Z80Cpu::add16(int a, int b) {
  const int r = a + b;
  SETF((c_.f & (Z_S | Z_Z | Z_P)) | ((r >> 8) & (Z_Y | Z_X)) | (((a ^ b ^ r) >> 8) & Z_H) | ((r >> 16) & 1));
  return static_cast<std::uint16_t>(r & 0xFFFF);
}
void Z80Cpu::adc16(int b) {
  const int a = hl(), c = c_.f & 1, r = a + b + c;
  SETF(((r >> 8) & 0xA8) | ((r & 0xFFFF) == 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ r) & (b ^ r)) & 0x8000) ? Z_P : 0) | ((r >> 16) & 1));
  set_hl(r);
}
void Z80Cpu::sbc16(int b) {
  const int a = hl(), c = c_.f & 1, r = a - b - c;
  SETF(((r >> 8) & 0xA8) | ((r & 0xFFFF) == 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ b) & (a ^ r)) & 0x8000) ? Z_P : 0) | Z_N | ((r >> 16) & 1));
  set_hl(r);
}
void Z80Cpu::daa() {
  const int a = c_.R[7], f = c_.f; int add = 0, c = f & 1;
  if ((f & Z_H) || (a & 15) > 9) add |= 6;
  if (c || a > 0x99) { add |= 0x60; c = 1; }
  const int r = (f & Z_N) ? (a - add) & 255 : (a + add) & 255;
  const int h = (f & Z_N) ? (((f & Z_H) && (a & 15) < 6) ? Z_H : 0) : ((a & 15) > 9 ? Z_H : 0);
  SETF(zt().szp[r] | (f & Z_N) | h | c); c_.R[7] = static_cast<std::uint8_t>(r);
}
std::uint8_t Z80Cpu::rot(int y, int v) {
  int r, c;
  switch (y) {
    case 0: c = v >> 7; r = ((v << 1) | c) & 255; break;                 // RLC
    case 1: c = v & 1; r = (v >> 1) | (c << 7); break;                   // RRC
    case 2: c = v >> 7; r = ((v << 1) | (c_.f & 1)) & 255; break;        // RL
    case 3: c = v & 1; r = (v >> 1) | ((c_.f & 1) << 7); break;          // RR
    case 4: c = v >> 7; r = (v << 1) & 255; break;                       // SLA
    case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;                 // SRA
    case 6: c = v >> 7; r = ((v << 1) | 1) & 255; break;                 // SLL
    default: c = v & 1; r = v >> 1; break;                               // SRL
  }
  SETF(zt().szp[r] | c);
  return static_cast<std::uint8_t>(r);
}
bool Z80Cpu::cond(int y) const {
  const int f = c_.f;
  switch (y) {
    case 0: return !(f & Z_Z); case 1: return (f & Z_Z) != 0; case 2: return !(f & Z_C); case 3: return (f & Z_C) != 0;
    case 4: return !(f & Z_P); case 5: return (f & Z_P) != 0; case 6: return !(f & Z_S); default: return (f & Z_S) != 0;
  }
}

int Z80Cpu::step() {
  auto& c = c_;
  if (c.nmi) { c.nmi = 0; c.halted = 0; c.iff2 = c.iff1; c.iff1 = 0; inc_r(); push16(c.pc); c.pc = 0x66; return 11; }
  const bool can = !c.ei_wait; c.ei_wait = 0;
  if (can && c.iff1 && c.irq_line) {
    c.halted = 0; c.iff1 = c.iff2 = 0; inc_r();
    if (c.im == 2) { push16(c.pc); c.pc = rd16(static_cast<std::uint16_t>((c.i << 8) | 0xFF)); return 19; }
    push16(c.pc); c.pc = 0x38; return 13;
  }
  if (c.halted) { inc_r(); return 4; }
  c.idx = 0;
  int t = 0, op = fetch(); inc_r();
  while (op == 0xDD || op == 0xFD) { c.idx = op == 0xDD ? 1 : 2; t += 4; op = fetch(); inc_r(); }
  return t + exec(op);
}

int Z80Cpu::exec(int op) {
  std::uint8_t* R = c_.R; const int idx = c_.idx;
  const int x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  // endereço do operando (HL) / (IX+d) / (IY+d)
  auto mem = [&]() -> std::uint16_t {
    if (!idx) return hl();
    const int d = sx8(fetch());
    return static_cast<std::uint16_t>(((idx == 1 ? c_.ix : c_.iy) + d) & 0xFFFF);
  };
  switch (x) {
    case 0:
      switch (z) {
        case 0:
          if (y == 0) return 4;
          if (y == 1) { std::swap(R[7], c_.R2[7]); std::swap(c_.f, c_.f2); return 4; }
          if (y == 2) { const int d = sx8(fetch()); R[0] = static_cast<std::uint8_t>(R[0] - 1); if (R[0]) { c_.pc = static_cast<std::uint16_t>(c_.pc + d); return 13; } return 8; }
          if (y == 3) { const int d = sx8(fetch()); c_.pc = static_cast<std::uint16_t>(c_.pc + d); return 12; }
          { const int d = sx8(fetch()); if (cond(y - 4)) { c_.pc = static_cast<std::uint16_t>(c_.pc + d); return 12; } return 7; }
        case 1:
          if (!q) { set_rp(p, fetch16()); return 10; }
          { const int v = add16(get_hl(), rp(p)); set_hl_idx(v); return 11; }
        case 2:
          if (!q) {
            if (p == 0) { bus_->write(bc(), R[7]); return 7; }
            if (p == 1) { bus_->write(de(), R[7]); return 7; }
            if (p == 2) { const std::uint16_t a = fetch16(); wr16(a, get_hl()); return 16; }
            { const std::uint16_t a = fetch16(); bus_->write(a, R[7]); return 13; }
          }
          if (p == 0) { R[7] = bus_->read(bc()); return 7; }
          if (p == 1) { R[7] = bus_->read(de()); return 7; }
          if (p == 2) { const std::uint16_t a = fetch16(); set_hl_idx(rd16(a)); return 16; }
          { const std::uint16_t a = fetch16(); R[7] = bus_->read(a); return 13; }
        case 3: set_rp(p, rp(p) + (q ? -1 : 1)); return 6;
        case 4: case 5: {
          const bool inc = z == 4;
          if (y == 6) { const std::uint16_t a = mem(); const int v = bus_->read(a); bus_->write(a, inc ? inc8(v) : dec8(v)); return idx ? 23 - 4 : 11; }
          set8(y, inc ? inc8(get8(y)) : dec8(get8(y))); return 4;
        }
        case 6:
          if (y == 6) {
            if (idx) { const std::uint16_t a = mem(); bus_->write(a, fetch()); return 15; }
            bus_->write(hl(), fetch()); return 10;
          }
          set8(y, fetch()); return 7;
        default:
          switch (y) {
            case 0: { const int a = R[7], c = a >> 7; R[7] = static_cast<std::uint8_t>(((a << 1) | c) & 255); SETF((c_.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c); return 4; }
            case 1: { const int a = R[7], c = a & 1; R[7] = static_cast<std::uint8_t>((a >> 1) | (c << 7)); SETF((c_.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c); return 4; }
            case 2: { const int a = R[7], c = a >> 7; R[7] = static_cast<std::uint8_t>(((a << 1) | (c_.f & 1)) & 255); SETF((c_.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c); return 4; }
            case 3: { const int a = R[7], c = a & 1; R[7] = static_cast<std::uint8_t>((a >> 1) | ((c_.f & 1) << 7)); SETF((c_.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | c); return 4; }
            case 4: daa(); return 4;
            case 5: R[7] ^= 255; SETF((c_.f & (Z_S | Z_Z | Z_P | Z_C)) | Z_H | Z_N | (R[7] & 0x28)); return 4;
            case 6: SETF((c_.f & (Z_S | Z_Z | Z_P)) | (R[7] & 0x28) | Z_C); return 4;
            default: SETF((c_.f & (Z_S | Z_Z | Z_P)) | ((c_.f & 1) ? Z_H : 0) | (R[7] & 0x28) | ((c_.f & 1) ^ 1)); return 4;
          }
      }
    case 1:
      if (y == 6 && z == 6) { c_.halted = 1; return 4; }
      if (y == 6) { const std::uint16_t a = mem(); bus_->write(a, R[z]); return idx ? 15 : 7; }
      if (z == 6) { const std::uint16_t a = mem(); R[y] = bus_->read(a); return idx ? 15 : 7; }
      set8(y, get8(z)); return 4;
    case 2:
      if (z == 6) { const std::uint16_t a = mem(); alu(y, bus_->read(a)); return idx ? 15 : 7; }
      alu(y, get8(z)); return 4;
    default:
      switch (z) {
        case 0: if (cond(y)) { c_.pc = pop16(); return 11; } return 5;
        case 1:
          if (!q) { set_rp2(p, pop16()); return 10; }
          if (p == 0) { c_.pc = pop16(); return 10; }
          if (p == 1) { for (int i = 0; i < 6; i++) std::swap(R[i], c_.R2[i]); return 4; }
          if (p == 2) { c_.pc = get_hl(); return 4; }
          c_.sp = get_hl(); return 6;
        case 2: { const std::uint16_t a = fetch16(); if (cond(y)) c_.pc = a; return 10; }
        case 3:
          switch (y) {
            case 0: c_.pc = fetch16(); return 10;
            case 1: return cb();
            case 2: { const int n = fetch(); bus_->port_out(n | (R[7] << 8), R[7]); return 11; }
            case 3: { const int n = fetch(); R[7] = bus_->port_in(n | (R[7] << 8)); return 11; }
            case 4: { const std::uint16_t v = rd16(c_.sp); wr16(c_.sp, get_hl()); set_hl_idx(v); return 19; }
            case 5: { const std::uint16_t d = de(), h = hl(); set_de(h); set_hl(d); return 4; }
            case 6: c_.iff1 = c_.iff2 = 0; return 4;
            default: c_.iff1 = c_.iff2 = 1; c_.ei_wait = 1; return 4;
          }
        case 4: { const std::uint16_t a = fetch16(); if (cond(y)) { push16(c_.pc); c_.pc = a; return 17; } return 10; }
        case 5:
          if (!q) { push16(rp2(p)); return 11; }
          if (p == 0) { const std::uint16_t a = fetch16(); push16(c_.pc); c_.pc = a; return 17; }
          if (p == 2) return ed();
          return 4;   // DD/FD repetido já tratado em step()
        case 6: alu(y, fetch()); return 7;
        default: push16(c_.pc); c_.pc = static_cast<std::uint16_t>(y << 3); return 11;
      }
  }
}

/* prefixo CB (e DDCB/FDCB) */
int Z80Cpu::cb() {
  std::uint8_t* R = c_.R; const int idx = c_.idx;
  int a = 0, op;
  if (idx) { const int d = sx8(fetch()); a = ((idx == 1 ? c_.ix : c_.iy) + d) & 0xFFFF; op = fetch(); }   // R não incrementa no 2º opcode
  else { op = fetch(); inc_r(); }
  const int x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const bool memop = idx || z == 6;
  if (!idx && z == 6) a = hl();
  const int v = memop ? bus_->read(static_cast<std::uint16_t>(a)) : R[z];
  if (x == 1) {
    const int m = v & (1 << y);
    SETF((c_.f & Z_C) | Z_H | (m ? 0 : (Z_Z | Z_P)) | (y == 7 && m ? Z_S : 0) | (memop ? ((a >> 8) & 0x28) : (v & 0x28)));
    return idx ? 16 : z == 6 ? 12 : 8;
  }
  int r;
  if (x == 0) r = rot(y, v); else if (x == 2) r = v & ~(1 << y); else r = v | (1 << y);
  if (memop) { bus_->write(static_cast<std::uint16_t>(a), static_cast<std::uint8_t>(r)); if (idx && z != 6) R[z] = static_cast<std::uint8_t>(r); return idx ? 19 : 15; }
  R[z] = static_cast<std::uint8_t>(r); return 8;
}

/* prefixo ED */
int Z80Cpu::ed() {
  std::uint8_t* R = c_.R;
  c_.idx = 0;
  const int op = fetch(); inc_r();
  const int x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  const auto& T = zt();
  if (x == 1) {
    switch (z) {
      case 0: { const std::uint8_t v = bus_->port_in(bc()); SETF((c_.f & Z_C) | T.szp[v]); if (y != 6) R[y] = v; return 12; }
      case 1: bus_->port_out(bc(), y == 6 ? 0 : R[y]); return 12;
      case 2: if (q) adc16(rp(p)); else sbc16(rp(p)); return 15;
      case 3: if (q) set_rp(p, rd16(fetch16())); else { const std::uint16_t a = fetch16(); wr16(a, rp(p)); } return 20;
      case 4: { const int a = R[7], r = 0 - a; SETF((r & 0xA8) | ((r & 255) == 0 ? Z_Z : 0) | ((a ^ r) & Z_H) | (a == 0x80 ? Z_P : 0) | Z_N | (a != 0 ? Z_C : 0)); R[7] = static_cast<std::uint8_t>(r & 255); return 8; }
      case 5: c_.pc = pop16(); c_.iff1 = c_.iff2; return 14;
      case 6: { static const int im[8] = {0, 0, 1, 2, 0, 0, 1, 2}; c_.im = static_cast<std::uint8_t>(im[y]); return 8; }
      default:
        switch (y) {
          case 0: c_.i = R[7]; return 9;
          case 1: c_.r = R[7]; return 9;
          case 2: R[7] = c_.i; SETF((c_.f & Z_C) | (T.szp[R[7]] & ~Z_P) | (c_.iff2 ? Z_P : 0)); return 9;
          case 3: R[7] = c_.r; SETF((c_.f & Z_C) | (T.szp[R[7]] & ~Z_P) | (c_.iff2 ? Z_P : 0)); return 9;
          case 4: { const int a = bus_->read(hl()), n = R[7]; bus_->write(hl(), static_cast<std::uint8_t>(((n & 15) << 4) | (a >> 4))); R[7] = static_cast<std::uint8_t>((n & 0xF0) | (a & 15)); SETF((c_.f & Z_C) | T.szp[R[7]]); return 18; }
          case 5: { const int a = bus_->read(hl()), n = R[7]; bus_->write(hl(), static_cast<std::uint8_t>(((a << 4) | (n & 15)) & 255)); R[7] = static_cast<std::uint8_t>((n & 0xF0) | (a >> 4)); SETF((c_.f & Z_C) | T.szp[R[7]]); return 18; }
          default: return 8;
        }
    }
  }
  if (x == 2 && y >= 4 && z < 4) return block(y, z);
  return 8;
}

int Z80Cpu::block(int y, int z) {
  std::uint8_t* R = c_.R; const bool dec = (y & 1) == 1, rep = y >= 6; const int d = dec ? -1 : 1;
  const auto& T = zt();
  switch (z) {
    case 0: {   // LDI/LDD/LDIR/LDDR
      const int v = bus_->read(hl()); bus_->write(de(), static_cast<std::uint8_t>(v));
      set_hl(hl() + d); set_de(de() + d); set_bc((bc() - 1) & 0xFFFF);
      const int n = (v + R[7]) & 255;
      SETF((c_.f & (Z_S | Z_Z | Z_C)) | ((n & 2) ? Z_Y : 0) | (n & 8) | (bc() ? Z_P : 0));
      if (rep && bc()) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    case 1: {   // CPI/CPD/CPIR/CPDR
      const int v = bus_->read(hl()), a = R[7], r = (a - v) & 255, h = ((a ^ v ^ r) & Z_H) ? 1 : 0;
      set_hl(hl() + d); set_bc((bc() - 1) & 0xFFFF);
      const int n = (r - h) & 255;
      SETF((c_.f & Z_C) | (r & Z_S) | (r == 0 ? Z_Z : 0) | (h ? Z_H : 0) | ((n & 2) ? Z_Y : 0) | (n & 8) | (bc() ? Z_P : 0) | Z_N);
      if (rep && bc() && r != 0) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    case 2: {   // INI/IND/INIR/INDR
      const int v = bus_->port_in(bc()); bus_->write(hl(), static_cast<std::uint8_t>(v));
      R[0] = static_cast<std::uint8_t>(R[0] - 1); set_hl(hl() + d);
      const int k = v + ((R[1] + d) & 255);
      SETF((R[0] & 0xA8) | (R[0] == 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? (Z_H | Z_C) : 0) | T.par[((k & 7) ^ R[0]) & 255]);
      if (rep && R[0]) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    default: {  // OUTI/OUTD/OTIR/OTDR
      const int v = bus_->read(hl()); R[0] = static_cast<std::uint8_t>(R[0] - 1); bus_->port_out(bc(), v); set_hl(hl() + d);
      const int k = v + R[5];
      SETF((R[0] & 0xA8) | (R[0] == 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? (Z_H | Z_C) : 0) | T.par[((k & 7) ^ R[0]) & 255]);
      if (rep && R[0]) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
  }
}

/* ====================================================================== vdp.js */

}  // namespace emuhub
