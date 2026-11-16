#include "sms_machine.h"
// Porte fiel de hub/src/cores/sms/{z80,vdp,psg,sms,core}.js. Qualquer diferença de comportamento é bug.
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

constexpr double kPsgClock = 3579545.0;
constexpr double kPsgVol[16] = {1, 0.794, 0.631, 0.501, 0.398, 0.316, 0.251, 0.2, 0.158, 0.126, 0.1, 0.079, 0.063, 0.05, 0.04, 0};
}  // namespace

#define SETF(expr) (c_.f = static_cast<std::uint8_t>(expr))

SmsMachine::SmsMachine(bool gg) : gg_(gg) {
  out_.assign(static_cast<std::size_t>(width()) * height(), 0);
  rom_.assign(0x4000, 0);
  p_.px = p_.py = p_.last = 0; p_.rp = p_.wp = 0;
  cps_ = kPsgClock / 44100.0;
  z80_reset(); vdp_reset(); psg_reset();
}

/* ====================================================================== sms.js / core.js */

bool SmsMachine::has_sega_header() const {
  static const int offs[3] = {0x7FF0, 0x3FF0, 0x1FF0};
  for (int h : offs)
    if (static_cast<std::size_t>(h) + 2 < rom_.size() && rom_[h] == 0x54 && rom_[h + 1] == 0x4D && rom_[h + 2] == 0x52) return true;
  return false;
}

SmsError SmsMachine::load_rom(const std::uint8_t* data, std::size_t size) {
  if (size < 0x2000) return SmsError::TooSmall;
  // hash dos primeiros 64 KB do arquivo original (chave do save, igual ao JS)
  rom_hash_ = 0;
  for (std::size_t i = 0; i < std::min<std::size_t>(size, 65536); i++) rom_hash_ = rom_hash_ * 31u + data[i];
  const std::uint8_t* u = data; std::size_t n = size;
  if (n % 0x4000 == 512) { u += 512; n -= 512; }
  // cabeçalho TMR SEGA (informativo)
  header_ = Header{false, 0, 0, false};
  static const std::size_t offs[3] = {0x7FF0, 0x3FF0, 0x1FF0};
  for (std::size_t o : offs) {
    if (o + 16 <= n && u[o] == 0x54 && u[o + 1] == 0x4D && u[o + 2] == 0x52 && u[o + 3] == 0x20 && u[o + 4] == 0x53) {
      const int reg = u[o + 15] >> 4;
      header_ = Header{true, reg, static_cast<unsigned>(u[o + 12] | (u[o + 13] << 8)), reg >= 5 && reg <= 7};
      break;
    }
  }
  pages_ = static_cast<std::uint32_t>(std::max<std::size_t>(1, (n + 0x3FFF) / 0x4000));
  rom_.assign(static_cast<std::size_t>(pages_) * 0x4000, 0);
  std::memcpy(rom_.data(), u, n);
  // Codemasters: soma de verificação em 0x7FE6 + complemento em 0x7FE8 = 0x10000
  mapper_ = 0;
  if (pages_ >= 2) {
    const int a = rom_[0x7FE6] | (rom_[0x7FE7] << 8), b = rom_[0x7FE8] | (rom_[0x7FE9] << 8);
    if (a != 0 && ((a + b) & 0xFFFF) == 0 && !has_sega_header()) mapper_ = 1;
  }
  reset();
  loaded_ = true;
  return SmsError::Ok;
}

void SmsMachine::reset() {
  z80_reset(); vdp_reset(); psg_reset(); ram_.fill(0);
  bank_[0] = 0; bank_[1] = 1; bank_[2] = mapper_ == 1 ? 0 : 2;
  ram_ctl_ = 0;
  c_.sp = 0xDFF0; cyc_ = 0; debt_ = 0;
}

std::uint8_t SmsMachine::read(std::uint16_t a) const {
  if (a < 0x4000) {
    if (a < 0x400) return rom_[a];
    return rom_[(static_cast<std::size_t>(page_of(bank_[0])) << 14) | a];
  }
  if (a < 0x8000) return rom_[(static_cast<std::size_t>(page_of(bank_[1])) << 14) | (a & 0x3FFF)];
  if (a < 0xC000) {
    if (ram_ctl_ & 8) return cart_ram_[((ram_ctl_ & 4) ? 0x4000 : 0) | (a & 0x3FFF)];
    return rom_[(static_cast<std::size_t>(page_of(bank_[2])) << 14) | (a & 0x3FFF)];
  }
  return ram_[a & 0x1FFF];
}

