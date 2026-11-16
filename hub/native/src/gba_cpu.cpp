// CPU ARM7TDMI do GBA (porte de hub/src/cores/gba/cpu.js): ARM + Thumb, modos com registradores "banked", exceções.
// Convenção de PC: durante a execução r[15] = endereço + 8 (ARM) ou + 4 (Thumb).
#include "gba_machine.h"

namespace emuhub {

namespace {
enum : std::uint32_t { M_USR = 0x10, M_FIQ = 0x11, M_IRQ = 0x12, M_SVC = 0x13, M_ABT = 0x17, M_UND = 0x1B, M_SYS = 0x1F };
const std::int8_t kMidx[32] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
                               0, 1, 2, 3, -1, -1, -1, 4, -1, -1, -1, 5, -1, -1, -1, 0};
inline std::uint32_t rotr(std::uint32_t v, unsigned n) { return n ? (v >> n) | (v << (32 - n)) : v; }
}  // namespace

void GbaMachine::cpu_reset(bool skip_bios) {
  Cpu& c = cpu_;
  std::memset(&c, 0, sizeof(c));
  if (skip_bios) {   // estado em que a BIOS deixa o console antes de pular para a ROM
    c.i = 0; c.f = 0; c.mode = M_SYS;
    c.b13[0] = 0x03007F00; c.b13[2] = 0x03007FA0; c.b13[3] = 0x03007FE0;
    c.r[13] = 0x03007F00; c.r[15] = 0x08000000;
  } else { c.i = 1; c.f = 1; c.mode = M_SVC; c.r[15] = 0; }
}

std::uint32_t GbaMachine::get_cpsr() const {
  const Cpu& c = cpu_;
  return (c.n << 31) | (c.z << 30) | (c.c << 29) | (c.v << 28) | (c.i << 7) | (c.f << 6) | (c.t << 5) | c.mode;
}
void GbaMachine::set_cpsr(std::uint32_t v) {
  Cpu& c = cpu_;
  c.n = (v >> 31) & 1; c.z = (v >> 30) & 1; c.c = (v >> 29) & 1; c.v = (v >> 28) & 1;
  c.i = (v >> 7) & 1; c.f = (v >> 6) & 1; c.t = (v >> 5) & 1;
  const std::uint32_t m = v & 0x1F;
  if (m != c.mode && kMidx[m] >= 0) switch_mode(m);
}
std::uint32_t GbaMachine::get_spsr() const {
  if (cpu_.mode == M_USR || cpu_.mode == M_SYS) return get_cpsr();
  return cpu_.spsr[kMidx[cpu_.mode]];
}
void GbaMachine::switch_mode(std::uint32_t nm) {
  Cpu& c = cpu_;
  const int o = kMidx[c.mode], n = kMidx[nm];
  if (o != n) {
    c.b13[o] = c.r[13]; c.b14[o] = c.r[14];
    if (o == 1) for (int k = 0; k < 5; k++) { c.fiq_hi[k] = c.r[8 + k]; c.r[8 + k] = c.usr_hi[k]; }
    if (n == 1) for (int k = 0; k < 5; k++) { c.usr_hi[k] = c.r[8 + k]; c.r[8 + k] = c.fiq_hi[k]; }
    c.r[13] = c.b13[n]; c.r[14] = c.b14[n];
  }
  c.mode = nm;
}
std::uint32_t GbaMachine::get_user(int k) const {
  const Cpu& c = cpu_;
  if (k >= 8 && k <= 12) return c.mode == M_FIQ ? c.usr_hi[k - 8] : c.r[k];
  if ((k == 13 || k == 14) && c.mode != M_USR && c.mode != M_SYS) return k == 13 ? c.b13[0] : c.b14[0];
  return c.r[k];
}
void GbaMachine::set_user(int k, std::uint32_t v) {
  Cpu& c = cpu_;
  if (k >= 8 && k <= 12 && c.mode == M_FIQ) c.usr_hi[k - 8] = v;
  else if ((k == 13 || k == 14) && c.mode != M_USR && c.mode != M_SYS) { if (k == 13) c.b13[0] = v; else c.b14[0] = v; }
  else c.r[k] = v;
}

