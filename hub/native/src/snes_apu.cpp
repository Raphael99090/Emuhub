#include "snes_apu.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace emuhub {
namespace {
const int kRate[32] = {0, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1};
const int kCyc[256] = {
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 6, 8, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 4, 6,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 5, 4, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 3, 8,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 6, 6, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 4, 5, 2, 2, 4, 3,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 5, 5, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 6,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 2, 4, 5, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 12, 5,
  3, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 2, 4, 4, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 4,
  3, 8, 4, 5, 4, 5, 4, 7, 2, 5, 6, 4, 5, 2, 4, 9, 2, 8, 4, 5, 5, 6, 6, 7, 4, 5, 5, 5, 2, 2, 6, 3,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 4, 5, 3, 4, 3, 4, 3, 2, 8, 4, 5, 4, 5, 5, 6, 3, 4, 5, 5, 2, 2, 4, 3};
inline int s8(int v) { return static_cast<std::int8_t>(v & 0xFF); }
inline int s16(int v) { return static_cast<std::int16_t>(v & 0xFFFF); }
inline int clamp16(int v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
}  // namespace

SnesApu::SnesApu() { reset(); }

void SnesApu::reset() {
  ram_.fill(0); dsp_.fill(0); std::memset(in_ports_, 0, 4); std::memset(out_ports_, 0, 4);
  a_ = x_ = y_ = 0; sp_ = 0xEF; pc_ = 0; n_ = v_ = p_ = h_ = i_ = z_ = c_ = 0;
  control_ = 0x80; dsp_addr_ = 0; running_ = false; owed_ = 0; last_cyc_ = 0; dsp_cyc_ = 0;
  for (int t = 0; t < 3; t++) { timer_target_[t] = 0xFF; timer_stage_[t] = 0; timer_out_[t] = 0; timer_cyc_[t] = 0; }
  for (int v = 0; v < 8; v++) { v_mode_[v] = 0; v_env_[v] = 0; v_out_[v] = 0; }
  std::memset(echo_hist_, 0, sizeof echo_hist_); echo_pos_ = 0;
  noise_ = 0x4000; sample_count_ = 0; kon_ = koff_ = endx_ = 0;
  dsp_[0x6C] = 0xE0;
  boot_ipl();
}

void SnesApu::boot_ipl() {
  running_ = false; ipl_mode_ = 0; ipl_counter_ = 0; ipl_dest_ = 0; ipl_last_ = -1;
  out_ports_[0] = 0xAA; out_ports_[1] = 0xBB;
}
void SnesApu::ipl_step() {
  for (int guard = 0; guard < 4 && !running_; guard++) {
    if (ipl_mode_ == 0) {
      if (in_ports_[0] != 0xCC) return;
      ipl_header(0xCC);
    } else if (ipl_mode_ == 1) {
      if (in_ports_[0] != 0) return;
      ipl_mode_ = 2; ipl_counter_ = 0;
    } else {
      const int p0 = in_ports_[0];
      if (p0 == ipl_counter_) {
        ram_[ipl_dest_] = in_ports_[1]; ipl_dest_ = (ipl_dest_ + 1) & 0xFFFF;
        out_ports_[0] = static_cast<std::uint8_t>(ipl_counter_); ipl_counter_ = (ipl_counter_ + 1) & 0xFF;
      } else if (((p0 - ipl_counter_) & 0xFF) < 0x80 && p0 != ipl_last_) ipl_header(p0);
      else return;
    }
  }
}
void SnesApu::ipl_header(int p0) {
  ipl_dest_ = in_ports_[2] | (in_ports_[3] << 8); ipl_last_ = p0; out_ports_[0] = static_cast<std::uint8_t>(p0);
  if (in_ports_[1] == 0) { pc_ = ipl_dest_; sp_ = 0xEF; x_ = 0; running_ = true; }
  else ipl_mode_ = 1;
}

std::uint8_t SnesApu::rd(int a) {
  if (a >= 0xF0 && a < 0x100) {
    switch (a) {
      case 0xF2: return static_cast<std::uint8_t>(dsp_addr_);
      case 0xF3: return dsp_[dsp_addr_ & 0x7F];
      case 0xF4: case 0xF5: case 0xF6: case 0xF7: return in_ports_[a - 0xF4];
      case 0xFA: case 0xFB: case 0xFC: return 0;
      case 0xFD: case 0xFE: case 0xFF: { const int t = a - 0xFD, v = timer_out_[t]; timer_out_[t] = 0; return static_cast<std::uint8_t>(v); }
      default: return ram_[a];
    }
  }
  return ram_[a];
}
void SnesApu::wr(int a, int v) {
  ram_[a] = static_cast<std::uint8_t>(v & 0xFF);
  if (a >= 0xF0 && a < 0x100) {
    switch (a) {
      case 0xF1: {
        const int was = control_; control_ = v;
        for (int t = 0; t < 3; t++) if ((v & (1 << t)) && !(was & (1 << t))) { timer_stage_[t] = 0; timer_out_[t] = 0; timer_cyc_[t] = 0; }
        if (v & 0x10) { in_ports_[0] = 0; in_ports_[1] = 0; }
        if (v & 0x20) { in_ports_[2] = 0; in_ports_[3] = 0; }
        break;
      }
      case 0xF2: dsp_addr_ = v; break;
      case 0xF3: if (dsp_addr_ < 0x80) dsp_write_(dsp_addr_, v); break;
      case 0xF4: case 0xF5: case 0xF6: case 0xF7: out_ports_[a - 0xF4] = static_cast<std::uint8_t>(v); break;
      case 0xFA: case 0xFB: case 0xFC: timer_target_[a - 0xFA] = v & 0xFF; break;
    }
  }
}
void SnesApu::dsp_write_(int r, int v) {
  if (r == 0x7C) { dsp_[r] = 0; endx_ = 0; return; }
  dsp_[r] = static_cast<std::uint8_t>(v & 0xFF);
  if (r == 0x4C) kon_ |= v;
  else if (r == 0x5C) koff_ = v;
}

void SnesApu::sync(double cyc, bool eol) {
  if (!clock_init_) { clock_init_ = true; clock_ = 0; port_clock_ = -100; }
  const double d = cyc - last_cyc_;
  last_cyc_ = eol ? cyc - 1364 : cyc;
  if (d > 0) { owed_ += d * (1024000.0 / 21477272.0); clock_ += d; }
  if (!running_) { if (clock_ - port_clock_ >= 40) ipl_step(); if (!running_) { skip_idle(); return; } }
  while (owed_ > 0) {
    if (pc_ >= 0xFFC0 && (control_ & 0x80)) { boot_ipl(); skip_idle(); return; }
    step_cycles(exec());
  }
}
void SnesApu::skip_idle() { if (owed_ > 0) { const double c = owed_; owed_ = 0; step_cycles2(c); } }
void SnesApu::step_cycles(int c) { owed_ -= c; step_cycles2(c); }
void SnesApu::step_cycles2(double c) {
  const int ctl = control_;
  for (int t = 0; t < 3; t++) {
    if (!(ctl & (1 << t))) continue;
    const int per = t == 2 ? 16 : 128; timer_cyc_[t] += c;
    while (timer_cyc_[t] >= per) {
      timer_cyc_[t] -= per;
      const int s = timer_stage_[t] + 1; timer_stage_[t] = s & 0xFF;
      if (s == (timer_target_[t] ? timer_target_[t] : 256)) { timer_stage_[t] = 0; timer_out_[t] = (timer_out_[t] + 1) & 15; }
    }
  }
  dsp_cyc_ += c;
  while (dsp_cyc_ >= 32) { dsp_cyc_ -= 32; dsp_sample(); }
}

int SnesApu::f8() { const int v = rd(pc_); pc_ = (pc_ + 1) & 0xFFFF; return v; }
int SnesApu::f16() { const int l = f8(); return l | (f8() << 8); }
void SnesApu::push(int v) { ram_[0x100 | sp_] = static_cast<std::uint8_t>(v & 0xFF); sp_ = (sp_ - 1) & 0xFF; }
int SnesApu::pop() { sp_ = (sp_ + 1) & 0xFF; return ram_[0x100 | sp_]; }

int SnesApu::alu(int k, int a, int b) {
  int r;
  switch (k) {
    case 0: r = a | b; nz(r); return r;
    case 1: r = a & b; nz(r); return r;
    case 2: r = a ^ b; nz(r); return r;
    case 3: r = a - b; c_ = a >= b ? 1 : 0; nz(r & 0xFF); return a;
    case 4: r = a + b + c_; v_ = (~(a ^ b) & (a ^ r) & 0x80) ? 1 : 0; h_ = (((a & 15) + (b & 15) + c_) > 15) ? 1 : 0; c_ = r > 0xFF ? 1 : 0; r &= 0xFF; nz(r); return r;
    default: b ^= 0xFF; r = a + b + c_; v_ = (~(a ^ b) & (a ^ r) & 0x80) ? 1 : 0; h_ = (((a & 15) + (b & 15) + c_) > 15) ? 1 : 0; c_ = r > 0xFF ? 1 : 0; r &= 0xFF; nz(r); return r;
  }
}
int SnesApu::bra(bool cond) { const int o = f8(); if (cond) { pc_ = (pc_ + s8(o)) & 0xFFFF; return 2; } return 0; }
int SnesApu::shl(int v, int k) {
  int r, c;
  switch (k) {
    case 0: c = v >> 7; r = (v << 1) & 0xFF; break;
    case 1: c = v >> 7; r = ((v << 1) | c_) & 0xFF; break;
    case 2: c = v & 1; r = v >> 1; break;
    default: c = v & 1; r = (v >> 1) | (c_ << 7); break;
  }
  c_ = c; nz(r); return r;
}

int SnesApu::exec() {
  const int op = f8(); int extra = 0;
  const int lo = op & 15, hi = op >> 4;
  if (lo >= 4 && lo <= 9 && hi <= 0xB) {
    const int k = hi >> 1, odd = hi & 1; int ea;
    if (!odd) {
      switch (lo) {
        case 4: ea = dpa(f8()); break;
        case 5: ea = f16(); break;
        case 6: ea = dpa(x_); break;
        case 7: { const int d = (f8() + x_) & 0xFF, a = dpa(d); const int l = rd(a); ea = l | (rd(dpa((d + 1) & 0xFF)) << 8); } break;
        case 8: { const int v = f8(); a_ = alu(k, a_, v); return kCyc[op]; }
        default: { const int s = dpa(f8()), d = dpa(f8()); const int dv = rd(d); const int sv = rd(s); const int r = alu(k, dv, sv); if (k != 3) wr(d, r); return kCyc[op]; }
      }
      a_ = alu(k, a_, rd(ea)); return kCyc[op];
    }
    switch (lo) {
      case 4: ea = dpa((f8() + x_) & 0xFF); break;
      case 5: ea = (f16() + x_) & 0xFFFF; break;
      case 6: ea = (f16() + y_) & 0xFFFF; break;
      case 7: { const int d = f8(), a = dpa(d); const int l = rd(a); ea = ((l | (rd(dpa((d + 1) & 0xFF)) << 8)) + y_) & 0xFFFF; } break;
      case 8: { const int v = f8(), d = dpa(f8()); const int r = alu(k, rd(d), v); if (k != 3) wr(d, r); return kCyc[op]; }
      default: { const int sa = dpa(y_), da = dpa(x_); const int dv = rd(da); const int sv = rd(sa); const int r = alu(k, dv, sv); if (k != 3) wr(da, r); return kCyc[op]; }
    }
    a_ = alu(k, a_, rd(ea)); return kCyc[op];
  }
  switch (op) {
    case 0x00: break;
    case 0xEF: case 0xFF: pc_ = (pc_ - 1) & 0xFFFF; break;
    case 0x01: case 0x11: case 0x21: case 0x31: case 0x41: case 0x51: case 0x61: case 0x71:
    case 0x81: case 0x91: case 0xA1: case 0xB1: case 0xC1: case 0xD1: case 0xE1: case 0xF1: {
      push(pc_ >> 8); push(pc_ & 0xFF); const int vec = 0xFFDE - (op >> 4) * 2; const int l = rd(vec); pc_ = l | (rd(vec + 1) << 8);
    } break;
    case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xA2: case 0xC2: case 0xE2: { const int a = dpa(f8()); wr(a, rd(a) | (1 << (op >> 5))); } break;
    case 0x12: case 0x32: case 0x52: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2: { const int a = dpa(f8()); wr(a, rd(a) & ~(1 << (op >> 5))); } break;
    case 0x03: case 0x23: case 0x43: case 0x63: case 0x83: case 0xA3: case 0xC3: case 0xE3: { const int v = rd(dpa(f8())); extra = bra((v >> (op >> 5)) & 1); } break;
    case 0x13: case 0x33: case 0x53: case 0x73: case 0x93: case 0xB3: case 0xD3: case 0xF3: { const int v = rd(dpa(f8())); extra = bra(!((v >> (op >> 5)) & 1)); } break;
    case 0x10: extra = bra(!n_); break; case 0x30: extra = bra(n_); break;
    case 0x50: extra = bra(!v_); break; case 0x70: extra = bra(v_); break;
    case 0x90: extra = bra(!c_); break; case 0xB0: extra = bra(c_); break;
    case 0xD0: extra = bra(!z_); break; case 0xF0: extra = bra(z_); break;
    case 0x2F: extra = bra(true); break;
    case 0x2E: { const int v = rd(dpa(f8())); extra = bra(a_ != v); } break;
    case 0xDE: { const int v = rd(dpa((f8() + x_) & 0xFF)); extra = bra(a_ != v); } break;
    case 0x6E: { const int a = dpa(f8()), v = (rd(a) - 1) & 0xFF; wr(a, v); extra = bra(v != 0); } break;
    case 0xFE: y_ = (y_ - 1) & 0xFF; extra = bra(y_ != 0); break;
    case 0x20: p_ = 0; break; case 0x40: p_ = 1; break;
    case 0x60: c_ = 0; break; case 0x80: c_ = 1; break; case 0xED: c_ ^= 1; break;
    case 0xA0: i_ = 1; break; case 0xC0: i_ = 0; break;
    case 0xE0: v_ = 0; h_ = 0; break;
    case 0x0D: push(psw()); break; case 0x2D: push(a_); break; case 0x4D: push(x_); break; case 0x6D: push(y_); break;
    case 0x8E: set_psw(pop()); break; case 0xAE: a_ = pop(); break; case 0xCE: x_ = pop(); break; case 0xEE: y_ = pop(); break;
    case 0x3F: { const int a = f16(); push(pc_ >> 8); push(pc_ & 0xFF); pc_ = a; } break;
    case 0x4F: { const int o = f8(); push(pc_ >> 8); push(pc_ & 0xFF); pc_ = 0xFF00 | o; } break;
    case 0x6F: { const int l = pop(); pc_ = l | (pop() << 8); } break;
    case 0x7F: { set_psw(pop()); const int l = pop(); pc_ = l | (pop() << 8); } break;
    case 0x0F: { push(pc_ >> 8); push(pc_ & 0xFF); push(psw()); const int l = rd(0xFFDE); pc_ = l | (rd(0xFFDF) << 8); i_ = 0; } break;
    case 0x5F: pc_ = f16(); break;
    case 0x1F: { const int a = (f16() + x_) & 0xFFFF; const int l = rd(a); pc_ = l | (rd((a + 1) & 0xFFFF) << 8); } break;
    case 0x7D: a_ = x_; nz(a_); break; case 0xDD: a_ = y_; nz(a_); break;
    case 0x5D: x_ = a_; nz(x_); break; case 0xFD: y_ = a_; nz(y_); break;
    case 0x9D: x_ = sp_; nz(x_); break; case 0xBD: sp_ = x_; break;
    case 0xE8: a_ = f8(); nz(a_); break; case 0xCD: x_ = f8(); nz(x_); break; case 0x8D: y_ = f8(); nz(y_); break;
    case 0xE4: a_ = rd(dpa(f8())); nz(a_); break;
    case 0xF4: a_ = rd(dpa((f8() + x_) & 0xFF)); nz(a_); break;
    case 0xE5: a_ = rd(f16()); nz(a_); break;
    case 0xF5: a_ = rd((f16() + x_) & 0xFFFF); nz(a_); break;
    case 0xF6: a_ = rd((f16() + y_) & 0xFFFF); nz(a_); break;
    case 0xE6: a_ = rd(dpa(x_)); nz(a_); break;
    case 0xBF: a_ = rd(dpa(x_)); x_ = (x_ + 1) & 0xFF; nz(a_); break;
    case 0xE7: { const int d = (f8() + x_) & 0xFF; const int l = rd(dpa(d)); const int h = rd(dpa((d + 1) & 0xFF)); a_ = rd(l | (h << 8)); nz(a_); } break;
    case 0xF7: { const int d = f8(); const int l = rd(dpa(d)); const int h = rd(dpa((d + 1) & 0xFF)); a_ = rd(((l | (h << 8)) + y_) & 0xFFFF); nz(a_); } break;
    case 0xF8: x_ = rd(dpa(f8())); nz(x_); break;
    case 0xF9: x_ = rd(dpa((f8() + y_) & 0xFF)); nz(x_); break;
    case 0xE9: x_ = rd(f16()); nz(x_); break;
    case 0xEB: y_ = rd(dpa(f8())); nz(y_); break;
    case 0xFB: y_ = rd(dpa((f8() + x_) & 0xFF)); nz(y_); break;
    case 0xEC: y_ = rd(f16()); nz(y_); break;
    case 0xC4: wr(dpa(f8()), a_); break;
    case 0xD4: wr(dpa((f8() + x_) & 0xFF), a_); break;
    case 0xC5: wr(f16(), a_); break;
    case 0xD5: wr((f16() + x_) & 0xFFFF, a_); break;
    case 0xD6: wr((f16() + y_) & 0xFFFF, a_); break;
    case 0xC6: wr(dpa(x_), a_); break;
    case 0xAF: wr(dpa(x_), a_); x_ = (x_ + 1) & 0xFF; break;
    case 0xC7: { const int d = (f8() + x_) & 0xFF; const int l = rd(dpa(d)); const int h = rd(dpa((d + 1) & 0xFF)); wr(l | (h << 8), a_); } break;
    case 0xD7: { const int d = f8(); const int l = rd(dpa(d)); const int h = rd(dpa((d + 1) & 0xFF)); wr(((l | (h << 8)) + y_) & 0xFFFF, a_); } break;
    case 0xD8: wr(dpa(f8()), x_); break;
    case 0xD9: wr(dpa((f8() + y_) & 0xFF), x_); break;
    case 0xC9: wr(f16(), x_); break;
    case 0xCB: wr(dpa(f8()), y_); break;
    case 0xDB: wr(dpa((f8() + x_) & 0xFF), y_); break;
    case 0xCC: wr(f16(), y_); break;
    case 0x8F: { const int v = f8(); wr(dpa(f8()), v); } break;
    case 0xFA: { const int s = rd(dpa(f8())); wr(dpa(f8()), s); } break;
    case 0xC8: alu(3, x_, f8()); break;
    case 0x3E: alu(3, x_, rd(dpa(f8()))); break;
    case 0x1E: alu(3, x_, rd(f16())); break;
    case 0xAD: alu(3, y_, f8()); break;
    case 0x7E: alu(3, y_, rd(dpa(f8()))); break;
    case 0x5E: alu(3, y_, rd(f16())); break;
    case 0xBC: a_ = (a_ + 1) & 0xFF; nz(a_); break; case 0x3D: x_ = (x_ + 1) & 0xFF; nz(x_); break; case 0xFC: y_ = (y_ + 1) & 0xFF; nz(y_); break;
    case 0x9C: a_ = (a_ - 1) & 0xFF; nz(a_); break; case 0x1D: x_ = (x_ - 1) & 0xFF; nz(x_); break; case 0xDC: y_ = (y_ - 1) & 0xFF; nz(y_); break;
    case 0xAB: { const int a = dpa(f8()), v = (rd(a) + 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0xBB: { const int a = dpa((f8() + x_) & 0xFF), v = (rd(a) + 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0xAC: { const int a = f16(), v = (rd(a) + 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0x8B: { const int a = dpa(f8()), v = (rd(a) - 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0x9B: { const int a = dpa((f8() + x_) & 0xFF), v = (rd(a) - 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0x8C: { const int a = f16(), v = (rd(a) - 1) & 0xFF; wr(a, v); nz(v); } break;
    case 0x1C: a_ = shl(a_, 0); break; case 0x3C: a_ = shl(a_, 1); break; case 0x5C: a_ = shl(a_, 2); break; case 0x7C: a_ = shl(a_, 3); break;
    case 0x0B: case 0x2B: case 0x4B: case 0x6B: { const int a = dpa(f8()); wr(a, shl(rd(a), op >> 5)); } break;
    case 0x1B: case 0x3B: case 0x5B: case 0x7B: { const int a = dpa((f8() + x_) & 0xFF); wr(a, shl(rd(a), op >> 5)); } break;
    case 0x0C: case 0x2C: case 0x4C: case 0x6C: { const int a = f16(); wr(a, shl(rd(a), op >> 5)); } break;
    case 0x9F: a_ = ((a_ << 4) | (a_ >> 4)) & 0xFF; nz(a_); break;
    case 0xBA: { const int a = dpa(f8()); const int l = rd(a); const int h = rd(dpa((a + 1) & 0xFF)); a_ = l; y_ = h; n_ = (h >> 7) & 1; z_ = (l | h) == 0 ? 1 : 0; } break;
    case 0xDA: { const int o = f8(), a = dpa(o); wr(a, a_); wr(dpa((o + 1) & 0xFF), y_); } break;
    case 0x3A: case 0x1A: {
      const int o = f8(), a = dpa(o), a2 = dpa((o + 1) & 0xFF); int w = rd(a) | (rd(a2) << 8); w = (w + (op == 0x3A ? 1 : -1)) & 0xFFFF;
      wr(a, w & 0xFF); wr(a2, w >> 8); n_ = (w >> 15) & 1; z_ = w == 0 ? 1 : 0;
    } break;
    case 0x7A: case 0x9A: {
      const int o = f8(), a = dpa(o); const int wl = rd(a); const int w = wl | (rd(dpa((o + 1) & 0xFF)) << 8); const int ya = a_ | (y_ << 8); int r;
      if (op == 0x7A) { r = ya + w; v_ = (~(ya ^ w) & (ya ^ r) & 0x8000) ? 1 : 0; h_ = (((ya & 0xFFF) + (w & 0xFFF)) > 0xFFF) ? 1 : 0; c_ = r > 0xFFFF ? 1 : 0; }
      else { r = ya - w; v_ = ((ya ^ w) & (ya ^ r) & 0x8000) ? 1 : 0; h_ = (((ya & 0xFFF) - (w & 0xFFF)) >= 0) ? 1 : 0; c_ = r >= 0 ? 1 : 0; }
      r &= 0xFFFF; a_ = r & 0xFF; y_ = r >> 8; n_ = (r >> 15) & 1; z_ = r == 0 ? 1 : 0;
    } break;
    case 0x5A: {
      const int o = f8(), a = dpa(o); const int wl = rd(a); const int w = wl | (rd(dpa((o + 1) & 0xFF)) << 8); const int ya = a_ | (y_ << 8), r = ya - w;
      c_ = ya >= w ? 1 : 0; n_ = (r >> 15) & 1; z_ = (r & 0xFFFF) == 0 ? 1 : 0;
    } break;
    case 0xCF: { const int r = y_ * a_; a_ = r & 0xFF; y_ = (r >> 8) & 0xFF; n_ = (y_ >> 7) & 1; z_ = y_ == 0 ? 1 : 0; } break;
    case 0x9E: {
      const int ya = a_ | (y_ << 8); v_ = y_ >= x_ ? 1 : 0; h_ = (y_ & 15) >= (x_ & 15) ? 1 : 0;
      if (y_ < (x_ << 1)) { a_ = x_ ? (ya / x_) & 0xFF : 0xFF; y_ = x_ ? ya % x_ : a_; }
      else { const int d = ya - (x_ << 9), q = x_ ? (255 - d / (256 - x_)) : 0; a_ = q & 0xFF; y_ = (x_ + (x_ ? d % (256 - x_) : 0)) & 0xFF; }
      nz(a_);
    } break;
    case 0xDF: {
      if (c_ || a_ > 0x99) { a_ += 0x60; c_ = 1; }
      if (h_ || (a_ & 15) > 9) a_ += 6;
      a_ &= 0xFF; nz(a_);
    } break;
    case 0xBE: {
      if (!c_ || a_ > 0x99) { a_ -= 0x60; c_ = 0; }
      if (!h_ || (a_ & 15) > 9) a_ -= 6;
      a_ &= 0xFF; nz(a_);
    } break;
    case 0x0E: case 0x4E: { const int a = f16(), v = rd(a); nz((a_ - v) & 0xFF); wr(a, op == 0x0E ? (v | a_) : (v & ~a_)); } break;
    case 0x0A: case 0x2A: case 0x4A: case 0x6A: case 0x8A: case 0xAA: case 0xCA: case 0xEA: {
      const int w = f16(), a = w & 0x1FFF, b = w >> 13, v = (rd(a) >> b) & 1;
      switch (op) {
        case 0x0A: c_ |= v; break; case 0x2A: c_ |= v ^ 1; break; case 0x4A: c_ &= v; break; case 0x6A: c_ &= v ^ 1; break;
        case 0x8A: c_ ^= v; break; case 0xAA: c_ = v; break;
        case 0xCA: { const int m = rd(a); wr(a, c_ ? (m | (1 << b)) : (m & ~(1 << b))); } break;
        default: wr(a, rd(a) ^ (1 << b));
      }
    } break;
    default: break;
  }
  return kCyc[op] + extra;
}

/* ---------------- DSP ---------------- */
void SnesApu::decode_block(int v) {
  const int addr = v_addr_[v], hdr = ram_[addr], shift = hdr >> 4, filt = (hdr >> 2) & 3;
  int p1 = v_p1_[v], p2 = v_p2_[v];
  for (int i = 0; i < 16; i++) {
    int nib = ram_[(addr + 1 + (i >> 1)) & 0xFFFF]; nib = (i & 1) ? (nib & 15) : (nib >> 4); if (nib > 7) nib -= 16;
    int s = shift <= 12 ? (nib * (1 << shift)) >> 1 : (nib < 0 ? -2048 : 0);
    if (filt == 1) s += p1 + ((-p1) >> 4);
    else if (filt == 2) s += (p1 << 1) + ((-(p1 * 3)) >> 5) - p2 + (p2 >> 4);
    else if (filt == 3) s += (p1 << 1) + ((-(p1 * 13)) >> 6) - p2 + ((p2 * 3) >> 4);
    if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
    v_blk_[v * 16 + i] = s; p2 = p1; p1 = s;
  }
  v_p1_[v] = p1; v_p2_[v] = p2;
}
int SnesApu::loop_addr(int v) const { const int d = dsp_[0x5D] << 8, e = d + (dsp_[v * 16 + 4] << 2) + 2; return ram_[e & 0xFFFF] | (ram_[(e + 1) & 0xFFFF] << 8); }
void SnesApu::advance_sample(int v) {
  const int i = v_idx_[v], h = v * 4;
  v_hist_[h] = v_hist_[h + 1]; v_hist_[h + 1] = v_hist_[h + 2]; v_hist_[h + 2] = v_hist_[h + 3];
  v_hist_[h + 3] = v_blk_[v * 16 + i];
  if (i == 15) {
    const int hdr = ram_[v_addr_[v]];
    if (hdr & 1) {
      endx_ |= 1 << v;
      if (hdr & 2) v_addr_[v] = loop_addr(v);
      else { v_mode_[v] = 0; v_env_[v] = 0; v_addr_[v] = (v_addr_[v] + 9) & 0xFFFF; decode_block(v); v_idx_[v] = 0; return; }
    } else v_addr_[v] = (v_addr_[v] + 9) & 0xFFFF;
    decode_block(v); v_idx_[v] = 0;
  } else v_idx_[v] = i + 1;
}
bool SnesApu::rate_hit(int rate) const { return rate != 0 && (sample_count_ % kRate[rate]) == 0; }

void SnesApu::dsp_sample() {
  auto& d = dsp_; auto& ram = ram_;
  sample_count_ = static_cast<int>(static_cast<std::uint32_t>(sample_count_) + 1u);
  const int flg = d[0x6C];
  if (flg & 0x80) for (int v = 0; v < 8; v++) { v_mode_[v] = 0; v_env_[v] = 0; }
  if (rate_hit(flg & 31)) { const int bit = (noise_ ^ (noise_ >> 1)) & 1; noise_ = (noise_ >> 1) | (bit << 14); }
  int mix_l = 0, mix_r = 0, echo_l = 0, echo_r = 0, prev_out = 0;
  const int dir_base = d[0x5D] << 8;
  for (int v = 0; v < 8; v++) {
    const int r = v * 16, bit = 1 << v;
    if (kon_ & bit) {
      const int sa = (dir_base + (d[r + 4] << 2)) & 0xFFFF;
      v_addr_[v] = ram[sa] | (ram[(sa + 1) & 0xFFFF] << 8); v_idx_[v] = 0; v_frac_[v] = 0; v_p1_[v] = 0; v_p2_[v] = 0;
      for (int k = 0; k < 4; k++) v_hist_[v * 4 + k] = 0;
      decode_block(v);
      v_env_[v] = 0; v_mode_[v] = 1; endx_ &= ~bit; kon_ &= ~bit;
    }
    if ((koff_ & bit) && v_mode_[v] != 0) v_mode_[v] = 4;
    if (flg & 0x80) v_mode_[v] = 0;
    int out = 0;
    if (v_mode_[v] != 0) {
      int env = v_env_[v];
      if (v_mode_[v] == 4) { env -= 8; if (env <= 0) { env = 0; v_mode_[v] = 0; } }
      else if (d[r + 5] & 0x80) {
        const int adsr2 = d[r + 6];
        switch (v_mode_[v]) {
          case 1: { const int rate = ((d[r + 5] & 15) << 1) + 1; if (rate_hit(rate)) { env += rate == 31 ? 1024 : 32; if (env >= 0x7E0) v_mode_[v] = 2; if (env > 0x7FF) env = 0x7FF; } } break;
          case 2: { const int rate = (((d[r + 5] >> 4) & 7) << 1) + 16; if (rate_hit(rate)) env -= ((env - 1) >> 8) + 1; if ((env >> 8) <= (adsr2 >> 5)) v_mode_[v] = 3; } break;
          default: { const int rate = adsr2 & 31; if (rate_hit(rate)) env -= ((env - 1) >> 8) + 1; }
        }
        if (env < 0) env = 0;
      } else {
        const int g = d[r + 7];
        if (!(g & 0x80)) env = (g & 0x7F) << 4;
        else {
          const int rate = g & 31, md = (g >> 5) & 3;
          if (rate_hit(rate)) {
            if (md == 0) env -= 32; else if (md == 1) env -= ((env - 1) >> 8) + 1; else if (md == 2) env += 32; else env += env < 0x600 ? 32 : 8;
            if (env < 0) env = 0;
            if (env > 0x7FF) env = 0x7FF;
          }
        }
        if (v_mode_[v] == 1) v_mode_[v] = 3;
      }
      v_env_[v] = s16(env);
      int pitch = d[r + 2] | ((d[r + 3] & 0x3F) << 8);
      if ((d[0x2D] & bit) && v > 0) pitch = (pitch + (((pitch >> 5) * (prev_out >> 4)) >> 6)) & 0x3FFF;
      int f = v_frac_[v] + pitch;
      while (f >= 0x1000) { f -= 0x1000; advance_sample(v); if (v_mode_[v] == 0) break; }
      v_frac_[v] = f & 0xFFFF;
      const int h = v * 4, a0 = v_hist_[h], b0 = v_hist_[h + 1], c0 = v_hist_[h + 2], d0 = v_hist_[h + 3]; const double t = f / 4096.0;
      double s = b0 + 0.5 * t * (c0 - a0 + t * (2 * a0 - 5 * b0 + 4 * c0 - d0 + t * (3 * (b0 - c0) + d0 - a0)));
      if (d[0x3D] & bit) s = s16(noise_ << 1);
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      out = static_cast<std::int32_t>(static_cast<std::int32_t>(s * v_env_[v])) >> 11;
    }
    v_out_[v] = s16(out); prev_out = out;
    d[r + 8] = static_cast<std::uint8_t>((v_env_[v] >> 4) & 0x7F); d[r + 9] = static_cast<std::uint8_t>((out >> 8) & 0xFF);
    const int vl = s8(d[r]), vr = s8(d[r + 1]);
    const int l = (out * vl) >> 7, rr = (out * vr) >> 7;
    mix_l += l; mix_r += rr;
    if (d[0x4D] & bit) { echo_l += l; echo_r += rr; }
  }
  koff_ = 0; d[0x7C] = static_cast<std::uint8_t>(endx_);
  const int edl = d[0x7D] & 15, elen = edl ? edl * 2048 : 4, ebase = d[0x6D] << 8;
  const int ea = (ebase + echo_pos_) & 0xFFFF;
  const int eL = s16(ram[ea] | (ram[(ea + 1) & 0xFFFF] << 8)), eR = s16(ram[(ea + 2) & 0xFFFF] | (ram[(ea + 3) & 0xFFFF] << 8));
  int* H = echo_hist_; const int hi = echo_idx_;
  H[hi * 2] = eL >> 1; H[hi * 2 + 1] = eR >> 1;
  int fl = 0, fr = 0;
  for (int k = 0; k < 8; k++) { const int idx = (hi - 7 + k) & 7, co = s8(d[k * 16 + 0x0F]); fl += H[idx * 2] * co; fr += H[idx * 2 + 1] * co; }
  fl >>= 6; fr >>= 6; fl = clamp16(fl); fr = clamp16(fr);
  echo_idx_ = (hi + 1) & 7;
  if (!(flg & 0x20)) {
    const int efb = s8(d[0x0D]);
    int wl = echo_l + ((fl * efb) >> 7), wr_ = echo_r + ((fr * efb) >> 7);
    wl = clamp16(wl); wr_ = clamp16(wr_);
    ram[ea] = wl & 0xFF; ram[(ea + 1) & 0xFFFF] = (wl >> 8) & 0xFF; ram[(ea + 2) & 0xFFFF] = wr_ & 0xFF; ram[(ea + 3) & 0xFFFF] = (wr_ >> 8) & 0xFF;
  }
  echo_pos_ += 4; if (echo_pos_ >= elen) echo_pos_ = 0;
  const int mvl = s8(d[0x0C]), mvr = s8(d[0x1C]), evl = s8(d[0x2C]), evr = s8(d[0x3C]);
  int L = ((mix_l * mvl) >> 7) + ((fl * evl) >> 7), R = ((mix_r * mvr) >> 7) + ((fr * evr) >> 7);
  if (flg & 0x40) { L = 0; R = 0; }
  L = clamp16(L); R = clamp16(R);
  if (wp_ - rpf_ >= 60000) rpf_ = wp_ - 30000;
  sample_buf_[static_cast<std::size_t>(wp_) & 0xFFFF] = static_cast<float>(((L + R) / 65536.0) * volume_); wp_++;
}

std::size_t SnesApu::buffered() const { const double v = std::floor((wp_ - rpf_) / step_); return v > 0 ? static_cast<std::size_t>(v) : 0; }
void SnesApu::fill(float* out, std::size_t n) {
  for (std::size_t i = 0; i < n; i++) {
    const double p = rpf_, ip = std::floor(p);
    if (ip + 1 < wp_) {
      const double f = p - ip;
      last_ = static_cast<double>(sample_buf_[static_cast<std::size_t>(ip) & 0xFFFF]) * (1 - f) + static_cast<double>(sample_buf_[(static_cast<std::size_t>(ip) + 1) & 0xFFFF]) * f;
      rpf_ = p + step_;
    } else last_ = last_ * 0.995;
    out[i] = static_cast<float>(last_);
  }
}

}  // namespace emuhub
