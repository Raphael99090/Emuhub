#include "snes_ppu.h"
#include <cstdio>
#include <cstdlib>
using namespace emuhub;
static std::uint32_t s;
static int r8() { s = s * 1664525u + 1013904223u; return s >> 24; }
struct Host : SnesPpuHost { long cyc = 0; int line = 0, mdr = 0;
  long host_cycles() const override { return cyc; } int host_line() const override { return line; } int host_mdr() const override { return mdr; } };
static std::uint32_t H = 0x811c9dc5u;
static void mix(std::uint32_t v) { H = (H ^ v) * 16777619u; }
int main(int, char** v) {
  s = std::atoi(v[1]); const int frames = std::atoi(v[2]);
  Host host; SnesPpu p; p.set_host(&host); p.reset();
  auto W = [&](int a, int val) { p.write_reg(a, static_cast<std::uint8_t>(val & 255)); };
  W(0x2115, 0x80); W(0x2116, 0); W(0x2117, 0);
  for (int i = 0; i < 32768; i++) { const int a = r8(); W(0x2118, a); const int b = r8(); W(0x2119, b); }
  W(0x2102, 0); W(0x2103, 0); for (int i = 0; i < 544; i++) W(0x2104, r8());
  W(0x2121, 0); for (int i = 0; i < 512; i++) W(0x2122, r8());
  const int cfg[] = {0x2101, 0x2105, 0x2106, 0x2107, 0x2108, 0x2109, 0x210A, 0x210B, 0x210C, 0x210D, 0x210D, 0x210E, 0x210E, 0x210F, 0x210F, 0x2110, 0x2110, 0x2111, 0x2111, 0x2112, 0x2112, 0x2113, 0x2113, 0x2114, 0x2114,
    0x211A, 0x211B, 0x211B, 0x211C, 0x211C, 0x211D, 0x211D, 0x211E, 0x211E, 0x211F, 0x211F, 0x2120, 0x2120, 0x2123, 0x2124, 0x2125, 0x2126, 0x2127, 0x2128, 0x2129, 0x212A, 0x212B, 0x212C, 0x212D, 0x212E, 0x212F, 0x2130, 0x2131, 0x2132, 0x2132, 0x2132};
  const int ncfg = sizeof cfg / sizeof cfg[0];
  auto fix = [&](int a) { int val = r8(); if (a == 0x2100) val &= 0x0F; else if (a == 0x212C || a == 0x212D) val &= 0x1F; else if (a == 0x2133) val &= 0x4F; else if (a == 0x2132) val |= 0xE0 & r8(); return val; };
  for (int f = 0; f < frames; f++) {
    { int a = fix(0x2100); W(0x2100, a); }
    for (int i = 0; i < ncfg; i++) { int a = fix(cfg[i]); W(cfg[i], a); }
    { int a = fix(0x2133); W(0x2133, a); }
    if (f & 1) { const int x = r8() & 0xF8; const int y = r8() % 8; W(0x2105, x | y); }
    p.begin_frame();
    const int lines = (p.setini() & 4) ? 239 : 224;
    for (int y = 0; y < lines; y++) {
      if ((y & 15) == 7) for (int k = 0; k < 4; k++) { const int a = cfg[r8() % ncfg]; const int val = fix(a); W(a, val); }
      p.render_line(y);
    }
    p.finish_frame();
    const std::uint32_t* fr = p.frame(); for (int i = 0; i < p.width() * p.height(); i++) mix(fr[i]); mix(p.width()); mix(p.height());
    { const int a = r8(); host.cyc = (a << 4) | 5; } host.line = r8(); host.mdr = r8();
    const int rd[] = {0x2137, 0x213C, 0x213C, 0x213D, 0x213D, 0x213E, 0x2134, 0x2135, 0x2136, 0x2138, 0x2138, 0x2139, 0x213A, 0x213B, 0x213B, 0x213F};
    for (int a : rd) mix(p.read_reg(a));
  }
  std::printf("%u\n", H);
}