void GbaMachine::exception(std::uint32_t vec, std::uint32_t mode, std::uint32_t lr) {
  Cpu& c = cpu_;
  const std::uint32_t old = get_cpsr();
  switch_mode(mode);
  c.spsr[kMidx[mode]] = old;
  c.r[14] = lr;
  c.t = 0; c.i = 1;
  if (mode == M_FIQ) c.f = 1;
  c.r[15] = vec; c.pc_written = 1;
}
int GbaMachine::undef(std::uint32_t pc) { exception(0x04, M_UND, pc + (cpu_.t ? 2 : 4)); return 3; }
int GbaMachine::swi(std::uint32_t num, std::uint32_t pc) {
  if (hle_ && bios_swi(num, pc)) return 3;
  exception(0x08, M_SVC, pc + (cpu_.t ? 2 : 4));
  return 3;
}

void GbaMachine::set_pc(std::uint32_t v) { cpu_.r[15] = cpu_.t ? (v & ~1u) : (v & ~3u); cpu_.pc_written = 1; }
void GbaMachine::bx(std::uint32_t v) { cpu_.t = (v & 1) ? 1 : 0; set_pc(v); }

bool GbaMachine::cond(std::uint32_t k) const {
  const Cpu& c = cpu_;
  switch (k) {
    case 0: return c.z == 1; case 1: return c.z == 0;
    case 2: return c.c == 1; case 3: return c.c == 0;
    case 4: return c.n == 1; case 5: return c.n == 0;
    case 6: return c.v == 1; case 7: return c.v == 0;
    case 8: return c.c == 1 && c.z == 0; case 9: return c.c == 0 || c.z == 1;
    case 10: return c.n == c.v; case 11: return c.n != c.v;
    case 12: return c.z == 0 && c.n == c.v; case 13: return c.z == 1 || c.n != c.v;
    case 14: return true;
    default: return false;
  }
}

std::uint32_t GbaMachine::addc(std::uint32_t a, std::uint32_t b, std::uint32_t cin, bool s) {
  const std::uint64_t sum = static_cast<std::uint64_t>(a) + b + cin;
  const std::uint32_t res = static_cast<std::uint32_t>(sum);
  if (s) {
    cpu_.c = sum > 0xFFFFFFFFull ? 1 : 0;
    cpu_.v = ((~(a ^ b) & (a ^ res)) >> 31) & 1;
    cpu_.n = res >> 31; cpu_.z = res == 0 ? 1 : 0;
  }
  return res;
}

/* type: 0 LSL, 1 LSR, 2 ASR, 3 ROR. imm = quantidade vem de campo imediato (casos especiais de 0). Carry em cpu_.sc */
std::uint32_t GbaMachine::shift_op(int type, std::uint32_t v, std::uint32_t amt, bool imm) {
  Cpu& c = cpu_;
  switch (type) {
    case 0:
      if (amt == 0) { c.sc = c.c; return v; }
      if (amt < 32) { c.sc = (v >> (32 - amt)) & 1; return v << amt; }
      if (amt == 32) { c.sc = v & 1; return 0; }
      c.sc = 0; return 0;
    case 1:
      if (imm && amt == 0) amt = 32;
      if (amt == 0) { c.sc = c.c; return v; }
      if (amt < 32) { c.sc = (v >> (amt - 1)) & 1; return v >> amt; }
      if (amt == 32) { c.sc = v >> 31; return 0; }
      c.sc = 0; return 0;
    case 2:
      if (imm && amt == 0) amt = 32;
      if (amt == 0) { c.sc = c.c; return v; }
      if (amt < 32) { c.sc = (v >> (amt - 1)) & 1; return static_cast<std::uint32_t>(static_cast<std::int32_t>(v) >> amt); }
      c.sc = v >> 31; return static_cast<std::uint32_t>(static_cast<std::int32_t>(v) >> 31);
    default:
      if (imm && amt == 0) { const std::uint32_t cc = c.c; c.sc = v & 1; return (v >> 1) | (cc << 31); }
      if (amt == 0) { c.sc = c.c; return v; }
      amt &= 31;
      if (amt == 0) { c.sc = v >> 31; return v; }
      c.sc = (v >> (amt - 1)) & 1; return rotr(v, amt);
  }
}