void SmsMachine::write(std::uint16_t a, std::uint8_t v) {
  if (a >= 0xC000) {
    ram_[a & 0x1FFF] = v;
    if (a >= 0xFFFC && mapper_ == 0) {
      if (a == 0xFFFC) ram_ctl_ = v; else bank_[a - 0xFFFD] = v;
    }
    return;
  }
  if (mapper_ == 1) {
    if (a == 0x0000) bank_[0] = v; else if (a == 0x4000) bank_[1] = v; else if (a == 0x8000) bank_[2] = v;
    return;
  }
  if (a >= 0x8000 && (ram_ctl_ & 8)) { cart_ram_[((ram_ctl_ & 4) ? 0x4000 : 0) | (a & 0x3FFF)] = v; ram_dirty_ = 1; }
}

std::uint8_t SmsMachine::port_in(int p) {
  p &= 0xFF;
  if (gg_ && p < 7) {
    if (p == 0) return static_cast<std::uint8_t>(0x40 | ((buttons_ & 8) ? 0 : 0x80) | 0x3F);
    return 0xFF;
  }
  switch (p & 0xC1) {
    case 0x40: return static_cast<std::uint8_t>(vdp_vcounter());
    case 0x41: return static_cast<std::uint8_t>(vdp_hcounter());
    case 0x80: return vdp_read_data();
    case 0x81: return vdp_read_status();
    case 0xC0: {
      const int b = buttons_;
      return static_cast<std::uint8_t>(~(((b & 16) ? 1 : 0) | ((b & 32) ? 2 : 0) | ((b & 64) ? 4 : 0) | ((b & 128) ? 8 : 0) | ((b & 1) ? 16 : 0) | ((b & 2) ? 32 : 0)) & 0xFF);
    }
    case 0xC1: {
      const int io = io_ctl_;
      const int th1 = (io & 2) ? 1 : (io >> 5) & 1, th2 = (io & 8) ? 1 : (io >> 7) & 1;
      return static_cast<std::uint8_t>(0x3F | 0x10 | (th1 << 6) | (th2 << 7));
    }
  }
  return 0xFF;
}

void SmsMachine::port_out(int p, int v) {
  p &= 0xFF;
  if (gg_ && p < 7) return;   // estéreo e comunicação serial
  switch (p & 0xC1) {
    case 0x00: mem_ctl_ = static_cast<std::uint8_t>(v); return;
    case 0x01: io_ctl_ = static_cast<std::uint8_t>(v); return;
    case 0x40: case 0x41: psg_write(v); return;
    case 0x80: vdp_write_data(v); return;
    case 0x81: vdp_write_ctrl(v); return;
  }
}

void SmsMachine::set_buttons(std::uint16_t m) {
  buttons_ = m;
  // Pause do SMS = NMI (borda de descida do botão)
  if (!gg_) { const bool st = (m & 8) != 0; if (st && !nmi_prev_) c_.nmi = 1; nmi_prev_ = st ? 1 : 0; }
}

bool SmsMachine::run_frame() {
  for (unsigned line = 0; line < kFrameLines; line++) {
    vdp_start_line(static_cast<int>(line));
    int c = debt_;
    while (c < static_cast<int>(kCycLine)) {
      const int t = z80_step(); c += t; psg_tick(t);
      cyc_ = c;
    }
    debt_ = c - static_cast<int>(kCycLine);
  }
  for (const auto& ch : cheats_) ram_[ch.addr & 0x1FFF] = ch.val;
  if (gg_) {   // janela de 160x144 dentro dos 256x192
    for (unsigned y = 0; y < kGgHeight; y++) {
      const std::uint32_t* s = &frame_[(y + 24) * kSmsWidth + 48];
      std::copy(s, s + kGgWidth, &out_[y * kGgWidth]);
    }
  } else {
    std::copy(frame_.begin(), frame_.end(), out_.begin());
  }
  return true;
}

void SmsMachine::sram_restore(const std::uint8_t* data, std::size_t n) {
  std::memcpy(cart_ram_.data(), data, std::min(n, cart_ram_.size()));
  ram_dirty_ = 1;
}

SmsMachine::Regs SmsMachine::regs() const {
  return Regs{c_.R[7], c_.R[0], c_.R[1], c_.R[2], c_.R[3], c_.R[4], c_.R[5], c_.f, c_.ix, c_.iy, c_.sp, c_.pc};
}

void SmsMachine::state(StateIO& s) {
  s.v(c_); s.v(v_); s.v(p_);
  s.v(ram_); s.v(cart_ram_);
  s.v(bank_); s.v(ram_ctl_); s.v(ram_dirty_); s.v(io_ctl_); s.v(mem_ctl_); s.v(nmi_prev_); s.v(buttons_); s.v(cyc_); s.v(debt_);
  if (!s.saving() && s.ok()) {
    for (int i = 0; i < 32; i++) vdp_set_pal(i);
    p_.rp = p_.wp;
    vdp_update_irq();
  }
}

