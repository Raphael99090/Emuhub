// CPU Motorola 68000 (porte de hub/src/cores/neogeo/m68k.js).
#include "m68k.h"
#include <cstdlib>

namespace emuhub {

namespace {
typedef std::int32_t i32;
typedef std::uint32_t u32;
const u32 kMsb[3] = {0x80, 0x8000, 0x80000000u};
const u32 kMask[3] = {0xFF, 0xFFFF, 0xFFFFFFFFu};
// custo por modo (índice: modo 0-6, 7.0=7, 7.1=8, 7.2=9, 7.3=10, 7.4=11), [byte/word, long]
const int kEac[2][12] = {{0, 0, 4, 4, 6, 8, 10, 8, 12, 8, 10, 4}, {0, 0, 8, 8, 10, 12, 14, 12, 16, 12, 14, 8}};
inline i32 sg(std::int64_t v, int s) {
  const u32 u = static_cast<u32>(static_cast<std::uint64_t>(v));
  return s == 0 ? static_cast<i32>(static_cast<std::int8_t>(u)) : s == 1 ? static_cast<i32>(static_cast<std::int16_t>(u)) : static_cast<i32>(u);
}
inline i32 A(i32 a, i32 b) { return static_cast<i32>(static_cast<u32>(a) + static_cast<u32>(b)); }
inline i32 S_(i32 a, i32 b) { return static_cast<i32>(static_cast<u32>(a) - static_cast<u32>(b)); }
inline i32 shl(i32 x, int n) { return static_cast<i32>(static_cast<u32>(x) << n); }
inline i32 mask_lo(i32 d, int s, i32 r) {   // mantém os bits altos de d e troca a parte do tamanho
  return s == 0 ? static_cast<i32>((static_cast<u32>(d) & ~0xFFu) | (static_cast<u32>(r) & 0xFF))
       : s == 1 ? static_cast<i32>((static_cast<u32>(d) & ~0xFFFFu) | (static_cast<u32>(r) & 0xFFFF)) : r;
}
}  // namespace

void M68k::reset() {
  State& s = s_;
  s.sr = 0x2700; s.x = s.n = s.z = s.v = s.c = 0; s.stopped = 0; s.irq = 0; s.usp = 0;
  for (int i = 0; i < 8; i++) { s.d[i] = 0; s.a[i] = 0; }
  s.a[7] = static_cast<i32>((r16(0) << 16) | r16(2));
  s.pc = static_cast<i32>((r16(4) << 16) | r16(6));
}

i32 M68k::rd(u32 a, int s) {
  a &= 0xFFFFFF;
  if (s == 0) return sg(bus_->r8(a), 0);
  if (s == 1) return sg(bus_->r16(a & 0xFFFFFE), 1);
  return static_cast<i32>((bus_->r16(a & 0xFFFFFE) << 16) | bus_->r16((a + 2) & 0xFFFFFE));
}
void M68k::wr(u32 a, int s, i32 v) {
  a &= 0xFFFFFF;
  const u32 u = static_cast<u32>(v);
  if (s == 0) bus_->w8(a, u & 255);
  else if (s == 1) bus_->w16(a & 0xFFFFFE, u & 0xFFFF);
  else { bus_->w16(a & 0xFFFFFE, (u >> 16) & 0xFFFF); bus_->w16((a + 2) & 0xFFFFFE, u & 0xFFFF); }
}
u32 M68k::fetch() { const u32 v = bus_->r16(static_cast<u32>(s_.pc) & 0xFFFFFE); s_.pc = A(s_.pc, 2); return v; }
i32 M68k::fetch_s() { return sg(fetch(), 1); }
i32 M68k::fetch32() { const u32 h = fetch(); return static_cast<i32>((h << 16) | fetch()); }
void M68k::push16(i32 v) { s_.a[7] = S_(s_.a[7], 2); wr(static_cast<u32>(s_.a[7]), 1, v); }
void M68k::push32(i32 v) { s_.a[7] = S_(s_.a[7], 4); wr(static_cast<u32>(s_.a[7]), 2, v); }
i32 M68k::pop16() { const i32 v = rd(static_cast<u32>(s_.a[7]), 1); s_.a[7] = A(s_.a[7], 2); return v & 0xFFFF; }
i32 M68k::pop32() { const i32 v = rd(static_cast<u32>(s_.a[7]), 2); s_.a[7] = A(s_.a[7], 4); return v; }

u32 M68k::get_sr() const { return (s_.sr & 0xA700) | (s_.x << 4) | (s_.n << 3) | (s_.z << 2) | (s_.v << 1) | s_.c; }
void M68k::set_sr(u32 v) {
  const u32 was = s_.sr & 0x2000;
  s_.sr = v & 0xA700;
  s_.x = (v >> 4) & 1; s_.n = (v >> 3) & 1; s_.z = (v >> 2) & 1; s_.v = (v >> 1) & 1; s_.c = v & 1;
  if (was != (s_.sr & 0x2000)) { const i32 t = s_.a[7]; s_.a[7] = s_.usp; s_.usp = t; }
}
void M68k::set_ccr(u32 v) { s_.x = (v >> 4) & 1; s_.n = (v >> 3) & 1; s_.z = (v >> 2) & 1; s_.v = (v >> 1) & 1; s_.c = v & 1; }

void M68k::exception(int vec, i32 pc_save) {
  const u32 old = get_sr();
  if (!(s_.sr & 0x2000)) { s_.sr |= 0x2000; const i32 t = s_.a[7]; s_.a[7] = s_.usp; s_.usp = t; }
  s_.sr &= ~0x8000u;   // sem trace
  push32(pc_save); push16(static_cast<i32>(old));
  s_.pc = static_cast<i32>((r16(vec * 4) << 16) | r16(vec * 4 + 2)); s_.stopped = 0; cyc_ += 34;
}

bool M68k::cond(int c) const {
  const State& s = s_;
  switch (c) {
    case 0: return true; case 1: return false;
    case 2: return !s.c && !s.z; case 3: return (s.c | s.z) != 0;
    case 4: return !s.c; case 5: return s.c != 0; case 6: return !s.z; case 7: return s.z != 0;
    case 8: return !s.v; case 9: return s.v != 0; case 10: return !s.n; case 11: return s.n != 0;
    case 12: return s.n == s.v; case 13: return s.n != s.v;
    case 14: return !s.z && s.n == s.v; default: return s.z != 0 || s.n != s.v;
  }
}

/* ---- endereçamento efetivo ---- */
void M68k::ea(int mode, int reg, int s) {
  i32* a = s_.a;
  switch (mode) {
    case 0: ea_t_ = 1; ea_a_ = reg; break;
    case 1: ea_t_ = 2; ea_a_ = reg; break;
    case 2: ea_t_ = 0; ea_a_ = a[reg]; break;
    case 3: ea_t_ = 0; ea_a_ = a[reg]; a[reg] = A(a[reg], (s == 0 && reg == 7) ? 2 : (1 << s)); break;
    case 4: a[reg] = S_(a[reg], (s == 0 && reg == 7) ? 2 : (1 << s)); ea_t_ = 0; ea_a_ = a[reg]; break;
    case 5: { ea_t_ = 0; const i32 b = a[reg]; ea_a_ = A(b, fetch_s()); break; }
    case 6: { ea_t_ = 0; const i32 b = a[reg]; ea_a_ = A(b, index()); break; }
    default:
      ea_t_ = 0;
      if (reg == 0) ea_a_ = fetch_s();
      else if (reg == 1) ea_a_ = fetch32();
      else if (reg == 2) { const i32 b = s_.pc; ea_a_ = A(b, fetch_s()); }
      else if (reg == 3) { const i32 b = s_.pc; ea_a_ = A(b, index()); }
      else if (reg == 4) { ea_t_ = 3; ea_v_ = s == 2 ? fetch32() : s == 1 ? fetch_s() : sg(fetch(), 0); }
      else throw Illegal{};
  }
  cyc_ += kEac[s == 2 ? 1 : 0][mode < 7 ? mode : 7 + reg];
}
i32 M68k::index() {
  const u32 e = fetch();
  const int r = (e >> 12) & 7;
  const i32 v = (e & 0x8000) ? s_.a[r] : s_.d[r];
  return A(sg(e, 0), (e & 0x800) ? v : sg(v, 1));
}
i32 M68k::read_ea(int s) {
  switch (ea_t_) {
    case 1: return sg(s_.d[ea_a_], s);
    case 2: return sg(s_.a[ea_a_], s);
    case 3: return ea_v_;
    default: return rd(static_cast<u32>(ea_a_), s);
  }
}
void M68k::write_ea(int s, i32 v) {
  if (ea_t_ == 1) { const int i = ea_a_; s_.d[i] = mask_lo(s_.d[i], s, v); }
  else if (ea_t_ == 2) s_.a[ea_a_] = v;
  else wr(static_cast<u32>(ea_a_), s, v);
}

/* ---- aritmética com flags ---- */
i32 M68k::add(i32 S, i32 D, int s, u32 cx, bool xz) {
  const u32 m = kMask[s], u = static_cast<u32>(S) & m, w = static_cast<u32>(D) & m;
  const std::uint64_t r = static_cast<std::uint64_t>(u) + w + cx;
  const i32 res = sg(static_cast<std::int64_t>(r), s);
  const u32 r32 = static_cast<u32>(r);
  s_.c = s_.x = r > m ? 1 : 0;
  s_.v = ((u ^ r32) & (w ^ r32) & kMsb[s]) ? 1 : 0;
  s_.n = res < 0 ? 1 : 0;
  if (xz) { if (res != 0) s_.z = 0; } else s_.z = res == 0 ? 1 : 0;
  return res;
}
i32 M68k::sub(i32 S, i32 D, int s, u32 cx, bool xz, bool no_x) {
  const u32 m = kMask[s], u = static_cast<u32>(S) & m, w = static_cast<u32>(D) & m;
  const std::int64_t r = static_cast<std::int64_t>(w) - u - cx;
  const i32 res = sg(r, s);
  const u32 r32 = static_cast<u32>(static_cast<std::uint64_t>(r));
  s_.c = (static_cast<std::uint64_t>(u) + cx) > w ? 1 : 0;
  if (!no_x) s_.x = s_.c;
  s_.v = ((u ^ w) & (w ^ r32) & kMsb[s]) ? 1 : 0;
  s_.n = res < 0 ? 1 : 0;
  if (xz) { if (res != 0) s_.z = 0; } else s_.z = res == 0 ? 1 : 0;
  return res;
}
i32 M68k::logic(i32 r, int s) { r = sg(r, s); s_.n = r < 0 ? 1 : 0; s_.z = r == 0 ? 1 : 0; s_.v = 0; s_.c = 0; return r; }

i32 M68k::shift(int type, bool left, i32 val, int cnt, int s) {
  const int bits = 8 << s;
  const std::uint64_t m = kMask[s];
  std::uint64_t v = static_cast<std::uint32_t>(val) & m;
  u32 c = 0, vf = 0, x = s_.x;
  if (cnt == 0) {
    s_.c = type == 2 ? s_.x : 0; s_.v = 0;
    const i32 r0 = sg(static_cast<std::int64_t>(v), s); s_.n = r0 < 0 ? 1 : 0; s_.z = r0 == 0 ? 1 : 0; return r0;
  }
  const std::uint64_t msb = 1ull << (bits - 1), full = msb * 2;
  for (int i = 0; i < cnt; i++) {
    if (left) {
      c = (v & msb) ? 1 : 0;
      if (type == 0) { const std::uint64_t nm = (v * 2) % full; if (((nm & msb) ? 1u : 0u) != c) vf = 1; v = nm; }
      else if (type == 1) v = (v * 2) % full;
      else if (type == 2) { v = ((v * 2) % full) + x; x = c; }
      else v = ((v * 2) % full) + c;
    } else {
      c = static_cast<u32>(v & 1);
      if (type == 0) v = (v / 2) + (v & msb);
      else if (type == 1) v = v / 2;
      else if (type == 2) { v = (v / 2) + (x ? msb : 0); x = c; }
      else v = (v / 2) + (c ? msb : 0);
    }
  }
  s_.c = c;
  if (type != 3) s_.x = type == 2 ? x : c;
  s_.v = type == 0 ? vf : 0;
  const i32 r = sg(static_cast<std::int64_t>(v), s);
  s_.n = r < 0 ? 1 : 0; s_.z = r == 0 ? 1 : 0;
  return r;
}

/* ---- execução ---- */
int M68k::step() {
  State& s = s_;
  cyc_ = 0;
  if (s.irq > 0 && (s.irq > ((s.sr >> 8) & 7) || s.irq == 7)) {
    const u32 lv = s.irq, old = get_sr();
    if (!(s.sr & 0x2000)) { s.sr |= 0x2000; const i32 t = s.a[7]; s.a[7] = s.usp; s.usp = t; }
    s.sr = (s.sr & ~0x8700u) | (lv << 8);
    push32(s.pc); push16(static_cast<i32>(old));
    const int vec = 24 + static_cast<int>(lv);
    s.pc = static_cast<i32>((r16(vec * 4) << 16) | r16(vec * 4 + 2)); s.stopped = 0; return 44;
  }
  if (s.stopped) return 4;
  const i32 start = s.pc;
  const u32 op = fetch();
  try { exec(op); } catch (const Illegal&) { s.pc = start; exception(4, start); }
  return cyc_ + 4;
}

void M68k::exec(u32 op) {
  i32* d = s_.d; i32* a = s_.a;
  const int rx = (op >> 9) & 7, ry = op & 7, mode = (op >> 3) & 7, sz = (op >> 6) & 3;
  switch (op >> 12) {
    case 0: g0(op, rx, ry, mode, sz); return;
    case 1: case 2: case 3: {
      const int s = (op >> 12) == 1 ? 0 : (op >> 12) == 3 ? 1 : 2, dm = (op >> 6) & 7;
      ea(mode, ry, s); const i32 v = read_ea(s);
      if (dm == 1) { a[rx] = sg(v, s); return; }
      ea(dm, rx, s); write_ea(s, v); logic(v, s); return;
    }
    case 4: g4(op, rx, ry, mode, sz); return;
    case 5: {
      if (sz == 3) {
        const int cc = (op >> 8) & 15;
        if (mode == 1) {   // DBcc
          const i32 base = s_.pc, disp = fetch_s();
          if (!cond(cc)) {
            const u32 w = ((static_cast<u32>(d[ry]) & 0xFFFF) - 1) & 0xFFFF;
            d[ry] = static_cast<i32>((static_cast<u32>(d[ry]) & ~0xFFFFu) | w);
            if (w != 0xFFFF) { s_.pc = A(base, disp); cyc_ += 2; } else cyc_ += 6;
          } else cyc_ += 4;
        } else { ea(mode, ry, 0); const bool t = cond(cc); write_ea(0, t ? -1 : 0); cyc_ += t ? 2 : 0; }
        return;
      }
      const int q = rx ? rx : 8; ea(mode, ry, sz);
      if (ea_t_ == 2) { a[ea_a_] = A(a[ea_a_], (op & 0x100) ? -q : q); cyc_ += 4; return; }
      const i32 v = read_ea(sz);
      write_ea(sz, (op & 0x100) ? sub(q, v, sz, 0, false) : add(q, v, sz, 0, false));
      if (sz == 2 && ea_t_ == 1) cyc_ += 4;
      return;
    }
    case 6: {
      const i32 base = s_.pc;
      i32 disp = op & 0xFF;
      if (disp == 0) disp = fetch_s(); else disp = sg(disp, 0);
      const int cc = (op >> 8) & 15;
      if (cc == 1) { push32(s_.pc); s_.pc = A(base, disp); cyc_ += 14; return; }
      if (cond(cc)) { s_.pc = A(base, disp); cyc_ += 2; } else cyc_ += (op & 0xFF) == 0 ? 4 : 0;
      return;
    }
    case 7: { const i32 v = sg(op, 0); d[rx] = v; logic(v, 2); return; }
    case 8: case 12: g8c(op, rx, ry, mode, sz); return;
    case 9: case 13: {
      const bool sb = (op >> 12) == 9;
      if (sz == 3) { const int s = (op & 0x100) ? 2 : 1; ea(mode, ry, s); const i32 v = read_ea(s); a[rx] = sb ? S_(a[rx], v) : A(a[rx], v); cyc_ += 4; return; }
      if ((op & 0x130) == 0x100) {   // ADDX/SUBX
        if (op & 8) {
          ea(4, ry, sz); const i32 sv = rd(static_cast<u32>(ea_a_), sz); ea(4, rx, sz); const i32 dv = rd(static_cast<u32>(ea_a_), sz);
          wr(static_cast<u32>(ea_a_), sz, sb ? sub(sv, dv, sz, s_.x, true) : add(sv, dv, sz, s_.x, true));
        } else {
          const i32 sv = sg(d[ry], sz), dv = sg(d[rx], sz), r = sb ? sub(sv, dv, sz, s_.x, true) : add(sv, dv, sz, s_.x, true);
          d[rx] = mask_lo(d[rx], sz, r);
        }
        return;
      }
      ea(mode, ry, sz);
      if (op & 0x100) {
        const i32 dv = read_ea(sz), sv = sg(d[rx], sz);
        write_ea(sz, sb ? sub(sv, dv, sz, 0, false) : add(sv, dv, sz, 0, false));
      } else {
        const i32 sv = read_ea(sz), dv = sg(d[rx], sz), r = sb ? sub(sv, dv, sz, 0, false) : add(sv, dv, sz, 0, false);
        d[rx] = mask_lo(d[rx], sz, r);
        if (sz == 2) cyc_ += 4;
      }
      return;
    }
    case 10: s_.pc = S_(s_.pc, 2); exception(10, s_.pc); return;
    case 11: {
      if (sz == 3) { const int s = (op & 0x100) ? 2 : 1; ea(mode, ry, s); const i32 v = read_ea(s); sub(v, a[rx], 2, 0, false, true); return; }
      if (!(op & 0x100)) { ea(mode, ry, sz); sub(read_ea(sz), sg(d[rx], sz), sz, 0, false, true); return; }
      if (mode == 1) { ea(3, ry, sz); const i32 sv = rd(static_cast<u32>(ea_a_), sz); ea(3, rx, sz); const i32 dv = rd(static_cast<u32>(ea_a_), sz); sub(sv, dv, sz, 0, false, true); return; }
      ea(mode, ry, sz); const i32 dv = read_ea(sz); write_ea(sz, logic(dv ^ d[rx], sz)); return;
    }
    case 14: {
      if (sz == 3) {   // deslocamento de memória (1 posição)
        ea(mode, ry, 1); const i32 v = read_ea(1); write_ea(1, shift((op >> 9) & 3, (op & 0x100) != 0, v, 1, 1)); return;
      }
      const int type = (op >> 3) & 3, cnt = (op & 0x20) ? (d[rx] & 63) : (rx ? rx : 8);
      const i32 r = shift(type, (op & 0x100) != 0, d[ry], cnt, sz);
      d[ry] = mask_lo(d[ry], sz, r); cyc_ += 2 * cnt + (sz == 2 ? 4 : 0); return;
    }
    default: s_.pc = S_(s_.pc, 2); exception(11, s_.pc); return;
  }
}

/* grupo 0: imediatos e operações de bit */
void M68k::g0(u32 op, int rx, int ry, int mode, int sz) {
  i32* d = s_.d;
  if ((op & 0x138) == 0x108) {   // MOVEP
    const i32 disp = fetch_s(), addr = A(s_.a[ry], disp);
    const int dir = (op >> 6) & 3;
    if (dir == 0 || dir == 1) {
      const int n = dir == 0 ? 2 : 4; i32 v = 0;
      for (int i = 0; i < n; i++) v = shl(v, 8) | static_cast<i32>(bus_->r8((static_cast<u32>(addr) + i * 2) & 0xFFFFFF) & 255);
      d[rx] = dir == 0 ? static_cast<i32>((static_cast<u32>(d[rx]) & ~0xFFFFu) | (static_cast<u32>(v) & 0xFFFF)) : v;
    } else {
      const int n = dir == 2 ? 2 : 4; const i32 v = d[rx];
      for (int i = 0; i < n; i++) bus_->w8((static_cast<u32>(addr) + i * 2) & 0xFFFFFF, (static_cast<u32>(v) >> (8 * (n - 1 - i))) & 255);
    }
    cyc_ += 12; return;
  }
  if ((op & 0x100) || (op & 0xF00) == 0x800) {   // BTST/BCHG/BCLR/BSET
    const bool imm = !(op & 0x100); const int t = (op >> 6) & 3;
    i32 bit;
    if (imm) bit = static_cast<i32>(fetch() & 255); else bit = d[rx];
    if (mode == 0) {
      bit &= 31; const i32 v = d[ry];
      s_.z = (static_cast<u32>(v) >> bit) & 1 ? 0 : 1;
      if (t == 1) d[ry] = v ^ shl(1, bit); else if (t == 2) d[ry] = v & ~shl(1, bit); else if (t == 3) d[ry] = v | shl(1, bit);
      cyc_ += t ? 4 : 2;
    } else {
      bit &= 7; ea(mode, ry, 0); const i32 v = read_ea(0) & 255;
      s_.z = (v >> bit) & 1 ? 0 : 1;
      if (t) write_ea(0, t == 1 ? v ^ (1 << bit) : t == 2 ? v & ~(1 << bit) : v | (1 << bit));
    }
    return;
  }
  const int k = (op >> 9) & 7;   // 0 ORI, 1 ANDI, 2 SUBI, 3 ADDI, 5 EORI, 6 CMPI
  if (sz == 3 || k == 4 || k == 7) throw Illegal{};
  if (mode == 7 && ry == 4 && (k == 0 || k == 1 || k == 5)) {   // para CCR / SR
    const u32 imm = fetch();
    if (sz == 0) { const u32 c = get_sr() & 0xFF, n = k == 0 ? c | imm : k == 1 ? c & imm : c ^ imm; set_ccr(n); }
    else if (sz == 1) {
      if (!(s_.sr & 0x2000)) { s_.pc = S_(s_.pc, 2); exception(8, S_(s_.pc, 2)); return; }
      const u32 c = get_sr(), n = k == 0 ? c | imm : k == 1 ? c & imm : c ^ imm; set_sr(n);
    } else throw Illegal{};
    cyc_ += 16; return;
  }
  const i32 imm = sz == 2 ? fetch32() : sz == 1 ? fetch_s() : sg(fetch(), 0);
  ea(mode, ry, sz); const i32 v = read_ea(sz);
  switch (k) {
    case 0: write_ea(sz, logic(v | imm, sz)); break;
    case 1: write_ea(sz, logic(v & imm, sz)); break;
    case 2: write_ea(sz, sub(imm, v, sz, 0, false)); break;
    case 3: write_ea(sz, add(imm, v, sz, 0, false)); break;
    case 5: write_ea(sz, logic(v ^ imm, sz)); break;
    case 6: sub(imm, v, sz, 0, false, true); break;
    default: break;
  }
  if (ea_t_ == 1 && sz == 2) cyc_ += 4;
}

/* grupo 4: miscelâneas */
void M68k::g4(u32 op, int rx, int ry, int mode, int sz) {
  i32* d = s_.d; i32* a = s_.a;
  if ((op & 0xF1C0) == 0x41C0) { ea(mode, ry, 2); a[rx] = ea_a_; return; }   // LEA
  if ((op & 0xF1C0) == 0x4180) {   // CHK
    ea(mode, ry, 1); const i32 b = read_ea(1), v = sg(d[rx], 1);
    if (v < 0) { s_.n = 1; exception(6, s_.pc); } else if (v > b) { s_.n = 0; exception(6, s_.pc); }
    return;
  }
  if ((op & 0xFB80) == 0x4880 && mode != 0) { movem(op, ry, mode); return; }   // MOVEM
  switch (op & 0xFFC0) {
    case 0x40C0: ea(mode, ry, 1); write_ea(1, static_cast<i32>(get_sr())); return;   // MOVE from SR
    case 0x44C0: ea(mode, ry, 1); set_ccr(static_cast<u32>(read_ea(1))); return;
    case 0x46C0: if (!(s_.sr & 0x2000)) { exception(8, S_(s_.pc, 2)); return; } ea(mode, ry, 1); set_sr(static_cast<u32>(read_ea(1))); return;
    case 0x4800: {   // NBCD
      ea(mode, ry, 0); const i32 v = read_ea(0) & 255;
      i32 lo = -(v & 15) - static_cast<i32>(s_.x), hi = -(v >> 4), c = 0;
      if (lo < 0) { lo += 10; hi--; }
      if (hi < 0) { hi += 10; c = 1; }
      const i32 r = ((hi & 15) << 4) | lo;
      s_.c = s_.x = static_cast<u32>(c); if (r) s_.z = 0;
      write_ea(0, r); return;
    }
    case 0x4840:   // SWAP / PEA
      if (mode == 0) { const u32 v = static_cast<u32>(d[ry]); d[ry] = static_cast<i32>((v << 16) | (v >> 16)); logic(d[ry], 2); }
      else { ea(mode, ry, 2); push32(ea_a_); }
      return;
    case 0x4AC0: { ea(mode, ry, 0); const i32 v = read_ea(0); logic(v, 0); write_ea(0, v | 0x80); return; }   // TAS
    case 0x4E80: ea(mode, ry, 2); push32(s_.pc); s_.pc = ea_a_; cyc_ += 8; return;   // JSR
    case 0x4EC0: ea(mode, ry, 2); s_.pc = ea_a_; cyc_ += 4; return;   // JMP
    default: break;
  }
  if ((op & 0xFFF8) == 0x4880) { const i32 v = sg(d[ry], 0); d[ry] = static_cast<i32>((static_cast<u32>(d[ry]) & ~0xFFFFu) | (static_cast<u32>(v) & 0xFFFF)); logic(v, 1); return; }   // EXT.W
  if ((op & 0xFFF8) == 0x48C0) { d[ry] = sg(d[ry], 1); logic(d[ry], 2); return; }   // EXT.L
  if ((op & 0xFFF0) == 0x4E40) { exception(32 + (op & 15), s_.pc); return; }   // TRAP
  if ((op & 0xFFF8) == 0x4E50) { const i32 disp = fetch_s(); push32(a[ry]); a[ry] = a[7]; a[7] = A(a[7], disp); return; }   // LINK
  if ((op & 0xFFF8) == 0x4E58) { a[7] = a[ry]; a[ry] = pop32(); return; }   // UNLK
  if ((op & 0xFFF0) == 0x4E60) {
    if (!(s_.sr & 0x2000)) { exception(8, S_(s_.pc, 2)); return; }
    if (op & 8) a[ry] = s_.usp; else s_.usp = a[ry];
    return;
  }
  switch (op) {
    case 0x4E70: if (!(s_.sr & 0x2000)) exception(8, S_(s_.pc, 2)); cyc_ += 128; return;
    case 0x4E71: return;
    case 0x4E72: if (!(s_.sr & 0x2000)) { exception(8, S_(s_.pc, 2)); return; } set_sr(fetch()); s_.stopped = 1; return;
    case 0x4E73: { if (!(s_.sr & 0x2000)) { exception(8, S_(s_.pc, 2)); return; } const i32 s = pop16(); s_.pc = pop32(); set_sr(static_cast<u32>(s)); cyc_ += 12; return; }
    case 0x4E75: s_.pc = pop32(); cyc_ += 12; return;
    case 0x4E76: if (s_.v) exception(7, s_.pc); return;
    case 0x4E77: { set_ccr(static_cast<u32>(pop16())); s_.pc = pop32(); cyc_ += 12; return; }
    case 0x4AFC: throw Illegal{};
    default: break;
  }
  const int k = (op >> 8) & 15;   // 0 NEGX, 2 CLR, 4 NEG, 6 NOT, A TST
  if (sz == 3) throw Illegal{};
  ea(mode, ry, sz);
  switch (k) {
    case 0: write_ea(sz, sub(read_ea(sz), 0, sz, s_.x, true)); return;
    case 2: read_ea(sz); write_ea(sz, 0); s_.n = 0; s_.z = 1; s_.v = 0; s_.c = 0; return;
    case 4: write_ea(sz, sub(read_ea(sz), 0, sz, 0, false)); return;
    case 6: write_ea(sz, logic(~read_ea(sz), sz)); return;
    case 10: logic(read_ea(sz), sz); return;
    default: throw Illegal{};
  }
}

void M68k::movem(u32 op, int ry, int mode) {
  const int s = (op & 0x40) ? 2 : 1;
  const u32 mask = fetch();
  i32* d = s_.d; i32* a = s_.a;
  const int sb = 1 << s; int n = 0;
  if (!(op & 0x400)) {   // registradores -> memória
    if (mode == 4) {
      i32 ad = a[ry];
      for (int i = 0; i < 16; i++) if (mask & (1u << i)) { const int r = 15 - i; ad = S_(ad, sb); wr(static_cast<u32>(ad), s, r < 8 ? d[r] : a[r - 8]); n++; }
      a[ry] = ad;
    } else {
      ea(mode, ry, s); i32 ad = ea_a_;
      for (int i = 0; i < 16; i++) if (mask & (1u << i)) { wr(static_cast<u32>(ad), s, i < 8 ? d[i] : a[i - 8]); ad = A(ad, sb); n++; }
    }
  } else {
    i32 ad;
    if (mode == 3) ad = a[ry]; else { ea(mode, ry, s); ad = ea_a_; }
    for (int i = 0; i < 16; i++) if (mask & (1u << i)) { const i32 v = rd(static_cast<u32>(ad), s); if (i < 8) d[i] = v; else a[i - 8] = v; ad = A(ad, sb); n++; }
    if (mode == 3) a[ry] = ad;
  }
  cyc_ += 8 + n * (s == 2 ? 8 : 4);
}

/* grupos 8 (OR/DIV/SBCD) e C (AND/MUL/ABCD/EXG) */
void M68k::g8c(u32 op, int rx, int ry, int mode, int sz) {
  i32* d = s_.d; i32* a = s_.a;
  const bool is_c = (op >> 12) == 12;
  if (sz == 3) {   // DIVU/DIVS ou MULU/MULS
    const bool sgn = (op & 0x100) != 0;
    ea(mode, ry, 1);
    if (is_c) {
      const i32 s = read_ea(1), dv = sg(d[rx], 1);
      const i32 r = sgn ? static_cast<i32>(static_cast<u32>(s) * static_cast<u32>(dv)) : static_cast<i32>((static_cast<u32>(s) & 0xFFFF) * (static_cast<u32>(d[rx]) & 0xFFFF));
      d[rx] = r; logic(r, 2); cyc_ += 66;
    } else {
      const i32 s = read_ea(1);
      if (s == 0) { exception(5, s_.pc); return; }
      if (sgn) {
        const std::int64_t q = static_cast<std::int64_t>(d[rx]) / s, r = static_cast<std::int64_t>(d[rx]) % s;
        if (q > 32767 || q < -32768) { s_.v = 1; s_.c = 0; s_.n = 1; s_.z = 0; }
        else { d[rx] = static_cast<i32>(((static_cast<u32>(r) & 0xFFFF) << 16) | (static_cast<u32>(q) & 0xFFFF)); s_.n = q < 0 ? 1 : 0; s_.z = q == 0 ? 1 : 0; s_.v = 0; s_.c = 0; }
      } else {
        const std::uint64_t dd = static_cast<u32>(d[rx]), ss = static_cast<u32>(s) & 0xFFFF, q = dd / ss, r = dd % ss;
        if (q > 0xFFFF) { s_.v = 1; s_.c = 0; s_.n = 1; s_.z = 0; }
        else { d[rx] = static_cast<i32>((static_cast<u32>(r) << 16) | static_cast<u32>(q)); s_.n = (q & 0x8000) ? 1 : 0; s_.z = q == 0 ? 1 : 0; s_.v = 0; s_.c = 0; }
      }
      cyc_ += sgn ? 150 : 130;
    }
    return;
  }
  if ((op & 0x1F0) == 0x100) {   // SBCD / ABCD
    const bool mem = (op & 8) != 0; i32 sv, dv;
    if (mem) { ea(4, ry, 0); sv = rd(static_cast<u32>(ea_a_), 0) & 255; ea(4, rx, 0); dv = rd(static_cast<u32>(ea_a_), 0) & 255; }
    else { sv = d[ry] & 255; dv = d[rx] & 255; }
    i32 r, c;
    if (is_c) {
      i32 lo = (sv & 15) + (dv & 15) + static_cast<i32>(s_.x), hi = (sv >> 4) + (dv >> 4);
      if (lo > 9) { lo -= 10; hi++; }
      c = 0; if (hi > 9) { hi -= 10; c = 1; }
      r = (hi << 4) | lo;
    } else {
      i32 lo = (dv & 15) - (sv & 15) - static_cast<i32>(s_.x), hi = (dv >> 4) - (sv >> 4);
      if (lo < 0) { lo += 10; hi--; }
      c = 0; if (hi < 0) { hi += 10; c = 1; }
      r = ((hi & 15) << 4) | lo;
    }
    s_.c = s_.x = static_cast<u32>(c); if (r) s_.z = 0;
    if (mem) wr(static_cast<u32>(ea_a_), 0, r); else d[rx] = static_cast<i32>((static_cast<u32>(d[rx]) & ~0xFFu) | static_cast<u32>(r));
    return;
  }
  if (is_c && (op & 0x130) == 0x100) {   // EXG
    const int m = (op >> 3) & 31;
    if (m == 8) { const i32 t = d[rx]; d[rx] = d[ry]; d[ry] = t; }
    else if (m == 9) { const i32 t = a[rx]; a[rx] = a[ry]; a[ry] = t; }
    else if (m == 17) { const i32 t = d[rx]; d[rx] = a[ry]; a[ry] = t; }
    return;
  }
  ea(mode, ry, sz);
  if (op & 0x100) { const i32 dv = read_ea(sz); write_ea(sz, logic(is_c ? dv & d[rx] : dv | d[rx], sz)); }
  else {
    const i32 sv = read_ea(sz), r = logic(is_c ? sv & d[rx] : sv | d[rx], sz);
    d[rx] = mask_lo(d[rx], sz, r);
    if (sz == 2) cyc_ += 4;
  }
}

}  // namespace emuhub