std::uint32_t GbaMachine::ldr32(std::uint32_t a) {
  const std::uint32_t v = read32(a & ~3u), s = (a & 3) << 3;
  return s ? (v >> s) | (v << (32 - s)) : v;
}
std::uint32_t GbaMachine::ldrh(std::uint32_t a) {
  const std::uint32_t v = read16(a & ~1u);
  return (a & 1) ? (v >> 8) | (v << 24) : v;
}
std::uint32_t GbaMachine::ldrsb(std::uint32_t a) { return static_cast<std::uint32_t>(static_cast<std::int32_t>(static_cast<std::int8_t>(read8(a)))); }
std::uint32_t GbaMachine::ldrsh(std::uint32_t a) {
  return (a & 1) ? ldrsb(a) : static_cast<std::uint32_t>(static_cast<std::int32_t>(static_cast<std::int16_t>(read16(a))));
}

/* um passo: executa uma instrução (ou atende IRQ). Retorna ciclos. */
int GbaMachine::cpu_step() {
  Cpu& c = cpu_;
  if (c.halted) { if (c.irq_pending) c.halted = 0; else return 1; }
  if (c.irq_pending && !c.i) { exception(0x18, M_IRQ, c.r[15] + 4); return 3; }
  cycles_ = 0;
  const std::uint32_t pc = c.r[15];
  c.pc_written = 0;
  int extra = 0;
  const std::uint32_t rg = pc >> 24;
  if (c.t) {
    std::uint32_t instr;
    if ((rg == 8 || rg == 9) && (pc & 0x1FFFFFE) < rom_len_) {
      std::uint16_t h; std::memcpy(&h, rom_.data() + (pc & 0x1FFFFFE), 2); instr = h; cycles_ = 3;
    } else if (rg == 3) {
      std::uint16_t h; std::memcpy(&h, iwram_.data() + (pc & 0x7FFE), 2); instr = h; cycles_ = 1;
    } else instr = read16(pc);
    c.r[15] = pc + 4;
    extra = exec_thumb(instr, pc);
    if (!c.pc_written) c.r[15] = pc + 2;
  } else {
    std::uint32_t instr;
    if ((rg == 8 || rg == 9) && (pc & 0x1FFFFFC) + 4 <= rom_len_) {
      std::memcpy(&instr, rom_.data() + (pc & 0x1FFFFFC), 4); cycles_ = 6;
    } else if (rg == 3) {
      std::memcpy(&instr, iwram_.data() + (pc & 0x7FFC), 4); cycles_ = 1;
    } else instr = read32(pc);
    c.r[15] = pc + 8;
    if (cond(instr >> 28)) extra = exec_arm(instr, pc);
    if (!c.pc_written) c.r[15] = pc + 4;
  }
  return cycles_ + extra;
}