/* ====================================================================== z80.js */

void SmsMachine::z80_reset() {
  std::memset(&c_, 0, sizeof c_);
  c_.R[7] = 0xFF; c_.f = 0xFF; c_.f2 = 0xFF;
  c_.ix = 0xFFFF; c_.iy = 0xFFFF; c_.sp = 0xFFFF; c_.pc = 0;
  c_.im = 1;
}

std::uint16_t SmsMachine::rd16(std::uint16_t a) const {
  return static_cast<std::uint16_t>(read(a) | (read(static_cast<std::uint16_t>(a + 1)) << 8));
}
void SmsMachine::wr16(std::uint16_t a, std::uint16_t v) {
  write(a, static_cast<std::uint8_t>(v & 255)); write(static_cast<std::uint16_t>(a + 1), static_cast<std::uint8_t>(v >> 8));
}
void SmsMachine::push16(std::uint16_t v) {
  c_.sp = static_cast<std::uint16_t>(c_.sp - 1); write(c_.sp, static_cast<std::uint8_t>(v >> 8));
  c_.sp = static_cast<std::uint16_t>(c_.sp - 1); write(c_.sp, static_cast<std::uint8_t>(v & 255));
}
std::uint16_t SmsMachine::pop16() {
  const int lo = read(c_.sp); c_.sp = static_cast<std::uint16_t>(c_.sp + 1);
  const int hi = read(c_.sp); c_.sp = static_cast<std::uint16_t>(c_.sp + 1);
  return static_cast<std::uint16_t>(lo | (hi << 8));
}
std::uint8_t SmsMachine::fetch() { const std::uint8_t v = read(c_.pc); c_.pc = static_cast<std::uint16_t>(c_.pc + 1); return v; }
std::uint16_t SmsMachine::fetch16() { const int lo = fetch(); return static_cast<std::uint16_t>(lo | (fetch() << 8)); }

void SmsMachine::set_hl_idx(int v) {
  if (c_.idx == 0) set_hl(v); else if (c_.idx == 1) c_.ix = static_cast<std::uint16_t>(v); else c_.iy = static_cast<std::uint16_t>(v);
}
std::uint16_t SmsMachine::rp(int p) const { return p == 0 ? bc() : p == 1 ? de() : p == 2 ? get_hl() : c_.sp; }
void SmsMachine::set_rp(int p, int v) {
  v &= 0xFFFF;
  if (p == 0) set_bc(v); else if (p == 1) set_de(v); else if (p == 2) set_hl_idx(v); else c_.sp = static_cast<std::uint16_t>(v);
}
std::uint16_t SmsMachine::rp2(int p) const { return p == 0 ? bc() : p == 1 ? de() : p == 2 ? get_hl() : af(); }
void SmsMachine::set_rp2(int p, int v) {
  v &= 0xFFFF;
  if (p == 0) set_bc(v); else if (p == 1) set_de(v); else if (p == 2) set_hl_idx(v); else set_af(v);
}
std::uint8_t SmsMachine::get8(int z) const {
  if (c_.idx) {
    if (z == 4) return static_cast<std::uint8_t>((c_.idx == 1 ? c_.ix : c_.iy) >> 8);
    if (z == 5) return static_cast<std::uint8_t>((c_.idx == 1 ? c_.ix : c_.iy) & 255);
  }
  return c_.R[z];
}
void SmsMachine::set8(int z, int v) {
  v &= 255;
  if (c_.idx && (z == 4 || z == 5)) {
    const int cur = c_.idx == 1 ? c_.ix : c_.iy, n = z == 4 ? (v << 8) | (cur & 255) : (cur & 0xFF00) | v;
    if (c_.idx == 1) c_.ix = static_cast<std::uint16_t>(n); else c_.iy = static_cast<std::uint16_t>(n);
    return;
  }
  c_.R[z] = static_cast<std::uint8_t>(v);
}

