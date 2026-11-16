// Som do GBA (porte de hub/src/cores/gba/apu.js): 4 canais PSG (2 quadrados, 1 de onda, 1 de ruído) + 2 Direct Sound.
// Gera áudio mono (mistura esquerda e direita) por amostragem com 4x de sobreamostragem.
#include "gba_machine.h"
#include <algorithm>
#include <cmath>

namespace emuhub {

namespace {
const int kDuty[4][8] = {{0, 0, 0, 0, 0, 0, 0, 1}, {1, 0, 0, 0, 0, 0, 0, 1}, {1, 0, 0, 0, 0, 1, 1, 1}, {0, 1, 1, 1, 1, 1, 1, 0}};
const double kWaveVol[4] = {0, 1, 0.5, 0.25};
const double kRatio[4] = {0.25, 0.5, 1, 0};
const std::uint64_t kMask = GbaMachine::kAudioSize - 1;

template <class E> void set_env(E& c, std::uint32_t v) {   // bits 8-15: período, direção, volume inicial
  c.env_per = (v >> 8) & 7; c.env_dir = (v >> 11) & 1; c.init_vol = (v >> 12) & 15;
  c.dac = (v & 0xF800) != 0; if (!c.dac) c.on = 0;
}
template <class E> void clock_len(E& c) { if (c.len_en && c.len > 0) { c.len--; if (c.len == 0) c.on = 0; } }
template <class E> void clock_env(E& c) {
  if (c.env_per == 0) return;
  if (--c.env_t <= 0) {
    c.env_t = c.env_per;
    if (c.env_dir) { if (c.vol < 15) c.vol++; } else if (c.vol > 0) c.vol--;
  }
}
}  // namespace

void GbaMachine::apu_reset() {
  const double last = a_.last, px = a_.px, py = a_.py;
  const std::uint64_t rp = a_.rp, wp = a_.wp;
  const std::int32_t fast = a_.fast;
  std::memset(&a_, 0, sizeof(a_));
  a_.p1.has_sweep = 1;
  a_.noise.lfsr = 0x7FFF;
  a_.last = last; a_.px = px; a_.py = py; a_.rp = rp; a_.wp = wp; a_.fast = fast;
}

std::uint32_t GbaMachine::apu_read(std::uint32_t off) const {
  if (off == 0x84) return (a_.master ? 0x80 : 0) | (a_.p1.e.on ? 1 : 0) | (a_.p2.e.on ? 2 : 0) | (a_.wave.on ? 4 : 0) | (a_.noise.e.on ? 8 : 0);
  if (off >= 0x90 && off < 0xA0) { const std::uint8_t* r = a_.wave.ram[a_.wave.bank ^ 1]; const std::uint32_t i = off - 0x90; return r[i] | (static_cast<std::uint32_t>(r[i + 1]) << 8); }
  return 0;
}

void GbaMachine::apu_write(std::uint32_t off, std::uint32_t v) {
  Apu& a = a_;
  auto sw_calc = [](const Pulse& p) { const std::int32_t d = p.sw_shadow >> p.sw_shift; return p.sw_neg ? p.sw_shadow - d : p.sw_shadow + d; };
  auto trigger = [&](Pulse& p) {
    p.e.on = p.e.dac; p.e.vol = p.e.init_vol; p.e.env_t = p.e.env_per; if (p.e.len == 0) p.e.len = 64;
    if (p.has_sweep) {
      p.sw_shadow = p.freq; p.sw_t = p.sw_per ? p.sw_per : 8; p.sw_en = (p.sw_per > 0 || p.sw_shift > 0) ? 1 : 0;
      if (p.sw_shift > 0 && sw_calc(p) > 2047) p.e.on = 0;
    }
  };
  auto write_lh = [&](Pulse& p, std::uint32_t x) { p.e.len = 64 - (x & 63); p.duty = (x >> 6) & 3; set_env(p.e, x); };
  auto write_x = [&](Pulse& p, std::uint32_t x) { p.freq = x & 0x7FF; p.e.len_en = (x & 0x4000) != 0; if (x & 0x8000) trigger(p); };
  switch (off) {
    case 0x60: a.p1.sw_shift = v & 7; a.p1.sw_neg = (v & 8) != 0; a.p1.sw_per = (v >> 4) & 7; return;
    case 0x62: write_lh(a.p1, v); return;
    case 0x64: write_x(a.p1, v); return;
    case 0x68: write_lh(a.p2, v); return;
    case 0x6C: write_x(a.p2, v); return;
    case 0x70: a.wave.dual = (v & 0x20) != 0; a.wave.bank = (v >> 6) & 1; a.wave.dac = (v & 0x80) != 0; if (!a.wave.dac) a.wave.on = 0; return;
    case 0x72: a.wave.len = 256 - (v & 255); a.wave.vol_code = (v >> 13) & 3; a.wave.force = (v & 0x8000) != 0; return;
    case 0x74:
      a.wave.freq = v & 0x7FF; a.wave.len_en = (v & 0x4000) != 0;
      if (v & 0x8000) { a.wave.on = a.wave.dac; if (a.wave.len == 0) a.wave.len = 256; a.wave.pos = 0; }
      return;
    case 0x78: a.noise.e.len = 64 - (v & 63); set_env(a.noise.e, v); return;
    case 0x7C:
      a.noise.div = v & 7; a.noise.width7 = (v & 8) != 0; a.noise.shift = (v >> 4) & 15; a.noise.e.len_en = (v & 0x4000) != 0;
      if (v & 0x8000) {
        a.noise.e.on = a.noise.e.dac; a.noise.e.vol = a.noise.e.init_vol; a.noise.e.env_t = a.noise.e.env_per;
        if (a.noise.e.len == 0) a.noise.e.len = 64;
        a.noise.lfsr = 0x7FFF;
      }
      return;
    case 0x82:
      a.fifo[0].timer = (v >> 10) & 1; a.fifo[1].timer = (v >> 14) & 1;
      if (v & 0x800) { a.fifo[0].head = 0; a.fifo[0].n = 0; a.fifo[0].cur = 0; }
      if (v & 0x8000) { a.fifo[1].head = 0; a.fifo[1].n = 0; a.fifo[1].cur = 0; }
      return;
    case 0x84:
      a.master = (v & 0x80) != 0;
      if (!a.master) { a.p1.e.on = a.p2.e.on = a.wave.on = a.noise.e.on = 0; }
      return;
    default: break;
  }
  if (off >= 0x90 && off < 0xA0) { std::uint8_t* r = a.wave.ram[a.wave.bank ^ 1]; const std::uint32_t i = off - 0x90; r[i] = v & 255; r[i + 1] = static_cast<std::uint8_t>(v >> 8); }
}

void GbaMachine::fifo_push(int i, int byte) {
  Fifo& f = a_.fifo[i];
  if (f.n < 32) { f.q[(f.head + f.n) & 31] = static_cast<std::int8_t>(byte); f.n++; }
}

/* chamado pelo sistema quando o timer 0 ou 1 estoura */
void GbaMachine::apu_timer_overflow(int t, int count) {
  for (int i = 0; i < 2; i++) {
    Fifo& f = a_.fifo[i];
    if (f.timer != t) continue;
    for (int k = 0; k < count; k++) {
      if (f.n > 0) { f.cur = f.q[f.head]; f.head = (f.head + 1) & 31; f.n--; }
    }
    if (f.n <= 16) dma_fifo(i);
  }
}

void GbaMachine::apu_step_sequencer() {
  Apu& a = a_;
  const int s = a.seq_step;
  if ((s & 1) == 0) { clock_len(a.p1.e); clock_len(a.p2.e); clock_len(a.wave); clock_len(a.noise.e); }
  if (s == 2 || s == 6) {
    Pulse& p = a.p1;
    if (!(--p.sw_t > 0)) {
      p.sw_t = p.sw_per ? p.sw_per : 8;
      if (p.sw_en && p.sw_per > 0) {
        auto calc = [&]() { const std::int32_t d = p.sw_shadow >> p.sw_shift; return p.sw_neg ? p.sw_shadow - d : p.sw_shadow + d; };
        const std::int32_t nf = calc();
        if (nf > 2047) p.e.on = 0;
        else if (p.sw_shift > 0) { p.freq = nf; p.sw_shadow = nf; if (calc() > 2047) p.e.on = 0; }
      }
    }
  }
  if (s == 7) { clock_env(a.p1.e); clock_env(a.p2.e); clock_env(a.noise.e); }
  a.seq_step = (s + 1) & 7;
}

void GbaMachine::apu_run(int c) {
  a_.seq += c;
  while (a_.seq >= 32768) { a_.seq -= 32768; apu_step_sequencer(); }
  if (a_.fast) { a_.acc = 0; return; }   // turbo: sem geração de áudio
  a_.acc += c;
  while (a_.acc >= cps_) { a_.acc -= cps_; apu_gen_sample(); }
}

void GbaMachine::apu_push(double s) {
  const double y = s - a_.px + 0.996 * a_.py;
  a_.px = s; a_.py = y;
  if (a_.wp - a_.rp >= kAudioSize) a_.rp++;
  abuf_[a_.wp & kMask] = static_cast<float>(std::max(-1.0, std::min(1.0, y)) * volume_);
  a_.wp++;
}

void GbaMachine::apu_gen_sample() {
  Apu& a = a_;
  if (!a.master) { apu_push(0); return; }
  const double sub = cps_ / 4;
  double o1 = 0, o2 = 0, o3 = 0, o4 = 0;
  for (int k = 0; k < 4; k++) {
    // quadrados
    for (int n = 0; n < 2; n++) {
      Pulse& p = n == 0 ? a.p1 : a.p2;
      p.pos = std::fmod(p.pos + sub / (16.0 * (2048 - p.freq)), 8.0);
    }
    a.wave.pos = std::fmod(a.wave.pos + sub / (8.0 * (2048 - a.wave.freq)), a.wave.dual ? 64.0 : 32.0);
    {
      Noise& nz = a.noise;
      nz.acc += sub;
      const double per = static_cast<double>((nz.div ? nz.div * 32 : 16) * (1 << (nz.shift + 1)));
      while (nz.acc >= per) {
        nz.acc -= per;
        const std::int32_t x = (nz.lfsr & 1) ^ ((nz.lfsr >> 1) & 1);
        nz.lfsr = (nz.lfsr >> 1) | (x << 14);
        if (nz.width7) nz.lfsr = (nz.lfsr & ~0x40) | (x << 6);
      }
    }
    o1 += a.p1.e.on ? kDuty[a.p1.duty][static_cast<int>(a.p1.pos)] * a.p1.e.vol : 0;
    o2 += a.p2.e.on ? kDuty[a.p2.duty][static_cast<int>(a.p2.pos)] * a.p2.e.vol : 0;
    if (a.wave.on) {
      const int i = static_cast<int>(a.wave.pos), b = a.wave.dual ? (a.wave.bank + (i >> 5)) & 1 : a.wave.bank;
      const std::uint8_t byte = a.wave.ram[b][(i & 31) >> 1];
      const int nib = (i & 1) ? byte & 15 : byte >> 4;
      o3 += a.wave.force ? nib * 0.75 : nib * kWaveVol[a.wave.vol_code];
    }
    o4 += (a.noise.e.on && !(a.noise.lfsr & 1)) ? a.noise.e.vol : 0;
  }
  o1 /= 60; o2 /= 60; o3 /= 60; o4 /= 60;   // 4 subamostras x 15
  const std::uint32_t cnt = io16(0x80), ch = io16(0x82);
  const double vol_r = ((cnt & 7) + 1) / 8.0, vol_l = (((cnt >> 4) & 7) + 1) / 8.0;
  const std::uint32_t en_r = (cnt >> 8) & 15, en_l = (cnt >> 12) & 15;
  const double ratio = kRatio[ch & 3];
  const double psg_l = ((en_l & 1 ? o1 : 0) + (en_l & 2 ? o2 : 0) + (en_l & 4 ? o3 : 0) + (en_l & 8 ? o4 : 0)) * vol_l * ratio;
  const double psg_r = ((en_r & 1 ? o1 : 0) + (en_r & 2 ? o2 : 0) + (en_r & 4 ? o3 : 0) + (en_r & 8 ? o4 : 0)) * vol_r * ratio;
  const double fa = a.fifo[0].cur / 128.0 * ((ch & 4) ? 1 : 0.5), fb = a.fifo[1].cur / 128.0 * ((ch & 8) ? 1 : 0.5);
  const double l = psg_l + ((ch & 0x200) ? fa : 0) + ((ch & 0x2000) ? fb : 0);
  const double r = psg_r + ((ch & 0x100) ? fa : 0) + ((ch & 0x1000) ? fb : 0);
  apu_push((l + r) * 0.45);
}

void GbaMachine::set_audio_rate(unsigned rate) { cps_ = static_cast<double>(kClock) / rate; }
void GbaMachine::fill_audio(float* out, std::size_t n) {
  for (std::size_t i = 0; i < n; i++) {
    if (a_.rp < a_.wp) { a_.last = abuf_[a_.rp & kMask]; a_.rp++; } else a_.last *= 0.995;
    out[i] = static_cast<float>(a_.last);
  }
}

}  // namespace emuhub