/* ============================== ARM ============================== */
int GbaMachine::exec_arm(std::uint32_t i, std::uint32_t pc) {
  std::uint32_t* r = cpu_.r;
  switch ((i >> 25) & 7) {
    case 0:
      if ((i & 0x0FFFFFF0) == 0x012FFF10) { bx(r[i & 15]); return 2; }
      if ((i & 0x90) == 0x90) {
        if ((i & 0x0FC000F0) == 0x00000090) return mul(i);
        if ((i & 0x0F8000F0) == 0x00800090) return mull(i);
        if ((i & 0x0FB000F0) == 0x01000090) return swp(i);
        if (i & 0x60) return halfword(i);
        return undef(pc);
      }
      return data_proc(i, pc);
    case 1: return data_proc(i, pc);
    case 2: return single(i);
    case 3: if (i & 0x10) return undef(pc); return single(i);
    case 4: return ldmstm((i >> 16) & 15, i & 0xFFFF, (i >> 20) & 1, (i >> 24) & 1, (i >> 23) & 1, (i >> 21) & 1, (i >> 22) & 1);
    case 5: {
      const std::int32_t off = static_cast<std::int32_t>((i & 0xFFFFFF) << 8) >> 6;
      if (i & 0x01000000) r[14] = pc + 4;
      set_pc(pc + 8 + static_cast<std::uint32_t>(off));
      return 2;
    }
    case 7: if (i & 0x01000000) return swi(i & 0xFFFFFF, pc); return undef(pc);
    default: return undef(pc);   // coprocessadores não existem no GBA
  }
}

int GbaMachine::data_proc(std::uint32_t i, std::uint32_t pc) {
  Cpu& c = cpu_;
  std::uint32_t* r = c.r;
  const std::uint32_t op = (i >> 21) & 15, S = (i >> 20) & 1;
  if (op >= 8 && op <= 11 && !S) return psr(i, pc);
  const std::uint32_t rn = (i >> 16) & 15, rd = (i >> 12) & 15;
  std::uint32_t op2, a;
  int extra = 0;
  if (i & 0x02000000) {
    const unsigned rot = ((i >> 8) & 15) * 2;
    const std::uint32_t imm = i & 0xFF;
    if (rot) { op2 = rotr(imm, rot); c.sc = op2 >> 31; } else { op2 = imm; c.sc = c.c; }
    a = r[rn];
  } else {
    const std::uint32_t rm = i & 15;
    const int type = (i >> 5) & 3;
    if (i & 0x10) {   // deslocamento por registrador: PC lê como +12
      std::uint32_t v = r[rm];
      a = r[rn];
      if (rm == 15) v += 4;
      if (rn == 15) a += 4;
      op2 = shift_op(type, v, r[(i >> 8) & 15] & 0xFF, false); extra = 1;
    } else {
      op2 = shift_op(type, r[rm], (i >> 7) & 31, true); a = r[rn];
    }
  }
  std::uint32_t res = 0;
  bool write = true, logical = false;
  switch (op) {
    case 0: res = a & op2; logical = true; break;
    case 1: res = a ^ op2; logical = true; break;
    case 2: res = addc(a, ~op2, 1, S); break;
    case 3: res = addc(op2, ~a, 1, S); break;
    case 4: res = addc(a, op2, 0, S); break;
    case 5: res = addc(a, op2, c.c, S); break;
    case 6: res = addc(a, ~op2, c.c, S); break;
    case 7: res = addc(op2, ~a, c.c, S); break;
    case 8: res = a & op2; logical = true; write = false; break;
    case 9: res = a ^ op2; logical = true; write = false; break;
    case 10: addc(a, ~op2, 1, true); write = false; break;
    case 11: addc(a, op2, 0, true); write = false; break;
    case 12: res = a | op2; logical = true; break;
    case 13: res = op2; logical = true; break;
    case 14: res = a & ~op2; logical = true; break;
    default: res = ~op2; logical = true;
  }
  if (rd == 15 && write) {
    if (S) set_cpsr(get_spsr());
    set_pc(res);
    return extra + 2;
  }
  if (logical && S) { set_nz(res); c.c = c.sc; }
  if (write) r[rd] = res;
  return extra;
}