void SmsMachine::alu(int op, int v) {
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
std::uint8_t SmsMachine::inc8(int v) {
  const int r = (v + 1) & 255;
  SETF((c_.f & Z_C) | (r & 0xA8) | (r == 0 ? Z_Z : 0) | ((v & 15) == 15 ? Z_H : 0) | (v == 0x7F ? Z_P : 0));
  return static_cast<std::uint8_t>(r);
}
std::uint8_t SmsMachine::dec8(int v) {
  const int r = (v - 1) & 255;
  SETF((c_.f & Z_C) | (r & 0xA8) | (r == 0 ? Z_Z : 0) | ((v & 15) == 0 ? Z_H : 0) | (v == 0x80 ? Z_P : 0) | Z_N);
  return static_cast<std::uint8_t>(r);
}
std::uint16_t SmsMachine::add16(int a, int b) {
  const int r = a + b;
  SETF((c_.f & (Z_S | Z_Z | Z_P)) | ((r >> 8) & (Z_Y | Z_X)) | (((a ^ b ^ r) >> 8) & Z_H) | ((r >> 16) & 1));
  return static_cast<std::uint16_t>(r & 0xFFFF);
}
void SmsMachine::adc16(int b) {
  const int a = hl(), c = c_.f & 1, r = a + b + c;
  SETF(((r >> 8) & 0xA8) | ((r & 0xFFFF) == 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ r) & (b ^ r)) & 0x8000) ? Z_P : 0) | ((r >> 16) & 1));
  set_hl(r);
}
void SmsMachine::sbc16(int b) {
  const int a = hl(), c = c_.f & 1, r = a - b - c;
  SETF(((r >> 8) & 0xA8) | ((r & 0xFFFF) == 0 ? Z_Z : 0) | (((a ^ b ^ r) >> 8) & Z_H) | ((((a ^ b) & (a ^ r)) & 0x8000) ? Z_P : 0) | Z_N | ((r >> 16) & 1));
  set_hl(r);
}
void SmsMachine::daa() {
  const int a = c_.R[7], f = c_.f; int add = 0, c = f & 1;
  if ((f & Z_H) || (a & 15) > 9) add |= 6;
  if (c || a > 0x99) { add |= 0x60; c = 1; }
  const int r = (f & Z_N) ? (a - add) & 255 : (a + add) & 255;
  const int h = (f & Z_N) ? (((f & Z_H) && (a & 15) < 6) ? Z_H : 0) : ((a & 15) > 9 ? Z_H : 0);
  SETF(zt().szp[r] | (f & Z_N) | h | c); c_.R[7] = static_cast<std::uint8_t>(r);
}
std::uint8_t SmsMachine::rot(int y, int v) {
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
bool SmsMachine::cond(int y) const {
  const int f = c_.f;
  switch (y) {
    case 0: return !(f & Z_Z); case 1: return (f & Z_Z) != 0; case 2: return !(f & Z_C); case 3: return (f & Z_C) != 0;
    case 4: return !(f & Z_P); case 5: return (f & Z_P) != 0; case 6: return !(f & Z_S); default: return (f & Z_S) != 0;
  }
}

int SmsMachine::z80_step() {
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
  return t + z80_exec(op);
}

int SmsMachine::z80_exec(int op) {
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
            if (p == 0) { write(bc(), R[7]); return 7; }
            if (p == 1) { write(de(), R[7]); return 7; }
            if (p == 2) { const std::uint16_t a = fetch16(); wr16(a, get_hl()); return 16; }
            { const std::uint16_t a = fetch16(); write(a, R[7]); return 13; }
          }
          if (p == 0) { R[7] = read(bc()); return 7; }
          if (p == 1) { R[7] = read(de()); return 7; }
          if (p == 2) { const std::uint16_t a = fetch16(); set_hl_idx(rd16(a)); return 16; }
          { const std::uint16_t a = fetch16(); R[7] = read(a); return 13; }
        case 3: set_rp(p, rp(p) + (q ? -1 : 1)); return 6;
        case 4: case 5: {
          const bool inc = z == 4;
          if (y == 6) { const std::uint16_t a = mem(); const int v = read(a); write(a, inc ? inc8(v) : dec8(v)); return idx ? 23 - 4 : 11; }
          set8(y, inc ? inc8(get8(y)) : dec8(get8(y))); return 4;
        }
        case 6:
          if (y == 6) {
            if (idx) { const std::uint16_t a = mem(); write(a, fetch()); return 15; }
            write(hl(), fetch()); return 10;
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
      if (y == 6) { const std::uint16_t a = mem(); write(a, R[z]); return idx ? 15 : 7; }
      if (z == 6) { const std::uint16_t a = mem(); R[y] = read(a); return idx ? 15 : 7; }
      set8(y, get8(z)); return 4;
    case 2:
      if (z == 6) { const std::uint16_t a = mem(); alu(y, read(a)); return idx ? 15 : 7; }
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
            case 1: return z80_cb();
            case 2: { const int n = fetch(); port_out(n | (R[7] << 8), R[7]); return 11; }
            case 3: { const int n = fetch(); R[7] = port_in(n | (R[7] << 8)); return 11; }
            case 4: { const std::uint16_t v = rd16(c_.sp); wr16(c_.sp, get_hl()); set_hl_idx(v); return 19; }
            case 5: { const std::uint16_t d = de(), h = hl(); set_de(h); set_hl(d); return 4; }
            case 6: c_.iff1 = c_.iff2 = 0; return 4;
            default: c_.iff1 = c_.iff2 = 1; c_.ei_wait = 1; return 4;
          }
        case 4: { const std::uint16_t a = fetch16(); if (cond(y)) { push16(c_.pc); c_.pc = a; return 17; } return 10; }
        case 5:
          if (!q) { push16(rp2(p)); return 11; }
          if (p == 0) { const std::uint16_t a = fetch16(); push16(c_.pc); c_.pc = a; return 17; }
          if (p == 2) return z80_ed();
          return 4;   // DD/FD repetido já tratado em z80_step()
        case 6: alu(y, fetch()); return 7;
        default: push16(c_.pc); c_.pc = static_cast<std::uint16_t>(y << 3); return 11;
      }
  }
}

