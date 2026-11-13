#include "gb_machine.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <ctime>

namespace emuhub {
namespace {
const std::uint8_t kCyc[256] = {
  4, 12, 8, 8, 4, 4, 8, 4, 20, 8, 8, 8, 4, 4, 8, 4,  4, 12, 8, 8, 4, 4, 8, 4, 12, 8, 8, 8, 4, 4, 8, 4,
  8, 12, 8, 8, 4, 4, 8, 4, 8, 8, 8, 8, 4, 4, 8, 4,  8, 12, 8, 8, 12, 12, 12, 4, 8, 8, 8, 8, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  8, 8, 8, 8, 8, 8, 4, 8, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,  4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 8, 4,
  8, 12, 12, 16, 12, 16, 8, 16, 8, 16, 12, 4, 12, 24, 8, 16,  8, 12, 12, 4, 12, 16, 8, 16, 8, 16, 12, 4, 12, 4, 8, 16,
  12, 12, 8, 4, 4, 16, 8, 16, 16, 4, 16, 4, 4, 4, 8, 16,  12, 12, 8, 4, 4, 16, 8, 16, 12, 8, 16, 4, 4, 4, 8, 16};
const std::uint32_t dmg_[4] = {0xFFD0F8E0, 0xFF70C088, 0xFF566834, 0xFF201808};
const int kDuty[4][8] = {{0, 0, 0, 0, 0, 0, 0, 1}, {1, 0, 0, 0, 0, 0, 0, 1}, {1, 0, 0, 0, 0, 1, 1, 1}, {0, 1, 1, 1, 1, 1, 1, 0}};
const int kNoiseDiv[8] = {8, 16, 32, 48, 64, 80, 96, 112};
std::uint32_t g_lut[32768];
const bool g_lut_init = [] {
  for (int i = 0; i < 32768; i++) {
    const int r = i & 31, g = (i >> 5) & 31, b = (i >> 10) & 31;
    const int R = std::min(255, (r * 13 + g * 2 + b) >> 1), G = std::min(255, (g * 3 + b) << 1), B = std::min(255, (r * 3 + g * 2 + b * 11) >> 1);
    g_lut[i] = 0xFF000000u | (static_cast<std::uint32_t>(B) << 16) | (static_cast<std::uint32_t>(G) << 8) | static_cast<std::uint32_t>(R);
  }
  return true;
}();
inline int s8(std::uint8_t v) { return static_cast<std::int8_t>(v); }
}  // namespace

GbMachine::GbMachine() { (void)g_lut_init; rom_.assign(0x8000, 0); ram_.clear(); ppu_reset(); apu_reset(); }

/* ================= carga / reset ================= */
GbError GbMachine::load_rom(const std::uint8_t* data, std::size_t size, bool force_dmg) {
  loaded_ = false;
  if (size < 0x150) return GbError::TooSmall;
  std::size_t n = 0x8000; while (n < size) n <<= 1;
  rom_.assign(n, 0); std::memcpy(rom_.data(), data, size); rom_mask_ = static_cast<std::uint32_t>(n - 1);
  const int t = data[0x147];
  cart_.type = t; cart_.rom_banks = static_cast<int>(n >> 14);
  static const int mbc_tab[31] = {0, 1, 1, 1, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5};
  cart_.mbc = t < 31 ? mbc_tab[t] : 0;
  if (t >= 0x19 && t <= 0x1E) cart_.mbc = 5;
  if (t == 0xFF) cart_.mbc = 1;
  cart_.battery = t == 3 || t == 6 || t == 9 || t == 0x0F || t == 0x10 || t == 0x13 || t == 0x1B || t == 0x1E || t == 0xFF;
  cart_.rtc = t == 0x0F || t == 0x10;
  if (t == 0x20 || t == 0x22 || t == 0xFC || t == 0xFD || t == 0xFE) return GbError::Unsupported;
  static const std::uint32_t ram_tab[6] = {0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000};
  const std::uint32_t rs = data[0x149] < 6 ? ram_tab[data[0x149]] : 0;
  const std::uint32_t ram_size = cart_.mbc == 2 ? 512 : rs;
  ram_.assign(ram_size, 0); ram_mask_ = ram_size ? ram_size - 1 : 0;
  cart_.ram_banks = std::max<int>(1, static_cast<int>(ram_size >> 13));
  cgb_ = !force_dmg && (data[0x143] & 0x80) != 0;
  loaded_ = true;
  reset();
  return GbError::Ok;
}

void GbMachine::reset() {
  ram_en_ = false; rom_bank_ = 1; ram_bank_ = 0; mode_ = 0; upper_ = 0; rtc_sel_ = 0; rom_off1_ = 0x4000; rom_off0_ = 0; ram_off_ = 0;
  ifl_ = 0xE1; ie_ = 0; divc_ = 0; tima_ = tma_ = tac_ = 0; joy_sel_ = 0x30; wbank_ = 1; double_speed_ = speed_armed_ = false; extra_ = 0;
  wram_.fill(0); hram_.fill(0); io_.fill(0); sb_ = sc_ = 0; hdma_ = Hdma{};
  ppu_reset(); apu_reset(); vram_.fill(0); oam_.fill(0);
  if (cgb_) { bg_pal_.fill(0xFF); ob_pal_.fill(0xFF); for (int i = 0; i < 32; i++) bg_col_[i] = ob_col_[i] = g_lut[0x7FFF]; }
  Cpu& c = cpu_;
  c.ime = 0; c.ime_next = 0; c.halted = false; c.halt_bug = false; c.pc = 0x100; c.sp = 0xFFFE;
  if (cgb_) { c.a = 0x11; set_f(0x80); c.b = 0; c.c = 0; c.d = 0xFF; c.e = 0x56; c.h = 0; c.l = 0x0D; }
  else { c.a = 0x01; set_f(0xB0); c.b = 0; c.c = 0x13; c.d = 0; c.e = 0xD8; c.h = 0x01; c.l = 0x4D; }
  apu_write(0xFF26, 0x80);
  static const std::uint16_t ai[][2] = {{0xFF10, 0x80}, {0xFF11, 0xBF}, {0xFF12, 0xF3}, {0xFF14, 0xBF}, {0xFF16, 0x3F}, {0xFF17, 0}, {0xFF19, 0xBF}, {0xFF1A, 0x7F}, {0xFF1B, 0xFF},
    {0xFF1C, 0x9F}, {0xFF1E, 0xBF}, {0xFF20, 0xFF}, {0xFF21, 0}, {0xFF22, 0}, {0xFF23, 0xBF}, {0xFF24, 0x77}, {0xFF25, 0xF3}};
  for (auto& p : ai) apu_write(p[0], static_cast<std::uint8_t>(p[1]));
  p1_.on = p2_.on = false;
  lcdc_ = 0x91; mode_ppu_ = 2; ly_ = 0; cyc_ = 0;
  update_banks();
}

GbMachine::Regs GbMachine::regs() const {
  return {cpu_.a, cpu_.b, cpu_.c, cpu_.d, cpu_.e, cpu_.h, cpu_.l, cpu_.sp, cpu_.pc, cpu_.z != 0, cpu_.n != 0, cpu_.hc != 0, cpu_.cy != 0};
}

void GbMachine::set_buttons(std::uint16_t m) {
  const std::uint8_t old = buttons_; buttons_ = m & 0xFF;
  if (buttons_ & ~old) ifl_ |= 16;
}

/* ================= cartucho ================= */
void GbMachine::update_banks() {
  const int nb = cart_.rom_banks; int b0 = 0, b1;
  switch (cart_.mbc) {
    case 1:
      b1 = (upper_ << 5) | (rom_bank_ & 31); if ((rom_bank_ & 31) == 0) b1 |= 1;
      if (mode_) b0 = upper_ << 5;
      ram_off_ = static_cast<std::uint32_t>((mode_ ? upper_ : 0) << 13); break;
    case 2: b1 = (rom_bank_ & 15) ? (rom_bank_ & 15) : 1; break;
    case 3: b1 = (rom_bank_ & 127) ? (rom_bank_ & 127) : 1; ram_off_ = static_cast<std::uint32_t>((ram_bank_ & 3) << 13); break;
    case 5: b1 = rom_bank_ & 0x1FF; ram_off_ = static_cast<std::uint32_t>((ram_bank_ & 15) << 13); break;
    default: b1 = 1;
  }
  rom_off0_ = static_cast<std::uint32_t>((b0 % nb) << 14); rom_off1_ = static_cast<std::uint32_t>((b1 % nb) << 14);
}

std::int64_t GbMachine::now() const { return static_cast<std::int64_t>(std::time(nullptr)); }

void GbMachine::rtc_now(std::uint8_t out[5]) const {
  std::int64_t sec = rtc_.halt ? rtc_.halt_at : now(); std::int64_t d = std::max<std::int64_t>(0, sec - rtc_.base);
  out[0] = d % 60; d /= 60; out[1] = d % 60; d /= 60; out[2] = d % 24; d /= 24;
  out[3] = d & 255; out[4] = static_cast<std::uint8_t>(((d >> 8) & 1) | (d > 511 ? 0x80 : 0) | (rtc_.halt ? 0x40 : 0));
}

void GbMachine::rtc_write(int sel, std::uint8_t v) {
  std::uint8_t cur[5]; rtc_now(cur); const int i = sel - 8; cur[i] = v;
  if (i == 4) { const bool was = rtc_.halt; rtc_.halt = (v & 0x40) != 0; if (rtc_.halt && !was) rtc_.halt_at = now(); }
  const std::int64_t d = ((cur[4] & 1) << 8) | cur[3];
  const std::int64_t total = cur[0] + cur[1] * 60 + cur[2] * 3600 + d * 86400;
  if (rtc_.halt && !rtc_.halt_at) rtc_.halt_at = now();
  const std::int64_t n = rtc_.halt ? rtc_.halt_at : now();
  rtc_.base = n - total;
}

void GbMachine::mbc_write(std::uint16_t a, std::uint8_t v) {
  switch (cart_.mbc) {
    case 1:
      if (a < 0x2000) ram_en_ = (v & 15) == 0x0A; else if (a < 0x4000) rom_bank_ = v & 31; else if (a < 0x6000) upper_ = v & 3; else mode_ = v & 1; break;
    case 2:
      if (a < 0x4000) { if (a & 0x100) rom_bank_ = v & 15; else ram_en_ = (v & 15) == 0x0A; } break;
    case 3:
      if (a < 0x2000) ram_en_ = (v & 15) == 0x0A; else if (a < 0x4000) rom_bank_ = v & 127;
      else if (a < 0x6000) { rtc_sel_ = v; ram_bank_ = v & 3; }
      else { if (rtc_.latch == 0 && v == 1) rtc_now(rtc_.latched); rtc_.latch = v; } break;
    case 5:
      if (a < 0x2000) ram_en_ = (v & 15) == 0x0A; else if (a < 0x3000) rom_bank_ = (rom_bank_ & 0x100) | v;
      else if (a < 0x4000) rom_bank_ = (rom_bank_ & 0xFF) | ((v & 1) << 8); else if (a < 0x6000) ram_bank_ = v & 15; break;
  }
  update_banks();
}

/* ================= barramento ================= */
std::uint8_t GbMachine::read_ram(std::uint16_t a) {
  if (!ram_en_) return 0xFF;
  if (cart_.mbc == 2) return ram_[a & 0x1FF] | 0xF0;
  if (cart_.mbc == 3 && rtc_sel_ >= 8) return rtc_sel_ <= 0x0C ? rtc_.latched[rtc_sel_ - 8] : 0xFF;
  if (!ram_mask_) return 0xFF;
  return ram_[(ram_off_ | (a & 0x1FFF)) & ram_mask_];
}

void GbMachine::set_dmg_palette(int i) {
  static const std::uint32_t P[4][4] = {
    {0xFFD0F8E0, 0xFF70C088, 0xFF566834, 0xFF201808}, {0xFFFFFFFF, 0xFFAAAAAA, 0xFF555555, 0xFF000000},
    {0xFF8FCDC4, 0xFF5BA37A, 0xFF3B6B3A, 0xFF1D3B22}, {0xFFB8E0E8, 0xFF9BB9A8, 0xFF5E7A5A, 0xFF2E4030}};
  for (int k = 0; k < 4; k++) dmg_[k] = P[(i >= 0 && i < 4) ? i : 0][k];
}

std::uint8_t GbMachine::gg(std::uint16_t a, std::uint8_t v) const {
  for (const auto& g : gg_) if (g.addr == a && (g.cmp < 0 || g.cmp == v)) return g.val;
  return v;
}

std::uint8_t GbMachine::read(std::uint16_t a) {
  switch (a >> 12) {
    case 0: case 1: case 2: case 3: { const std::uint8_t v = rom_[(rom_off0_ | (a & 0x3FFF)) & rom_mask_]; return gg_.empty() ? v : gg(a, v); }
    case 4: case 5: case 6: case 7: { const std::uint8_t v = rom_[(rom_off1_ | (a & 0x3FFF)) & rom_mask_]; return gg_.empty() ? v : gg(a, v); }
    case 8: case 9: return vram_[((vbk_ & (cgb_ ? 1 : 0)) << 13) | (a & 0x1FFF)];
    case 10: case 11: return read_ram(a);
    case 12: return wram_[a & 0xFFF];
    case 13: return wram_[(cgb_ ? wbank_ << 12 : 0x1000) | (a & 0xFFF)];
    case 14: return wram_[a & 0xFFF];
    default:
      if (a < 0xFE00) return wram_[(cgb_ ? wbank_ << 12 : 0x1000) | (a & 0xFFF)];
      if (a < 0xFEA0) return oam_[a - 0xFE00];
      if (a < 0xFF00) return 0xFF;
      if (a < 0xFF80) return read_io(a);
      if (a == 0xFFFF) return ie_;
      return hram_[a - 0xFF80];
  }
}

void GbMachine::write(std::uint16_t a, std::uint8_t v) {
  switch (a >> 12) {
    case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7: mbc_write(a, v); return;
    case 8: case 9: vram_[((vbk_ & (cgb_ ? 1 : 0)) << 13) | (a & 0x1FFF)] = v; return;
    case 10: case 11:
      if (!ram_en_) return;
      if (cart_.mbc == 2) { ram_[a & 0x1FF] = v & 15; return; }
      if (cart_.mbc == 3 && rtc_sel_ >= 8) { if (rtc_sel_ <= 0x0C) rtc_write(rtc_sel_, v); return; }
      if (ram_mask_) ram_[(ram_off_ | (a & 0x1FFF)) & ram_mask_] = v;
      return;
    case 12: wram_[a & 0xFFF] = v; return;
    case 13: wram_[(cgb_ ? wbank_ << 12 : 0x1000) | (a & 0xFFF)] = v; return;
    case 14: wram_[a & 0xFFF] = v; return;
    default:
      if (a < 0xFE00) { wram_[(cgb_ ? wbank_ << 12 : 0x1000) | (a & 0xFFF)] = v; return; }
      if (a < 0xFEA0) { oam_[a - 0xFE00] = v; return; }
      if (a < 0xFF00) return;
      if (a < 0xFF80) { write_io(a, v); return; }
      if (a == 0xFFFF) { ie_ = v; return; }
      hram_[a - 0xFF80] = v;
  }
}

std::uint8_t GbMachine::read_io(std::uint16_t a) {
  switch (a) {
    case 0xFF00: {
      const int b = buttons_, sel = joy_sel_; int low = 15;
      if (!(sel & 0x10)) { if (b & 128) low &= ~1; if (b & 64) low &= ~2; if (b & 16) low &= ~4; if (b & 32) low &= ~8; }
      if (!(sel & 0x20)) { if (b & 1) low &= ~1; if (b & 2) low &= ~2; if (b & 4) low &= ~4; if (b & 8) low &= ~8; }
      return static_cast<std::uint8_t>(0xC0 | sel | low);
    }
    case 0xFF01: return sb_; case 0xFF02: return 0x7E | sc_;
    case 0xFF04: return (divc_ >> 8) & 255;
    case 0xFF05: return tima_; case 0xFF06: return tma_; case 0xFF07: return 0xF8 | tac_;
    case 0xFF0F: return 0xE0 | ifl_;
    case 0xFF4D: return cgb_ ? static_cast<std::uint8_t>((double_speed_ ? 0x80 : 0) | 0x7E | (speed_armed_ ? 1 : 0)) : 0xFF;
    case 0xFF55: return cgb_ ? (hdma_.active ? static_cast<std::uint8_t>((hdma_.len - 1) & 0x7F) : 0xFF) : 0xFF;
    case 0xFF70: return cgb_ ? static_cast<std::uint8_t>(0xF8 | wbank_) : 0xFF;
  }
  if (a >= 0xFF10 && a < 0xFF40) return apu_read(a);
  if (a >= 0xFF40 && a <= 0xFF4B) { if (a == 0xFF46) return 0xFF; return ppu_read(a); }
  if (a >= 0xFF4F && a <= 0xFF6B && (a == 0xFF4F || a >= 0xFF68)) return ppu_read(a);
  return io_[a - 0xFF00];
}

void GbMachine::write_io(std::uint16_t a, std::uint8_t v) {
  switch (a) {
    case 0xFF00: joy_sel_ = v & 0x30; return;
    case 0xFF01: sb_ = v; return;
    case 0xFF02: sc_ = v & 1; if ((v & 0x81) == 0x81) { sb_ = 0xFF; ifl_ |= 8; } return;
    case 0xFF04: divc_ = 0; return;
    case 0xFF05: tima_ = v; return; case 0xFF06: tma_ = v; return; case 0xFF07: tac_ = v & 7; return;
    case 0xFF0F: ifl_ = v & 0x1F; return;
    case 0xFF46: { const int s = v << 8; for (int i = 0; i < 160; i++) oam_[i] = read(static_cast<std::uint16_t>(s + i)); return; }
    case 0xFF4D: if (cgb_) speed_armed_ = (v & 1) != 0; return;
    case 0xFF51: hdma_.src = (hdma_.src & 0xFF) | (v << 8); return;
    case 0xFF52: hdma_.src = (hdma_.src & 0xFF00) | (v & 0xF0); return;
    case 0xFF53: hdma_.dst = (hdma_.dst & 0xFF) | ((v & 0x1F) << 8); return;
    case 0xFF54: hdma_.dst = (hdma_.dst & 0xFF00) | (v & 0xF0); return;
    case 0xFF55: if (cgb_) hdma_write(v); return;
    case 0xFF70: if (cgb_) wbank_ = (v & 7) ? (v & 7) : 1; return;
  }
  if (a >= 0xFF10 && a < 0xFF40) { apu_write(a, v); return; }
  if (a >= 0xFF40 && a <= 0xFF4B) { ppu_write(a, v); return; }
  if (a == 0xFF4F || (a >= 0xFF68 && a <= 0xFF6B)) { ppu_write(a, v); return; }
  io_[a - 0xFF00] = v;
}

void GbMachine::hdma_write(std::uint8_t v) {
  if (hdma_.active && !(v & 0x80)) { hdma_.active = false; return; }
  hdma_.len = (v & 0x7F) + 1;
  if (v & 0x80) { hdma_.active = true; if (mode_ppu_ == 0 || !(lcdc_ & 0x80)) hdma_step(); return; }
  while (hdma_.len > 0) { hdma_block(); hdma_.len--; }
  extra_ += 8 * (v & 0x7F) * 2 + 16; hdma_.active = false;
}
void GbMachine::hdma_block() {
  const int bank = (vbk_ & 1) << 13;
  for (int i = 0; i < 16; i++) vram_[bank | ((hdma_.dst + i) & 0x1FFF)] = read(static_cast<std::uint16_t>((hdma_.src + i) & 0xFFFF));
  hdma_.src = (hdma_.src + 16) & 0xFFFF; hdma_.dst = (hdma_.dst + 16) & 0x1FFF;
}
void GbMachine::hdma_step() {
  if (!hdma_.active) return;
  hdma_block(); hdma_.len--; extra_ += 8;
  if (hdma_.len <= 0) { hdma_.active = false; hdma_.len = 0; }
}

void GbMachine::timer_tick(int c) {
  const std::uint32_t old = divc_; divc_ += static_cast<std::uint32_t>(c);
  if (divc_ > 0x40000000u) divc_ -= 0x10000000u;
  if (tac_ & 4) {
    static const int sh_tab[4] = {10, 4, 6, 8}; const int sh = sh_tab[tac_ & 3];
    std::int64_t edges = (static_cast<std::int64_t>(divc_) >> sh) - (static_cast<std::int64_t>(old) >> sh);
    if (divc_ < old) edges = ((static_cast<std::int64_t>(divc_) + 0x10000000) >> sh) - (static_cast<std::int64_t>(old) >> sh);
    if (edges > 0) {
      std::int64_t t = tima_ + edges;
      while (t > 255) { t = tma_ + (t - 256); ifl_ |= 4; }
      tima_ = static_cast<std::uint8_t>(t);
    }
  }
}

/* ================= laço principal ================= */
bool GbMachine::run_frame() {
  if (!loaded_) return false;
  frame_done_ = false; int cycles = 0, rem = 0;
  while (!frame_done_ && cycles < static_cast<int>(kFrameCycles) * 2) {
    const int c = cpu_step() + extra_; extra_ = 0;
    cycles += c; timer_tick(c);
    int d = c; if (double_speed_) { d += rem; rem = d & 1; d >>= 1; }
    ppu_tick(d); apu_tick(d);
  }
  return true;
}

/* ================= CPU ================= */
std::uint8_t GbMachine::fetch() { const std::uint8_t v = read(cpu_.pc); cpu_.pc++; return v; }
std::uint16_t GbMachine::fetch16() { const std::uint16_t l = fetch(); return static_cast<std::uint16_t>(l | (fetch() << 8)); }
void GbMachine::push(std::uint16_t v) { cpu_.sp--; write(cpu_.sp, v >> 8); cpu_.sp--; write(cpu_.sp, v & 255); }
std::uint16_t GbMachine::pop() { const std::uint16_t l = read(cpu_.sp); cpu_.sp++; const std::uint16_t h = read(cpu_.sp); cpu_.sp++; return static_cast<std::uint16_t>(l | (h << 8)); }
std::uint8_t GbMachine::get_r(int i) {
  switch (i) { case 0: return cpu_.b; case 1: return cpu_.c; case 2: return cpu_.d; case 3: return cpu_.e; case 4: return cpu_.h; case 5: return cpu_.l;
    case 6: return read(static_cast<std::uint16_t>((cpu_.h << 8) | cpu_.l)); default: return cpu_.a; }
}
void GbMachine::set_r(int i, std::uint8_t v) {
  switch (i) { case 0: cpu_.b = v; break; case 1: cpu_.c = v; break; case 2: cpu_.d = v; break; case 3: cpu_.e = v; break; case 4: cpu_.h = v; break; case 5: cpu_.l = v; break;
    case 6: write(static_cast<std::uint16_t>((cpu_.h << 8) | cpu_.l), v); break; default: cpu_.a = v; }
}
std::uint16_t GbMachine::get_rr(int i) const {
  switch (i) { case 0: return static_cast<std::uint16_t>((cpu_.b << 8) | cpu_.c); case 1: return static_cast<std::uint16_t>((cpu_.d << 8) | cpu_.e);
    case 2: return static_cast<std::uint16_t>((cpu_.h << 8) | cpu_.l); default: return cpu_.sp; }
}
void GbMachine::set_rr(int i, std::uint16_t v) {
  switch (i) { case 0: cpu_.b = v >> 8; cpu_.c = v & 255; break; case 1: cpu_.d = v >> 8; cpu_.e = v & 255; break; case 2: cpu_.h = v >> 8; cpu_.l = v & 255; break; default: cpu_.sp = v; }
}
bool GbMachine::cond(int i) const { switch (i) { case 0: return !cpu_.z; case 1: return cpu_.z; case 2: return !cpu_.cy; default: return cpu_.cy; } }
void GbMachine::alu(int k, std::uint8_t v) {
  Cpu& c = cpu_; const int a = c.a; int r;
  switch (k) {
    case 0: r = a + v; c.hc = ((a & 15) + (v & 15)) > 15; c.cy = r > 255; c.n = 0; c.a = r & 255; c.z = c.a == 0; break;
    case 1: { const int cy = c.cy; r = a + v + cy; c.hc = ((a & 15) + (v & 15) + cy) > 15; c.cy = r > 255; c.n = 0; c.a = r & 255; c.z = c.a == 0; break; }
    case 2: r = a - v; c.hc = (a & 15) < (v & 15); c.cy = r < 0; c.n = 1; c.a = r & 255; c.z = c.a == 0; break;
    case 3: { const int cy = c.cy; r = a - v - cy; c.hc = ((a & 15) - (v & 15) - cy) < 0; c.cy = r < 0; c.n = 1; c.a = r & 255; c.z = c.a == 0; break; }
    case 4: c.a = a & v; c.z = c.a == 0; c.n = 0; c.hc = 1; c.cy = 0; break;
    case 5: c.a = a ^ v; c.z = c.a == 0; c.n = 0; c.hc = 0; c.cy = 0; break;
    case 6: c.a = a | v; c.z = c.a == 0; c.n = 0; c.hc = 0; c.cy = 0; break;
    default: r = a - v; c.hc = (a & 15) < (v & 15); c.cy = r < 0; c.n = 1; c.z = (r & 255) == 0;
  }
}
std::uint8_t GbMachine::inc8(std::uint8_t v) { const std::uint8_t r = v + 1; cpu_.z = r == 0; cpu_.n = 0; cpu_.hc = (v & 15) == 15; return r; }
std::uint8_t GbMachine::dec8(std::uint8_t v) { const std::uint8_t r = v - 1; cpu_.z = r == 0; cpu_.n = 1; cpu_.hc = (v & 15) == 0; return r; }
void GbMachine::add_hl(std::uint16_t v) {
  const int hl = (cpu_.h << 8) | cpu_.l, r = hl + v; cpu_.n = 0; cpu_.hc = ((hl & 0xFFF) + (v & 0xFFF)) > 0xFFF; cpu_.cy = r > 0xFFFF; cpu_.h = (r >> 8) & 255; cpu_.l = r & 255;
}
std::uint16_t GbMachine::sp_off(int e) {
  const int sp = cpu_.sp; const std::uint16_t r = static_cast<std::uint16_t>(sp + e);
  cpu_.z = 0; cpu_.n = 0; cpu_.hc = ((sp & 15) + (e & 15)) > 15; cpu_.cy = ((sp & 255) + (e & 255)) > 255; return r;
}
void GbMachine::daa() {
  int a = cpu_.a;
  if (!cpu_.n) { if (cpu_.cy || a > 0x99) { a += 0x60; cpu_.cy = 1; } if (cpu_.hc || (a & 15) > 9) a += 6; }
  else { if (cpu_.cy) a -= 0x60; if (cpu_.hc) a -= 6; }
  cpu_.a = a & 255; cpu_.z = cpu_.a == 0; cpu_.hc = 0;
}
int GbMachine::cb_op() {
  const int op = fetch(), r = op & 7, k = op >> 6, bit = (op >> 3) & 7;
  int v = get_r(r); const int cyc = r == 6 ? 16 : 8;
  if (k == 1) { cpu_.z = ((v >> bit) & 1) ? 0 : 1; cpu_.n = 0; cpu_.hc = 1; return r == 6 ? 12 : 8; }
  if (k == 2) { v &= ~(1 << bit); set_r(r, v); return cyc; }
  if (k == 3) { v |= 1 << bit; set_r(r, v); return cyc; }
  int o;
  switch (bit) {
    case 0: o = ((v << 1) | (v >> 7)) & 255; cpu_.cy = v >> 7; break;
    case 1: o = ((v >> 1) | (v << 7)) & 255; cpu_.cy = v & 1; break;
    case 2: o = ((v << 1) | cpu_.cy) & 255; cpu_.cy = v >> 7; break;
    case 3: o = ((v >> 1) | (cpu_.cy << 7)) & 255; cpu_.cy = v & 1; break;
    case 4: o = (v << 1) & 255; cpu_.cy = v >> 7; break;
    case 5: o = (v >> 1) | (v & 0x80); cpu_.cy = v & 1; break;
    case 6: o = ((v << 4) | (v >> 4)) & 255; cpu_.cy = 0; break;
    default: o = v >> 1; cpu_.cy = v & 1;
  }
  cpu_.z = o == 0; cpu_.n = 0; cpu_.hc = 0; set_r(r, static_cast<std::uint8_t>(o)); return cyc;
}

int GbMachine::cpu_step() {
  Cpu& c = cpu_;
  const int pend = ifl_ & ie_ & 0x1F;
  if (c.halted) { if (pend) c.halted = false; else return 4; }
  if (c.ime && pend) {
    for (int i = 0; i < 5; i++) if (pend & (1 << i)) { ifl_ &= ~(1 << i); c.ime = 0; push(c.pc); c.pc = static_cast<std::uint16_t>(0x40 + i * 8); return 20; }
  }
  if (c.ime_next) { c.ime = 1; c.ime_next = 0; }
  const int op = read(c.pc);
  if (c.halt_bug) c.halt_bug = false; else c.pc++;
  int cyc = kCyc[op];
  switch (op) {
    case 0x00: break;
    case 0x01: case 0x11: case 0x21: case 0x31: set_rr(op >> 4, fetch16()); break;
    case 0x02: write(static_cast<std::uint16_t>((c.b << 8) | c.c), c.a); break;
    case 0x12: write(static_cast<std::uint16_t>((c.d << 8) | c.e), c.a); break;
    case 0x22: { const std::uint16_t hl = get_rr(2); write(hl, c.a); set_rr(2, hl + 1); break; }
    case 0x32: { const std::uint16_t hl = get_rr(2); write(hl, c.a); set_rr(2, hl - 1); break; }
    case 0x03: case 0x13: case 0x23: case 0x33: set_rr(op >> 4, get_rr(op >> 4) + 1); break;
    case 0x0B: case 0x1B: case 0x2B: case 0x3B: set_rr(op >> 4, get_rr(op >> 4) - 1); break;
    case 0x04: case 0x0C: case 0x14: case 0x1C: case 0x24: case 0x2C: case 0x34: case 0x3C: { const int r = (op >> 3) & 7; set_r(r, inc8(get_r(r))); break; }
    case 0x05: case 0x0D: case 0x15: case 0x1D: case 0x25: case 0x2D: case 0x35: case 0x3D: { const int r = (op >> 3) & 7; set_r(r, dec8(get_r(r))); break; }
    case 0x06: case 0x0E: case 0x16: case 0x1E: case 0x26: case 0x2E: case 0x36: case 0x3E: set_r((op >> 3) & 7, fetch()); break;
    case 0x07: c.cy = c.a >> 7; c.a = ((c.a << 1) | c.cy) & 255; c.z = 0; c.n = 0; c.hc = 0; break;
    case 0x0F: c.cy = c.a & 1; c.a = ((c.a >> 1) | (c.cy << 7)) & 255; c.z = 0; c.n = 0; c.hc = 0; break;
    case 0x17: { const int cy = c.cy; c.cy = c.a >> 7; c.a = ((c.a << 1) | cy) & 255; c.z = 0; c.n = 0; c.hc = 0; break; }
    case 0x1F: { const int cy = c.cy; c.cy = c.a & 1; c.a = ((c.a >> 1) | (cy << 7)) & 255; c.z = 0; c.n = 0; c.hc = 0; break; }
    case 0x08: { const std::uint16_t a = fetch16(); write(a, c.sp & 255); write(a + 1, c.sp >> 8); break; }
    case 0x09: case 0x19: case 0x29: case 0x39: add_hl(get_rr(op >> 4)); break;
    case 0x0A: c.a = read(static_cast<std::uint16_t>((c.b << 8) | c.c)); break;
    case 0x1A: c.a = read(static_cast<std::uint16_t>((c.d << 8) | c.e)); break;
    case 0x2A: { const std::uint16_t hl = get_rr(2); c.a = read(hl); set_rr(2, hl + 1); break; }
    case 0x3A: { const std::uint16_t hl = get_rr(2); c.a = read(hl); set_rr(2, hl - 1); break; }
    case 0x10: fetch(); if (cgb_ && speed_armed_) { double_speed_ = !double_speed_; speed_armed_ = false; divc_ = 0; } break;
    case 0x18: { const int e = s8(fetch()); c.pc = static_cast<std::uint16_t>(c.pc + e); break; }
    case 0x20: case 0x28: case 0x30: case 0x38: { const int e = s8(fetch()); if (cond((op >> 3) & 3)) { c.pc = static_cast<std::uint16_t>(c.pc + e); cyc = 12; } break; }
    case 0x27: daa(); break;
    case 0x2F: c.a ^= 255; c.n = 1; c.hc = 1; break;
    case 0x37: c.n = 0; c.hc = 0; c.cy = 1; break;
    case 0x3F: c.n = 0; c.hc = 0; c.cy ^= 1; break;
    case 0x76: if (!c.ime && (ifl_ & ie_ & 0x1F)) c.halt_bug = true; else c.halted = true; break;
    case 0xC0: case 0xC8: case 0xD0: case 0xD8: if (cond((op >> 3) & 3)) { c.pc = pop(); cyc = 20; } break;
    case 0xC1: case 0xD1: case 0xE1: set_rr((op >> 4) & 3, pop()); break;
    case 0xF1: { const std::uint16_t v = pop(); c.a = v >> 8; set_f(v & 0xF0); break; }
    case 0xC5: case 0xD5: case 0xE5: push(get_rr((op >> 4) & 3)); break;
    case 0xF5: push(static_cast<std::uint16_t>((c.a << 8) | f())); break;
    case 0xC2: case 0xCA: case 0xD2: case 0xDA: { const std::uint16_t a = fetch16(); if (cond((op >> 3) & 3)) { c.pc = a; cyc = 16; } break; }
    case 0xC3: c.pc = fetch16(); break;
    case 0xC4: case 0xCC: case 0xD4: case 0xDC: { const std::uint16_t a = fetch16(); if (cond((op >> 3) & 3)) { push(c.pc); c.pc = a; cyc = 24; } break; }
    case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE: alu((op >> 3) & 7, fetch()); break;
    case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF: push(c.pc); c.pc = op & 0x38; break;
    case 0xC9: c.pc = pop(); break;
    case 0xD9: c.pc = pop(); c.ime = 1; break;
    case 0xCB: cyc = cb_op(); break;
    case 0xCD: { const std::uint16_t a = fetch16(); push(c.pc); c.pc = a; break; }
    case 0xE0: write(0xFF00 | fetch(), c.a); break;
    case 0xF0: c.a = read(0xFF00 | fetch()); break;
    case 0xE2: write(0xFF00 | c.c, c.a); break;
    case 0xF2: c.a = read(0xFF00 | c.c); break;
    case 0xE8: { const int e = s8(fetch()); c.sp = sp_off(e); break; }
    case 0xF8: { const int e = s8(fetch()); const std::uint16_t r = sp_off(e); c.h = r >> 8; c.l = r & 255; break; }
    case 0xF9: c.sp = get_rr(2); break;
    case 0xE9: c.pc = get_rr(2); break;
    case 0xEA: write(fetch16(), c.a); break;
    case 0xFA: c.a = read(fetch16()); break;
    case 0xF3: c.ime = 0; c.ime_next = 0; break;
    case 0xFB: c.ime_next = 1; break;
    default:
      if (op >= 0x40 && op < 0x80) set_r((op >> 3) & 7, get_r(op & 7));
      else if (op >= 0x80 && op < 0xC0) alu((op >> 3) & 7, get_r(op & 7));
  }
  return cyc;
}

/* ================= PPU ================= */
void GbMachine::ppu_reset() {
  lcdc_ = 0x91; stat_ = 0; scy_ = scx_ = ly_ = lyc_ = 0; bgp_ = 0xFC; obp0_ = obp1_ = 0xFF; wy_ = wx_ = 0; bcps_ = ocps_ = vbk_ = 0;
  mode_ppu_ = 2; cyc_ = 0; win_line_ = 0; stat_line_ = false; frame_done_ = false; lyc_flag_ = false;
  for (int i = 0; i < 32; i++) bg_col_[i] = ob_col_[i] = g_lut[0x7FFF];
}
std::uint8_t GbMachine::ppu_read(std::uint16_t a) const {
  switch (a) {
    case 0xFF40: return lcdc_;
    case 0xFF41: return static_cast<std::uint8_t>(0x80 | (stat_ & 0x78) | (lyc_flag_ ? 4 : 0) | ((lcdc_ & 0x80) ? mode_ppu_ : 0));
    case 0xFF42: return scy_; case 0xFF43: return scx_; case 0xFF44: return ly_; case 0xFF45: return lyc_;
    case 0xFF47: return bgp_; case 0xFF48: return obp0_; case 0xFF49: return obp1_; case 0xFF4A: return wy_; case 0xFF4B: return wx_;
    case 0xFF4F: return cgb_ ? static_cast<std::uint8_t>(0xFE | vbk_) : 0xFF;
    case 0xFF68: return cgb_ ? static_cast<std::uint8_t>(bcps_ | 0x40) : 0xFF;
    case 0xFF69: return cgb_ ? bg_pal_[bcps_ & 63] : 0xFF;
    case 0xFF6A: return cgb_ ? static_cast<std::uint8_t>(ocps_ | 0x40) : 0xFF;
    case 0xFF6B: return cgb_ ? ob_pal_[ocps_ & 63] : 0xFF;
  }
  return 0xFF;
}
void GbMachine::pal_write(std::array<std::uint8_t, 64>& pal, std::array<std::uint32_t, 32>& col, int i, std::uint8_t v) {
  pal[i] = v; const int k = i >> 1; col[k] = g_lut[(pal[k * 2] | (pal[k * 2 + 1] << 8)) & 0x7FFF];
}
void GbMachine::ppu_write(std::uint16_t a, std::uint8_t v) {
  switch (a) {
    case 0xFF40: {
      const int was = lcdc_ & 0x80; lcdc_ = v;
      if (was && !(v & 0x80)) { ly_ = 0; mode_ppu_ = 0; cyc_ = 0; win_line_ = 0; stat_line_ = false; lyc_flag_ = false; }
      else if (!was && (v & 0x80)) { ly_ = 0; mode_ppu_ = 2; cyc_ = 0; win_line_ = 0; check_lyc(); update_stat(); }
      return;
    }
    case 0xFF41: stat_ = v & 0x78; update_stat(); return;
    case 0xFF42: scy_ = v; return; case 0xFF43: scx_ = v; return;
    case 0xFF45: lyc_ = v; if (lcdc_ & 0x80) { check_lyc(); update_stat(); } return;
    case 0xFF47: bgp_ = v; return; case 0xFF48: obp0_ = v; return; case 0xFF49: obp1_ = v; return;
    case 0xFF4A: wy_ = v; return; case 0xFF4B: wx_ = v; return;
    case 0xFF4F: if (cgb_) vbk_ = v & 1; return;
    case 0xFF68: bcps_ = v & 0xBF; return;
    case 0xFF69: if (cgb_) pal_write(bg_pal_, bg_col_, bcps_ & 63, v); if (bcps_ & 0x80) bcps_ = 0x80 | ((bcps_ + 1) & 63); return;
    case 0xFF6A: ocps_ = v & 0xBF; return;
    case 0xFF6B: if (cgb_) pal_write(ob_pal_, ob_col_, ocps_ & 63, v); if (ocps_ & 0x80) ocps_ = 0x80 | ((ocps_ + 1) & 63); return;
  }
}
void GbMachine::update_stat() {
  const int s = stat_, m = mode_ppu_;
  const bool line = (lyc_flag_ && (s & 0x40)) || (m == 0 && (s & 8)) || (m == 1 && (s & 0x10)) || (m == 2 && (s & 0x20));
  if (line && !stat_line_ && (lcdc_ & 0x80)) ifl_ |= 2;
  stat_line_ = line;
}
void GbMachine::ppu_tick(int c) {
  if (!(lcdc_ & 0x80)) return;
  cyc_ += c;
  for (;;) {
    if (mode_ppu_ == 2) { if (cyc_ < 80) return; cyc_ -= 80; mode_ppu_ = 3; update_stat(); }
    else if (mode_ppu_ == 3) {
      if (cyc_ < 172) return; cyc_ -= 172; mode_ppu_ = 0; render_line(); if (hdma_.active) hdma_step(); update_stat();
    } else if (mode_ppu_ == 0) {
      if (cyc_ < 204) return; cyc_ -= 204; ly_++;
      if (ly_ == 144) { mode_ppu_ = 1; ifl_ |= 1; frame_done_ = true; } else mode_ppu_ = 2;
      check_lyc(); update_stat();
    } else {
      if (cyc_ < 456) return; cyc_ -= 456; ly_++;
      if (ly_ > 153) { ly_ = 0; mode_ppu_ = 2; win_line_ = 0; }
      check_lyc(); update_stat();
    }
  }
}
void GbMachine::render_line() {
  const int ly = ly_; const bool bg_on = cgb_ || (lcdc_ & 1); std::uint32_t* out = &frame_[ly * 160];
  std::memset(line_idx_, 0, sizeof line_idx_); std::memset(line_pri_, 0, sizeof line_pri_);
  if (ly >= 144) return;
  if (bg_on) {
    const int map_base = (lcdc_ & 8) ? 0x1C00 : 0x1800; const bool sg = !(lcdc_ & 0x10); const int py = (ly + scy_) & 255;
    for (int x = 0; x < 160; x++) bg_pixel(x, (x + scx_) & 255, py, map_base, sg, out);
    if ((lcdc_ & 0x20) && ly >= wy_ && wx_ <= 166) {
      const int wmap = (lcdc_ & 0x40) ? 0x1C00 : 0x1800, wx0 = wx_ - 7;
      if (wx0 < 160) { const int py2 = win_line_; for (int x = std::max(0, wx0); x < 160; x++) bg_pixel(x, x - wx0, py2, wmap, sg, out); win_line_++; }
    }
  } else for (int x = 0; x < 160; x++) out[x] = dmg_[0];
  if (lcdc_ & 2) render_sprites(ly, out);
}
void GbMachine::bg_pixel(int x, int px, int py, int map_base, bool sg, std::uint32_t* out) {
  const int mi = map_base + ((py >> 3) << 5) + (px >> 3); const int tile = vram_[mi]; const int attr = cgb_ ? vram_[0x2000 + mi] : 0;
  int row = py & 7; if (attr & 0x40) row = 7 - row;
  const int base = (sg ? 0x1000 + s8(static_cast<std::uint8_t>(tile)) * 16 : tile * 16) + row * 2 + ((attr & 8) ? 0x2000 : 0);
  const int b0 = vram_[base], b1 = vram_[base + 1]; const int bit = (attr & 0x20) ? (px & 7) : 7 - (px & 7);
  const int v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
  line_idx_[x] = static_cast<std::uint8_t>(v); line_pri_[x] = (attr & 0x80) ? 1 : 0;
  out[x] = cgb_ ? bg_col_[(attr & 7) * 4 + v] : dmg_[(bgp_ >> (v * 2)) & 3];
}
void GbMachine::render_sprites(int ly, std::uint32_t* out) {
  const bool tall = (lcdc_ & 4) != 0; const int h = tall ? 16 : 8; int n = 0; int list[40], xs[40];
  for (int i = 0; i < 40 && n < (no_limit_ ? 40 : 10); i++) { const int y = oam_[i * 4] - 16; if (ly >= y && ly < y + h) { list[n] = i; xs[n] = oam_[i * 4 + 1] - 8; n++; } }
  if (!n) return;
  int order[10]; for (int k = 0; k < n; k++) order[k] = k;
  if (cgb_) std::sort(order, order + n, [&](int a, int b) { return list[b] < list[a]; });
  else std::sort(order, order + n, [&](int a, int b) { if (xs[b] != xs[a]) return xs[b] < xs[a]; return list[b] < list[a]; });
  const bool master = cgb_ && (lcdc_ & 1);
  for (int oi = 0; oi < n; oi++) {
    const int k = order[oi], i = list[k], sx = xs[k], y = oam_[i * 4] - 16; int tile = oam_[i * 4 + 2]; const int attr = oam_[i * 4 + 3];
    int row = ly - y; if (attr & 0x40) row = h - 1 - row;
    if (tall) tile = (tile & 0xFE) | (row >> 3);
    const int base = tile * 16 + (row & 7) * 2 + ((cgb_ && (attr & 8)) ? 0x2000 : 0);
    const int b0 = vram_[base], b1 = vram_[base + 1];
    for (int px = 0; px < 8; px++) {
      const int x = sx + px; if (x < 0 || x >= 160) continue;
      const int bit = (attr & 0x20) ? px : 7 - px; const int v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
      if (!v) continue;
      if (line_idx_[x] != 0) { if (master && line_pri_[x]) continue; if (attr & 0x80) continue; }
      out[x] = cgb_ ? ob_col_[(attr & 7) * 4 + v] : dmg_[(((attr & 0x10) ? obp1_ : obp0_) >> (v * 2)) & 3];
    }
  }
}

/* ================= APU ================= */
void GbMachine::apu_reset() {
  aregs_.fill(0); p1_ = Chan{}; p2_ = Chan{}; wv_ = Chan{}; nz_ = Chan{}; wave_ram_.fill(0);
  sweep_per_ = sweep_shift_ = sweep_t_ = shadow_ = 0; sweep_neg_ = sweep_en_ = false;
  nz_.lfsr = 0x7FFF; nr50_ = nr51_ = 0; power_ = true; fs_ = fs_t_ = 0; acc_ = 0;
}
void GbMachine::set_audio_rate(unsigned rate) { rate_ = rate ? rate : 48000; cps_ = 4194304.0 / rate_; }
std::uint8_t GbMachine::apu_read(std::uint16_t a) const {
  if (a >= 0xFF30) return wave_ram_[a - 0xFF30];
  const auto& R = aregs_;
  switch (a) {
    case 0xFF10: return R[0] | 0x80;
    case 0xFF11: return R[1] | 0x3F; case 0xFF12: return R[2]; case 0xFF13: return 0xFF; case 0xFF14: return R[4] | 0xBF;
    case 0xFF16: return R[6] | 0x3F; case 0xFF17: return R[7]; case 0xFF18: return 0xFF; case 0xFF19: return R[9] | 0xBF;
    case 0xFF1A: return R[10] | 0x7F; case 0xFF1B: return 0xFF; case 0xFF1C: return R[12] | 0x9F; case 0xFF1D: return 0xFF; case 0xFF1E: return R[14] | 0xBF;
    case 0xFF20: return 0xFF; case 0xFF21: return R[17]; case 0xFF22: return R[18]; case 0xFF23: return R[19] | 0xBF;
    case 0xFF24: return nr50_; case 0xFF25: return nr51_;
    case 0xFF26: return static_cast<std::uint8_t>(0x70 | (power_ ? 0x80 : 0) | (p1_.on ? 1 : 0) | (p2_.on ? 2 : 0) | (wv_.on ? 4 : 0) | (nz_.on ? 8 : 0));
  }
  return 0xFF;
}
void GbMachine::apu_write(std::uint16_t a, std::uint8_t v) {
  if (a >= 0xFF30) { wave_ram_[a - 0xFF30] = v; return; }
  if (a == 0xFF26) {
    const bool p = (v & 0x80) != 0;
    if (!p && power_) { for (int r = 0xFF10; r < 0xFF26; r++) apu_reg(static_cast<std::uint16_t>(r), 0, true); nr50_ = nr51_ = 0; p1_.on = p2_.on = wv_.on = nz_.on = false; }
    power_ = p; return;
  }
  if (!power_) {
    if (a == 0xFF11) p1_.len = 64 - (v & 63); else if (a == 0xFF16) p2_.len = 64 - (v & 63);
    else if (a == 0xFF1B) wv_.len = 256 - v; else if (a == 0xFF20) nz_.len = 64 - (v & 63);
    return;
  }
  apu_reg(a, v, false);
}
void GbMachine::apu_reg(std::uint16_t a, std::uint8_t v, bool force) {
  const int r = a - 0xFF10; if (r >= 0 && r < 0x20) aregs_[r] = v;
  switch (a) {
    case 0xFF10: if (neg_used_ && sweep_neg_ && !(v & 8)) p1_.on = false; sweep_per_ = (v >> 4) & 7; sweep_neg_ = (v & 8) != 0; sweep_shift_ = v & 7; break;
    case 0xFF11: p1_.duty = v >> 6; if (!force) p1_.len = 64 - (v & 63); break;
    case 0xFF12: p1_.set_env(v); break;
    case 0xFF13: p1_.freq = (p1_.freq & 0x700) | v; break;
    case 0xFF14: p1_.freq = (p1_.freq & 0xFF) | ((v & 7) << 8); len_enable(p1_, v); if (v & 0x80) { trig_pulse(p1_, true); trig_len(p1_, 64); } break;
    case 0xFF16: p2_.duty = v >> 6; if (!force) p2_.len = 64 - (v & 63); break;
    case 0xFF17: p2_.set_env(v); break;
    case 0xFF18: p2_.freq = (p2_.freq & 0x700) | v; break;
    case 0xFF19: p2_.freq = (p2_.freq & 0xFF) | ((v & 7) << 8); len_enable(p2_, v); if (v & 0x80) { trig_pulse(p2_, false); trig_len(p2_, 64); } break;
    case 0xFF1A: wv_.dac = (v & 0x80) != 0; if (!wv_.dac) wv_.on = false; break;
    case 0xFF1B: if (!force) wv_.len = 256 - v; break;
    case 0xFF1C: wv_.code = (v >> 5) & 3; break;
    case 0xFF1D: wv_.freq = (wv_.freq & 0x700) | v; break;
    case 0xFF1E: wv_.freq = (wv_.freq & 0xFF) | ((v & 7) << 8); len_enable(wv_, v); if (v & 0x80) { wv_.on = wv_.dac; trig_len(wv_, 256); wv_.timer = (2048 - wv_.freq) * 2; wv_.pos = 0; } break;
    case 0xFF20: if (!force) nz_.len = 64 - (v & 63); break;
    case 0xFF21: nz_.set_env(v); break;
    case 0xFF22: nz_.shift = v >> 4; nz_.width7 = (v & 8) != 0; nz_.div = v & 7; break;
    case 0xFF23: len_enable(nz_, v); if (v & 0x80) { nz_.on = nz_.dac; trig_len(nz_, 64); nz_.trig_env(); nz_.lfsr = 0x7FFF; nz_.timer = kNoiseDiv[nz_.div] << nz_.shift; } break;
    case 0xFF24: nr50_ = v; break;
    case 0xFF25: nr51_ = v; break;
  }
}
void GbMachine::len_enable(Chan& ch, std::uint8_t v) {
  const bool was = ch.len_en; ch.len_en = (v & 0x40) != 0;
  if (!was && ch.len_en && (fs_ & 1) && ch.len > 0) { ch.len--; if (ch.len == 0 && !(v & 0x80)) ch.on = false; }
}
void GbMachine::trig_len(Chan& ch, int max) { if (ch.len == 0) { ch.len = max; if (ch.len_en && (fs_ & 1)) ch.len--; } }
void GbMachine::trig_pulse(Chan& p, bool sw) {
  p.on = p.dac; p.timer = (2048 - p.freq) * 4; p.trig_env();
  if (sw) { neg_used_ = false; shadow_ = p.freq; sweep_t_ = sweep_per_ ? sweep_per_ : 8; sweep_en_ = sweep_per_ > 0 || sweep_shift_ > 0; if (sweep_shift_ > 0) sweep_calc(false); }
}
bool GbMachine::sweep_calc(bool apply) {
  const int d = shadow_ >> sweep_shift_; const int nf = sweep_neg_ ? shadow_ - d : shadow_ + d;
  if (sweep_neg_) neg_used_ = true;
  if (nf > 2047) { p1_.on = false; return false; }
  if (apply && sweep_shift_ > 0) { shadow_ = nf; p1_.freq = nf; }
  return true;
}
void GbMachine::frame_seq() {
  const int s = fs_; fs_ = (fs_ + 1) & 7;
  if (!(s & 1)) { p1_.clock_len(); p2_.clock_len(); wv_.clock_len(); nz_.clock_len(); }
  if (s == 2 || s == 6) {
    if (sweep_en_ && --sweep_t_ <= 0) { sweep_t_ = sweep_per_ ? sweep_per_ : 8; if (sweep_per_ > 0) { if (sweep_calc(true)) sweep_calc(false); } }
  }
  if (s == 7) { p1_.clock_env(); p2_.clock_env(); nz_.clock_env(); }
}
double GbMachine::chan_out() const {
  const int n = nr51_; int l = 0, r = 0, v;
  if (p1_.on) { v = kDuty[p1_.duty][p1_.seq] ? p1_.vol : 0; if (n & 1) r += v; if (n & 0x10) l += v; }
  if (p2_.on) { v = kDuty[p2_.duty][p2_.seq] ? p2_.vol : 0; if (n & 2) r += v; if (n & 0x20) l += v; }
  if (wv_.on) { v = wv_.code ? wv_.sample >> (wv_.code - 1) : 0; if (n & 4) r += v; if (n & 0x40) l += v; }
  if (nz_.on) { v = (nz_.lfsr & 1) ? 0 : nz_.vol; if (n & 8) r += v; if (n & 0x80) l += v; }
  return (l * (((nr50_ >> 4) & 7) + 1) + r * ((nr50_ & 7) + 1)) / (2.0 * 8 * 60);
}
void GbMachine::apu_tick(int c) {
  int left = c;
  while (left > 0) {
    const int st = left > 8 ? 8 : left; left -= st;
    fs_t_ += st; if (fs_t_ >= 8192) { fs_t_ -= 8192; frame_seq(); }
    p1_.timer -= st; while (p1_.timer <= 0) { const int t = (2048 - p1_.freq) * 4; p1_.timer += t ? t : 4; p1_.seq = (p1_.seq + 1) & 7; }
    p2_.timer -= st; while (p2_.timer <= 0) { const int t = (2048 - p2_.freq) * 4; p2_.timer += t ? t : 4; p2_.seq = (p2_.seq + 1) & 7; }
    wv_.timer -= st;
    while (wv_.timer <= 0) { const int t = (2048 - wv_.freq) * 2; wv_.timer += t ? t : 2; wv_.pos = (wv_.pos + 1) & 31; const int b = wave_ram_[wv_.pos >> 1]; wv_.sample = (wv_.pos & 1) ? b & 15 : b >> 4; }
    nz_.timer -= st;
    while (nz_.timer <= 0) {
      const int t = kNoiseDiv[nz_.div] << nz_.shift; nz_.timer += t ? t : 8;
      const std::uint32_t x = (nz_.lfsr & 1) ^ ((nz_.lfsr >> 1) & 1);
      nz_.lfsr = (nz_.lfsr >> 1) | (x << 14);
      if (nz_.width7) nz_.lfsr = (nz_.lfsr & ~0x40u) | (x << 6);
    }
    acc_ += st;
    if (acc_ >= cps_) { acc_ -= cps_; apu_push(power_ ? chan_out() : 0); }
  }
}
void GbMachine::apu_push(double s) {
  const double y = s - px_ + 0.996 * py_; px_ = s; py_ = y;
  if (wp_ - rp_ >= kAudioSize) rp_++;
  abuf_[wp_ & (kAudioSize - 1)] = static_cast<float>(y * 0.9 * volume_); wp_++;
}
void GbMachine::fill_audio(float* out, std::size_t n) {
  for (std::size_t i = 0; i < n; i++) {
    if (rp_ < wp_) { last_ = abuf_[rp_ & (kAudioSize - 1)]; rp_++; } else last_ *= 0.995f;
    out[i] = last_;
  }
}


void GbMachine::state(StateIO& s) {
  s.v(cpu_); s.v(cart_); s.vec(ram_);
  s.v(rom_mask_); s.v(ram_mask_); s.v(rom_off0_); s.v(rom_off1_); s.v(ram_off_);
  s.v(ram_en_); s.v(rom_bank_); s.v(ram_bank_); s.v(mode_); s.v(upper_); s.v(rtc_sel_); s.v(rtc_);
  s.v(wram_); s.v(hram_); s.v(io_); s.v(cgb_); s.v(double_speed_); s.v(speed_armed_); s.v(wbank_);
  s.v(ifl_); s.v(ie_); s.v(joy_sel_); s.v(divc_); s.v(tima_); s.v(tma_); s.v(tac_); s.v(sb_); s.v(sc_); s.v(hdma_); s.v(extra_);
  s.v(vram_); s.v(oam_); s.v(bg_pal_); s.v(ob_pal_); s.v(bg_col_); s.v(ob_col_);
  s.v(lcdc_); s.v(stat_); s.v(scy_); s.v(scx_); s.v(ly_); s.v(lyc_); s.v(bgp_); s.v(obp0_); s.v(obp1_); s.v(wy_); s.v(wx_); s.v(bcps_); s.v(ocps_); s.v(vbk_);
  s.v(mode_ppu_); s.v(cyc_); s.v(win_line_); s.v(stat_line_); s.v(frame_done_); s.v(lyc_flag_);
  s.v(p1_); s.v(p2_); s.v(wv_); s.v(nz_); s.v(aregs_); s.v(wave_ram_);
  s.v(sweep_per_); s.v(sweep_shift_); s.v(sweep_t_); s.v(shadow_); s.v(fs_); s.v(fs_t_); s.v(sweep_neg_); s.v(sweep_en_); s.v(neg_used_);
  s.v(nr50_); s.v(nr51_); s.v(power_); s.v(acc_); s.v(px_); s.v(py_);
  if (!s.saving()) { rp_ = wp_; }
}

}  // namespace emuhub