int GbaMachine::psr(std::uint32_t i, std::uint32_t pc) {
  Cpu& c = cpu_;
  if ((i & 0x0FBF0FFF) == 0x010F0000) {   // MRS
    c.r[(i >> 12) & 15] = (i & 0x400000) ? get_spsr() : get_cpsr();
    return 0;
  }
  if ((i & 0x0DB0F000) == 0x0120F000) {   // MSR
    std::uint32_t v;
    if (i & 0x02000000) { const unsigned rot = ((i >> 8) & 15) * 2; const std::uint32_t imm = i & 0xFF; v = rotr(imm, rot); }
    else v = c.r[i & 15];
    std::uint32_t mask = 0;
    if (i & 0x80000) mask |= 0xFF000000u;
    if (i & 0x40000) mask |= 0x00FF0000u;
    if (i & 0x20000) mask |= 0x0000FF00u;
    if (i & 0x10000) mask |= 0x000000FFu;
    if (i & 0x400000) {
      if (c.mode != M_USR && c.mode != M_SYS) {
        const int k = kMidx[c.mode];
        c.spsr[k] = (c.spsr[k] & ~mask) | (v & mask);
      }
    } else {
      if (c.mode == M_USR) mask &= 0xFF000000u;
      set_cpsr((get_cpsr() & ~mask) | (v & mask));
    }
    return 0;
  }
  return undef(pc);
}

int GbaMachine::mul(std::uint32_t i) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t rd = (i >> 16) & 15, rn = (i >> 12) & 15, rs = (i >> 8) & 15, rm = i & 15;
  std::uint32_t res = r[rm] * r[rs];
  if (i & 0x200000) res += r[rn];
  r[rd] = res;
  if (i & 0x100000) set_nz(res);
  return 2;
}
int GbaMachine::mull(std::uint32_t i) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t hi = (i >> 16) & 15, lo = (i >> 12) & 15, rs = (i >> 8) & 15, rm = i & 15;
  std::uint64_t p;
  if (i & 0x400000) p = static_cast<std::uint64_t>(static_cast<std::int64_t>(static_cast<std::int32_t>(r[rm])) * static_cast<std::int32_t>(r[rs]));
  else p = static_cast<std::uint64_t>(r[rm]) * r[rs];
  if (i & 0x200000) p += (static_cast<std::uint64_t>(r[hi]) << 32) | r[lo];
  const std::uint32_t l = static_cast<std::uint32_t>(p), h = static_cast<std::uint32_t>(p >> 32);
  r[lo] = l; r[hi] = h;
  if (i & 0x100000) { cpu_.n = h >> 31; cpu_.z = (h | l) == 0 ? 1 : 0; }
  return 3;
}
int GbaMachine::swp(std::uint32_t i) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t addr = r[(i >> 16) & 15], rd = (i >> 12) & 15, rm = i & 15;
  std::uint32_t t;
  if (i & 0x400000) { t = read8(addr); write8(addr, r[rm] & 0xFF); }
  else { t = ldr32(addr); write32(addr & ~3u, r[rm]); }
  r[rd] = t;
  return 3;
}

int GbaMachine::halfword(std::uint32_t i) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t rn = (i >> 16) & 15, rd = (i >> 12) & 15, P = (i >> 24) & 1, U = (i >> 23) & 1, W = (i >> 21) & 1, L = (i >> 20) & 1, sh = (i >> 5) & 3;
  const std::uint32_t off = (i & 0x400000) ? (((i >> 4) & 0xF0) | (i & 15)) : r[i & 15];
  const std::uint32_t base = r[rn], sv = r[rd];
  const std::uint32_t off_addr = U ? base + off : base - off;
  const std::uint32_t addr = P ? off_addr : base;
  if ((!P || W) && rn != 15) r[rn] = off_addr;
  if (L) {
    const std::uint32_t v = sh == 1 ? ldrh(addr) : sh == 2 ? ldrsb(addr) : ldrsh(addr);
    if (rd == 15) { set_pc(v); return 4; }
    r[rd] = v; return 1;
  }
  write16(addr & ~1u, (rd == 15 ? sv + 4 : sv) & 0xFFFF);
  return 0;
}

