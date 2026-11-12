#include "snes_apu.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
using namespace emuhub;
static std::uint32_t s;
static int r8() { s = s * 1664525u + 1013904223u; return s >> 24; }
static std::uint32_t H = 0x811c9dc5u;
static void mix(std::uint32_t v) { H = (H ^ v) * 16777619u; }
int main(int, char** v) {
  s = std::atoi(v[1]); const int frames = std::atoi(v[2]);
  SnesApu a; a.reset(); a.set_sample_rate(48000);
  for (int i = 0; i < 65536; i++) { int b = r8(); if (i >= 0x200 && (b == 0xEF || b == 0xFF)) b = 0; a.ram()[i] = static_cast<std::uint8_t>(b); }
  for (int r = 0; r < 128; r++) {
    int val = r8();
    if (r == 0x6C) val &= 0x3F;
    if (r == 0x7D) val &= 3;
    if (r == 0x7C) continue;
    if ((r & 15) == 5 && (r8() & 1)) val |= 0x80;
    if (r == 0x4C || r == 0x5C) continue;
    a.dsp()[r] = static_cast<std::uint8_t>(val);
  }
  { const int k = r8() | 1; a.dsp_write(0x4C, k); }
  a.start(0x200);
  for (int f = 0; f < frames; f++) {
    for (int line = 0; line < 262; line++) {
      const long t = 1364 + (r8() & 15);
      if ((line & 31) == 5) { a.read_port(0, t); /* sync(t) */ const int p = r8() & 3; const int val = r8(); a.write_port(p, static_cast<std::uint8_t>(val), t); }
      if ((line & 31) == 9) { const int p = r8() & 3; mix(a.read_port(p, t)); }
      if ((line & 63) == 11) { const int val = r8(); a.dsp_write(0x4C, val); }
      if ((line & 63) == 40) { const int val = r8(); a.dsp_write(0x5C, val); }
      a.sync_line(t);
    }
    const std::size_t n = a.buffered(); mix(static_cast<std::uint32_t>(n));
    std::vector<float> out(n < 1200 ? n : 1200); a.fill(out.data(), out.size());
    for (float x : out) { std::uint32_t u; std::memcpy(&u, &x, 4); mix(u); }
  }
  for (int i = 0; i < 65536; i++) mix(a.ram()[i]);
  for (int i = 0; i < 128; i++) mix(a.dsp()[i]);
  const auto g = a.regs();
  mix(g.a); mix(g.x); mix(g.y); mix(g.sp); mix(g.pc); mix(g.psw); mix(a.running() ? 1 : 0);
  std::printf("%u\n", H);
}