/* prefixo CB (e DDCB/FDCB) */
int SmsMachine::z80_cb() {
  std::uint8_t* R = c_.R; const int idx = c_.idx;
  int a = 0, op;
  if (idx) { const int d = sx8(fetch()); a = ((idx == 1 ? c_.ix : c_.iy) + d) & 0xFFFF; op = fetch(); }   // R não incrementa no 2º opcode
  else { op = fetch(); inc_r(); }
  const int x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const bool memop = idx || z == 6;
  if (!idx && z == 6) a = hl();
  const int v = memop ? read(static_cast<std::uint16_t>(a)) : R[z];
  if (x == 1) {
    const int m = v & (1 << y);
    SETF((c_.f & Z_C) | Z_H | (m ? 0 : (Z_Z | Z_P)) | (y == 7 && m ? Z_S : 0) | (memop ? ((a >> 8) & 0x28) : (v & 0x28)));
    return idx ? 16 : z == 6 ? 12 : 8;
  }
  int r;
  if (x == 0) r = rot(y, v); else if (x == 2) r = v & ~(1 << y); else r = v | (1 << y);
  if (memop) { write(static_cast<std::uint16_t>(a), static_cast<std::uint8_t>(r)); if (idx && z != 6) R[z] = static_cast<std::uint8_t>(r); return idx ? 19 : 15; }
  R[z] = static_cast<std::uint8_t>(r); return 8;
}

/* prefixo ED */
int SmsMachine::z80_ed() {
  std::uint8_t* R = c_.R;
  c_.idx = 0;
  const int op = fetch(); inc_r();
  const int x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  const auto& T = zt();
  if (x == 1) {
    switch (z) {
      case 0: { const std::uint8_t v = port_in(bc()); SETF((c_.f & Z_C) | T.szp[v]); if (y != 6) R[y] = v; return 12; }
      case 1: port_out(bc(), y == 6 ? 0 : R[y]); return 12;
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
          case 4: { const int a = read(hl()), n = R[7]; write(hl(), static_cast<std::uint8_t>(((n & 15) << 4) | (a >> 4))); R[7] = static_cast<std::uint8_t>((n & 0xF0) | (a & 15)); SETF((c_.f & Z_C) | T.szp[R[7]]); return 18; }
          case 5: { const int a = read(hl()), n = R[7]; write(hl(), static_cast<std::uint8_t>(((a << 4) | (n & 15)) & 255)); R[7] = static_cast<std::uint8_t>((n & 0xF0) | (a >> 4)); SETF((c_.f & Z_C) | T.szp[R[7]]); return 18; }
          default: return 8;
        }
    }
  }
  if (x == 2 && y >= 4 && z < 4) return z80_block(y, z);
  return 8;
}