int GbaMachine::single(std::uint32_t i) {
  std::uint32_t* r = cpu_.r;
  const std::uint32_t rn = (i >> 16) & 15, rd = (i >> 12) & 15, P = (i >> 24) & 1, U = (i >> 23) & 1, B = (i >> 22) & 1, W = (i >> 21) & 1, L = (i >> 20) & 1;
  const std::uint32_t off = (i & 0x02000000) ? shift_op((i >> 5) & 3, r[i & 15], (i >> 7) & 31, true) : (i & 0xFFF);
  const std::uint32_t base = r[rn], sv = r[rd];
  const std::uint32_t off_addr = U ? base + off : base - off;
  const std::uint32_t addr = P ? off_addr : base;
  if ((!P || W) && rn != 15) r[rn] = off_addr;
  if (L) {
    const std::uint32_t v = B ? read8(addr) : ldr32(addr);
    if (rd == 15) { set_pc(v); return 4; }
    r[rd] = v; return 1;
  }
  const std::uint32_t v = rd == 15 ? sv + 4 : sv;
  if (B) write8(addr, v & 0xFF); else write32(addr & ~3u, v);
  return 0;
}

/* LDM/STM (ARM e Thumb). P=pré-indexado, U=sobe, W=writeback, S=banco de usuário / restaura CPSR */
int GbaMachine::ldmstm(int rn, std::uint32_t list, int L, int P, int U, int W, int S) {
  std::uint32_t* r = cpu_.r;
  int count = 0;
  for (int k = 0; k < 16; k++) if (list & (1u << k)) count++;
  std::uint32_t delta = static_cast<std::uint32_t>(count) * 4;
  if (list == 0) { list = 0x8000; count = 1; delta = 0x40; }   // lista vazia: transfere só r15
  const std::uint32_t base = r[rn];
  std::uint32_t start, wb;
  if (U) { start = base + (P ? 4 : 0); wb = base + delta; }
  else { start = base - delta + (P ? 0 : 4); wb = base - delta; }
  start &= ~3u;
  const bool user_bank = S && !(L && (list & 0x8000));
  std::uint32_t addr = start;
  if (L) {
    if (W) r[rn] = wb;
    for (int k = 0; k < 16; k++) {
      if (!(list & (1u << k))) continue;
      const std::uint32_t v = read32(addr); addr += 4;
      if (user_bank) set_user(k, v);
      else if (k == 15) { if (S) set_cpsr(get_spsr()); set_pc(v); }
      else r[k] = v;
    }
    return count + 1 + ((list & 0x8000) ? 2 : 0);
  }
  bool first = true;
  for (int k = 0; k < 16; k++) {
    if (!(list & (1u << k))) continue;
    std::uint32_t v = user_bank ? get_user(k) : r[k];
    if (k == 15) v += 4;
    write32(addr, v); addr += 4;
    if (first) { first = false; if (W) r[rn] = wb; }
  }
  return count;
}

/* ============================== THUMB ============================== */
int GbaMachine::exec_thumb(std::uint32_t i, std::uint32_t pc) {
  Cpu& c = cpu_;
  std::uint32_t* r = c.r;
  switch (i >> 13) {
    case 0: {
      const std::uint32_t op = (i >> 11) & 3;
      if (op == 3) {   // soma/subtração com registrador ou imediato de 3 bits
        const std::uint32_t rd = i & 7, a = r[(i >> 3) & 7], n = (i >> 6) & 7, o2 = (i & 0x400) ? n : r[n];
        r[rd] = (i & 0x200) ? addc(a, ~o2, 1, true) : addc(a, o2, 0, true);
      } else {
        const std::uint32_t v = shift_op(static_cast<int>(op), r[(i >> 3) & 7], (i >> 6) & 31, true);
        r[i & 7] = v; set_nz(v); c.c = c.sc;
      }
      return 0;
    }
    case 1: {
      const std::uint32_t rd = (i >> 8) & 7, imm = i & 0xFF;
      switch ((i >> 11) & 3) {
        case 0: r[rd] = imm; set_nz(imm); break;
        case 1: addc(r[rd], ~imm, 1, true); break;
        case 2: r[rd] = addc(r[rd], imm, 0, true); break;
        default: r[rd] = addc(r[rd], ~imm, 1, true);
      }
      return 0;
    }
    case 2: {
      if ((i & 0xFC00) == 0x4000) return thumb_alu(i);
      if ((i & 0xFC00) == 0x4400) {   // registradores altos / BX
        const std::uint32_t op = (i >> 8) & 3, rs = ((i >> 3) & 7) | (((i >> 6) & 1) << 3), rd = (i & 7) | (((i >> 7) & 1) << 3);
        switch (op) {
          case 0: { const std::uint32_t v = r[rd] + r[rs]; if (rd == 15) { set_pc(v); return 2; } r[rd] = v; return 0; }
          case 1: addc(r[rd], ~r[rs], 1, true); return 0;
          case 2: { const std::uint32_t v = r[rs]; if (rd == 15) { set_pc(v); return 2; } r[rd] = v; return 0; }
          default: bx(r[rs]); return 2;
        }
      }
      if ((i & 0xF800) == 0x4800) {   // LDR rd,[pc,#imm]
        r[(i >> 8) & 7] = read32((r[15] & ~3u) + ((i & 0xFF) << 2));
        return 1;
      }
      // 0101: load/store com registrador de offset
      const std::uint32_t addr = r[(i >> 3) & 7] + r[(i >> 6) & 7], rd = i & 7, k = (i >> 9) & 7;
      switch (k) {
        case 0: write32(addr & ~3u, r[rd]); return 0;           // STR
        case 1: write16(addr & ~1u, r[rd] & 0xFFFF); return 0;  // STRH
        case 2: write8(addr, r[rd] & 0xFF); return 0;           // STRB
        case 3: r[rd] = ldrsb(addr); return 1;                  // LDSB
        case 4: r[rd] = ldr32(addr); return 1;                  // LDR
        case 5: r[rd] = ldrh(addr); return 1;                   // LDRH
        case 6: r[rd] = read8(addr); return 1;                  // LDRB
        default: r[rd] = ldrsh(addr); return 1;                 // LDSH
      }
    }
    case 3: {   // load/store com offset imediato (word/byte)
      const std::uint32_t B = (i >> 12) & 1, L = (i >> 11) & 1, off = (i >> 6) & 31, rd = i & 7;
      const std::uint32_t addr = r[(i >> 3) & 7] + (B ? off : off << 2);
      if (L) { r[rd] = B ? read8(addr) : ldr32(addr); return 1; }
      if (B) write8(addr, r[rd] & 0xFF); else write32(addr & ~3u, r[rd]);
      return 0;
    }
    case 4: {
      const std::uint32_t L = (i >> 11) & 1;
      if (!(i & 0x1000)) {   // halfword com offset imediato
        const std::uint32_t addr = r[(i >> 3) & 7] + (((i >> 6) & 31) << 1), rd = i & 7;
        if (L) { r[rd] = ldrh(addr); return 1; }
        write16(addr & ~1u, r[rd] & 0xFFFF); return 0;
      }
      const std::uint32_t rd = (i >> 8) & 7, addr = r[13] + ((i & 0xFF) << 2);   // relativo ao SP
      if (L) { r[rd] = ldr32(addr); return 1; }
      write32(addr & ~3u, r[rd]); return 0;
    }
    case 5: {
      if (!(i & 0x1000)) {   // ADD rd, PC/SP, #imm
        const std::uint32_t rd = (i >> 8) & 7, imm = (i & 0xFF) << 2;
        r[rd] = ((i & 0x800) ? r[13] : (r[15] & ~3u)) + imm;
        return 0;
      }
      if ((i & 0x0F00) == 0) {   // ADD SP, #±imm
        const std::uint32_t imm = (i & 0x7F) << 2;
        r[13] = (i & 0x80) ? r[13] - imm : r[13] + imm;
        return 0;
      }
      if ((i & 0x0600) == 0x0400) {   // PUSH / POP
        const std::uint32_t list = i & 0xFF, R = (i >> 8) & 1;
        int count = static_cast<int>(R);
        for (int k = 0; k < 8; k++) if (list & (1u << k)) count++;
        if (i & 0x800) {   // POP
          std::uint32_t a = r[13];
          for (int k = 0; k < 8; k++) if (list & (1u << k)) { r[k] = read32(a); a += 4; }
          if (R) { const std::uint32_t v = read32(a); a += 4; r[13] = a; set_pc(v); return count + 3; }
          r[13] = a; return count + 1;
        }
        std::uint32_t a = r[13] - static_cast<std::uint32_t>(count) * 4; r[13] = a;   // PUSH
        for (int k = 0; k < 8; k++) if (list & (1u << k)) { write32(a, r[k]); a += 4; }
        if (R) write32(a, r[14]);
        return count;
      }
      return undef(pc);
    }
    case 6: {
      if (!(i & 0x1000)) return ldmstm((i >> 8) & 7, i & 0xFF, (i >> 11) & 1, 0, 1, 1, 0);   // STMIA / LDMIA
      const std::uint32_t cnd = (i >> 8) & 15;
      if (cnd == 15) return swi(i & 0xFF, pc);
      if (cnd == 14) return undef(pc);
      if (cond(cnd)) {
        const std::int32_t off = static_cast<std::int32_t>(static_cast<std::int8_t>(i & 0xFF)) * 2;
        set_pc(pc + 4 + static_cast<std::uint32_t>(off)); return 2;
      }
      return 0;
    }
    default: {   // 111
      const std::int32_t s11 = static_cast<std::int32_t>((i & 0x7FF) << 21) >> 21;
      if (!(i & 0x1000)) {   // 11100: desvio incondicional
        if (i & 0x0800) return undef(pc);   // BLX (não existe em ARMv4T)
        set_pc(pc + 4 + static_cast<std::uint32_t>(s11 * 2));
        return 2;
      }
      if (!(i & 0x0800)) {   // BL, primeira metade
        r[14] = pc + 4 + static_cast<std::uint32_t>(s11 * 4096);
        return 0;
      }
      const std::uint32_t target = r[14] + ((i & 0x7FF) << 1);   // BL, segunda metade
      r[14] = (pc + 2) | 1;
      set_pc(target);
      return 2;
    }
  }
}