int SmsMachine::z80_block(int y, int z) {
  std::uint8_t* R = c_.R; const bool dec = (y & 1) == 1, rep = y >= 6; const int d = dec ? -1 : 1;
  const auto& T = zt();
  switch (z) {
    case 0: {   // LDI/LDD/LDIR/LDDR
      const int v = read(hl()); write(de(), static_cast<std::uint8_t>(v));
      set_hl(hl() + d); set_de(de() + d); set_bc((bc() - 1) & 0xFFFF);
      const int n = (v + R[7]) & 255;
      SETF((c_.f & (Z_S | Z_Z | Z_C)) | ((n & 2) ? Z_Y : 0) | (n & 8) | (bc() ? Z_P : 0));
      if (rep && bc()) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    case 1: {   // CPI/CPD/CPIR/CPDR
      const int v = read(hl()), a = R[7], r = (a - v) & 255, h = ((a ^ v ^ r) & Z_H) ? 1 : 0;
      set_hl(hl() + d); set_bc((bc() - 1) & 0xFFFF);
      const int n = (r - h) & 255;
      SETF((c_.f & Z_C) | (r & Z_S) | (r == 0 ? Z_Z : 0) | (h ? Z_H : 0) | ((n & 2) ? Z_Y : 0) | (n & 8) | (bc() ? Z_P : 0) | Z_N);
      if (rep && bc() && r != 0) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    case 2: {   // INI/IND/INIR/INDR
      const int v = port_in(bc()); write(hl(), static_cast<std::uint8_t>(v));
      R[0] = static_cast<std::uint8_t>(R[0] - 1); set_hl(hl() + d);
      const int k = v + ((R[1] + d) & 255);
      SETF((R[0] & 0xA8) | (R[0] == 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? (Z_H | Z_C) : 0) | T.par[((k & 7) ^ R[0]) & 255]);
      if (rep && R[0]) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
    default: {  // OUTI/OUTD/OTIR/OTDR
      const int v = read(hl()); R[0] = static_cast<std::uint8_t>(R[0] - 1); port_out(bc(), v); set_hl(hl() + d);
      const int k = v + R[5];
      SETF((R[0] & 0xA8) | (R[0] == 0 ? Z_Z : 0) | ((v & 0x80) ? Z_N : 0) | (k > 255 ? (Z_H | Z_C) : 0) | T.par[((k & 7) ^ R[0]) & 255]);
      if (rep && R[0]) { c_.pc = static_cast<std::uint16_t>(c_.pc - 2); return 21; }
      return 16;
    }
  }
}

/* ====================================================================== vdp.js */

void SmsMachine::vdp_reset() {
  auto& v = v_;
  std::memset(v.vram, 0, sizeof v.vram); std::memset(v.cram, 0, sizeof v.cram); std::memset(v.regs, 0, sizeof v.regs);
  v.regs[0] = 0x04; v.regs[1] = 0x00; v.regs[2] = 0xFF; v.regs[3] = 0xFF; v.regs[4] = 0xFF; v.regs[5] = 0xFF; v.regs[6] = 0xFF; v.regs[10] = 0xFF;
  v.addr = 0; v.code = 0; v.latch = 0; v.low = 0; v.buf = 0;
  v.vint = 0; v.line_irq = 0; v.ovf = 0; v.col = 0;
  v.line = 0; v.line_cnt = 0xFF;
  for (int i = 0; i < 32; i++) vdp_set_pal(i);
  vdp_update_irq();
}

void SmsMachine::vdp_update_irq() {
  const auto& r = v_.regs;
  c_.irq_line = (v_.vint && (r[1] & 0x20)) || (v_.line_irq && (r[0] & 0x10)) ? 1 : 0;
}

void SmsMachine::vdp_set_pal(int i) {
  if (gg_) {
    const int v = v_.cram[i * 2] | (v_.cram[i * 2 + 1] << 8);
    v_.pal[i] = 0xFF000000u | (static_cast<std::uint32_t>(((v >> 8) & 15) * 17) << 16) | (static_cast<std::uint32_t>(((v >> 4) & 15) * 17) << 8) | static_cast<std::uint32_t>((v & 15) * 17);
  } else {
    const int v = v_.cram[i];
    v_.pal[i] = 0xFF000000u | (static_cast<std::uint32_t>(((v >> 4) & 3) * 85) << 16) | (static_cast<std::uint32_t>(((v >> 2) & 3) * 85) << 8) | static_cast<std::uint32_t>((v & 3) * 85);
  }
}

std::uint8_t SmsMachine::vdp_read_data() {
  v_.latch = 0;
  const std::uint8_t r = v_.buf; v_.buf = v_.vram[v_.addr]; v_.addr = (v_.addr + 1) & 0x3FFF;
  return r;
}

void SmsMachine::vdp_write_data(int val) {
  v_.latch = 0;
  if (v_.code == 3) {
    if (gg_) { const int i = v_.addr & 63; v_.cram[i] = static_cast<std::uint8_t>(val); vdp_set_pal(i >> 1); }
    else { const int i = v_.addr & 31; v_.cram[i] = static_cast<std::uint8_t>(val); vdp_set_pal(i); }
  } else v_.vram[v_.addr] = static_cast<std::uint8_t>(val);
  v_.buf = static_cast<std::uint8_t>(val); v_.addr = (v_.addr + 1) & 0x3FFF;
}

std::uint8_t SmsMachine::vdp_read_status() {
  const std::uint8_t r = static_cast<std::uint8_t>((v_.vint ? 0x80 : 0) | (v_.ovf ? 0x40 : 0) | (v_.col ? 0x20 : 0) | 0x1F);
  v_.vint = 0; v_.line_irq = 0; v_.ovf = 0; v_.col = 0; v_.latch = 0;
  vdp_update_irq();
  return r;
}

void SmsMachine::vdp_write_ctrl(int val) {
  auto& v = v_;
  if (!v.latch) { v.low = static_cast<std::uint8_t>(val); v.latch = 1; v.addr = static_cast<std::uint16_t>((v.addr & 0x3F00) | val); return; }
  v.latch = 0; v.code = static_cast<std::uint8_t>(val >> 6); v.addr = static_cast<std::uint16_t>(((val & 0x3F) << 8) | v.low);
  if (v.code == 0) { v.buf = v.vram[v.addr]; v.addr = (v.addr + 1) & 0x3FFF; }
  else if (v.code == 2) {
    const int r = val & 15; v.regs[r] = v.low;
    if (r == 0 || r == 1) vdp_update_irq();
  }
}

int SmsMachine::vdp_vcounter() const { const int l = v_.line; return l <= 0xDA ? l : l - 6; }
int SmsMachine::vdp_hcounter() const { return (static_cast<int>(static_cast<double>(cyc_) * 342.0 / 228.0) >> 1) & 255; }

void SmsMachine::vdp_start_line(int line) {
  auto& v = v_; v.line = line; const auto& r = v.regs;
  if (line <= 192) {
    if (v.line_cnt == 0) { v.line_cnt = r[10]; v.line_irq = 1; } else v.line_cnt--;
  } else v.line_cnt = r[10];
  if (line == 193) v.vint = 1;
  vdp_update_irq();
  if (line < 192) vdp_render_line(line);
}

void SmsMachine::vdp_render_line(int line) {
  const auto& r = v_.regs; const std::uint8_t* vram = v_.vram; const std::uint32_t* pal = v_.pal;
  std::uint32_t* out = frame_.data(); const int o = line * 256;
  const std::uint32_t bd = pal[16 + (r[7] & 15)];
  if (!(r[1] & 0x40)) { for (int x = 0; x < 256; x++) out[o + x] = bd; return; }
  std::uint8_t lb[256 + 16], pb[256 + 16], sm[256 + 16], tp[8];
  // fundo: pixel de tela x mostra o pixel (x - rolagem) do mapa; colunas 24-31 podem ignorar a rolagem vertical
  const int name_base = (r[2] & 0x0E) << 10;
  const int sx = ((r[0] & 0x40) && line < 16) ? 0 : r[8];
  const bool vlock = (r[0] & 0x80) != 0; const int yscroll = r[9];
  int key = -1, tpri = 0;
  for (int x = 0; x < 256; x++) {
    const int mx = (x - sx) & 255, vl = (vlock && x >= 192) ? 1 : 0, k = (mx >> 3) * 2 + vl;
    if (k != key) {
      key = k;
      const int ys = vl ? line : (line + yscroll) % 224, row = ys >> 3, py = ys & 7;
      const int ne = name_base + ((row << 5) + (mx >> 3)) * 2, lo = vram[ne], hi = vram[ne + 1];
      const int tile = lo | ((hi & 1) << 8), hf = hi & 2, vf = hi & 4, pal_off = (hi & 8) ? 16 : 0;
      tpri = (hi & 0x10) ? 1 : 0;
      const int ta = tile * 32 + ((vf ? 7 - py : py) << 2), b0 = vram[ta], b1 = vram[ta + 1], b2 = vram[ta + 2], b3 = vram[ta + 3];
      for (int px = 0; px < 8; px++) {
        const int bit = hf ? px : 7 - px;
        tp[px] = static_cast<std::uint8_t>((((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3)) + pal_off);
      }
    }
    const int c = tp[mx & 7]; lb[x] = static_cast<std::uint8_t>(c); pb[x] = (tpri && (c & 15)) ? 1 : 0;
  }
  // sprites
  std::memset(sm, 0, 256);
  const bool tall = (r[1] & 2) != 0, zoom = (r[1] & 1) != 0; const int h = (tall ? 16 : 8) * (zoom ? 2 : 1);
  const int sat = (r[5] & 0x7E) << 7, tile_bank = (r[6] & 4) ? 256 : 0, shift = (r[0] & 8) ? 8 : 0;
  int n = 0; std::uint8_t list[8];
  for (int i = 0; i < 64; i++) {
    const int y = vram[sat + i];
    if (y == 0xD0) break;
    const int top = (y + 1) & 255, dy = (line - top) & 255;
    if (dy < h) { if (n < 8) list[n++] = static_cast<std::uint8_t>(i); else { v_.ovf = 1; break; } }
  }
  // em ordem de índice: o primeiro sprite a pintar um pixel vence; dois sprites no mesmo pixel marcam colisão
  std::uint8_t used[256]; std::memset(used, 0, sizeof used);
  for (int k = 0; k < n; k++) {
    const int i = list[k], y = vram[sat + i], xx = vram[sat + 0x80 + i * 2] - shift, tn = vram[sat + 0x81 + i * 2];
    int row = (line - ((y + 1) & 255)) & 255; if (zoom) row >>= 1;
    int tile = tn | tile_bank; if (tall) tile = (tile & ~1) | (row >> 3);
    const int ta = tile * 32 + ((row & 7) << 2), b0 = vram[ta], b1 = vram[ta + 1], b2 = vram[ta + 2], b3 = vram[ta + 3];
    const int w = zoom ? 16 : 8;
    for (int px = 0; px < w; px++) {
      const int x = xx + px; if (x < 0 || x > 255) continue;
      const int bit = 7 - (zoom ? px >> 1 : px);
      const int c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
      if (!c) continue;
      if (used[x]) { v_.col = 1; continue; }
      used[x] = 1;
      if (pb[x]) continue;   // fundo com prioridade cobre o sprite
      sm[x] = static_cast<std::uint8_t>(c + 16 + 1);   // +1 para distinguir de 0
    }
  }
  const bool mask = (r[0] & 0x20) != 0;
  for (int x = 0; x < 256; x++) {
    std::uint32_t c;
    if (mask && x < 8) c = bd;
    else if (sm[x]) c = pal[sm[x] - 1];
    else c = pal[lb[x]];
    out[o + x] = c;
  }
}

/* ====================================================================== psg.js */

void SmsMachine::set_audio_rate(unsigned rate) { cps_ = kPsgClock / (rate ? rate : 44100); }

void SmsMachine::psg_reset() {
  auto& p = p_;
  for (int i = 0; i < 3; i++) { p.freq[i] = 0; p.cnt[i] = 1; p.out[i] = 1; }
  for (int i = 0; i < 4; i++) p.att[i] = 15;
  p.noise_ctl = 0; p.noise_cnt = 1; p.noise_flip = 0; p.lfsr = 0x8000; p.noise_out = 0;
  p.latch_ch = 0; p.latch_type = 0; p.clk = 0; p.acc = 0; p.n = 0; p.cyc = 0;
}

void SmsMachine::psg_write(int v) {
  auto& p = p_;
  if (v & 0x80) {
    p.latch_ch = (v >> 5) & 3; p.latch_type = (v >> 4) & 1;
    if (p.latch_type) p.att[p.latch_ch] = v & 15;
    else if (p.latch_ch < 3) p.freq[p.latch_ch] = (p.freq[p.latch_ch] & 0x3F0) | (v & 15);
    else { p.noise_ctl = v & 7; p.lfsr = 0x8000; }
  } else {
    if (p.latch_type) p.att[p.latch_ch] = v & 15;
    else if (p.latch_ch < 3) p.freq[p.latch_ch] = (p.freq[p.latch_ch] & 15) | ((v & 0x3F) << 4);
    else { p.noise_ctl = v & 7; p.lfsr = 0x8000; }
  }
}

void SmsMachine::psg_tick(int c) {
  p_.clk += c;
  while (p_.clk >= 16) { p_.clk -= 16; psg_step(); }
}

void SmsMachine::psg_step() {
  auto& p = p_;
  for (int i = 0; i < 3; i++) {
    if (--p.cnt[i] <= 0) {
      const int f = p.freq[i]; p.cnt[i] = f;
      if (f < 2) p.out[i] = 1; else p.out[i] ^= 1;
    }
  }
  if (--p.noise_cnt <= 0) {
    const int r = p.noise_ctl & 3;
    p.noise_cnt = r == 0 ? 16 : r == 1 ? 32 : r == 2 ? 64 : (p.freq[2] ? p.freq[2] : 1);
    p.noise_flip ^= 1;
    if (p.noise_flip) {
      const int fb = (p.noise_ctl & 4) ? ((p.lfsr & 1) ^ ((p.lfsr >> 3) & 1)) : (p.lfsr & 1);
      p.lfsr = (p.lfsr >> 1) | (fb << 15); p.noise_out = p.lfsr & 1;
    }
  }
  double s = 0;
  for (int i = 0; i < 3; i++) s += (p.out[i] ? 1 : -1) * kPsgVol[p.att[i]];
  s += (p.noise_out ? 1 : -1) * kPsgVol[p.att[3]];
  p.acc += s; p.n++;
  p.cyc += 16;
  if (p.cyc >= cps_) { p.cyc -= cps_; psg_push(p.acc / p.n * 0.22); p.acc = 0; p.n = 0; }
}

void SmsMachine::psg_push(double s) {
  auto& p = p_;
  const double y = s - p.px + 0.996 * p.py; p.px = s; p.py = y;
  if (p.wp - p.rp >= kAudioSize) p.rp++;
  abuf_[p.wp & (kAudioSize - 1)] = static_cast<float>(y * volume_); p.wp++;
}

void SmsMachine::fill_audio(float* out, std::size_t n) {
  for (std::size_t i = 0; i < n; i++) {
    if (p_.rp < p_.wp) { p_.last = abuf_[p_.rp & (kAudioSize - 1)]; p_.rp++; } else p_.last *= 0.995;
    out[i] = static_cast<float>(p_.last);
  }
}

}  // namespace emuhub