int GbaMachine::thumb_alu(std::uint32_t i) {
  Cpu& c = cpu_;
  std::uint32_t* r = c.r;
  const std::uint32_t rd = i & 7, a = r[rd], b = r[(i >> 3) & 7];
  std::uint32_t res;
  switch ((i >> 6) & 15) {
    case 0: res = a & b; set_nz(res); r[rd] = res; break;
    case 1: res = a ^ b; set_nz(res); r[rd] = res; break;
    case 2: res = shift_op(0, a, b & 0xFF, false); set_nz(res); c.c = c.sc; r[rd] = res; return 1;
    case 3: res = shift_op(1, a, b & 0xFF, false); set_nz(res); c.c = c.sc; r[rd] = res; return 1;
    case 4: res = shift_op(2, a, b & 0xFF, false); set_nz(res); c.c = c.sc; r[rd] = res; return 1;
    case 5: r[rd] = addc(a, b, c.c, true); break;
    case 6: r[rd] = addc(a, ~b, c.c, true); break;
    case 7: res = shift_op(3, a, b & 0xFF, false); set_nz(res); c.c = c.sc; r[rd] = res; return 1;
    case 8: set_nz(a & b); break;
    case 9: r[rd] = addc(0, ~b, 1, true); break;
    case 10: addc(a, ~b, 1, true); break;
    case 11: addc(a, b, 0, true); break;
    case 12: res = a | b; set_nz(res); r[rd] = res; break;
    case 13: res = a * b; set_nz(res); r[rd] = res; return 2;
    case 14: res = a & ~b; set_nz(res); r[rd] = res; break;
    default: res = ~b; set_nz(res); r[rd] = res;
  }
  return 0;
}

}  // namespace emuhub
