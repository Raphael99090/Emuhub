#include "snes_system.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace emuhub;
struct Ppu : SnesPpuIface {
  std::uint32_t h = 1; std::uint8_t regs[0x100] = {}; int si = 0;
  void reset() override { h = 1; for (auto& r : regs) r = 0; si = 0; }
  std::uint8_t read_reg(std::uint32_t) override { return (h >> 3) & 255; }
  void write_reg(std::uint32_t a, std::uint8_t v) override { regs[a & 255] = v; if ((a & 255) == 0x33) si = v; h = h * 31u + a * 257u + v; }
  void render_line(int y) override { h = h * 17u + y; }
  void begin_frame() override { h ^= 0x1234; }
  void finish_frame() override { h ^= 0x4321; }
  int setini() const override { return si; }
};
struct Apu : SnesApuIface {
  std::uint8_t in[4] = {}, out[4] = {}; std::uint32_t h = 7;
  void reset() override { for (auto& i : in) i = 0; h = 7; }
  void sync(long cyc) { for (int i = 0; i < 4; i++) out[i] = (in[i] + (cyc >> 4)) & 255; }
  std::uint8_t read_port(int p, long cyc) override { sync(cyc); return out[p]; }
  void write_port(int p, std::uint8_t v, long cyc) override { sync(cyc); in[p] = v; }
  void sync_line(long cyc) override { h ^= static_cast<std::uint32_t>(cyc); sync(cyc); }
};
static std::uint32_t hsh(const std::vector<std::uint8_t>& v) { std::uint32_t h = 0x811c9dc5u; for (auto x : v) h = (h ^ x) * 16777619u; return h; }
int main(int, char** v) {
  std::vector<std::uint8_t> rom(1 << 17); std::uint32_t s = std::atoi(v[1]); int frames = std::atoi(v[2]); int hi = v[3] ? std::atoi(v[3]) : 0;
  for (auto& x : rom) { s = s * 1664525u + 1013904223u; x = s >> 24; if (x == 0xDB) x = 0xEA; }
  const int pro[] = {0xA9,0xB1,0x8D,0x00,0x42, 0xA9,0x40,0x8D,0x09,0x42, 0xA9,0x90,0x8D,0x07,0x42, 0xA9,0x01,0x8D,0x0D,0x42,
    0xA9,0x02,0x8D,0x00,0x43, 0xA9,0x26,0x8D,0x01,0x43, 0xA9,0x00,0x8D,0x02,0x43, 0xA9,0x90,0x8D,0x03,0x43, 0xA9,0x00,0x8D,0x04,0x43,
    0xA9,0x01,0x8D,0x10,0x43, 0xA9,0x18,0x8D,0x11,0x43, 0xA9,0x00,0x8D,0x12,0x43, 0xA9,0x91,0x8D,0x13,0x43, 0xA9,0x00,0x8D,0x14,0x43,
    0xA9,0x20,0x8D,0x15,0x43, 0xA9,0x00,0x8D,0x16,0x43, 0xA9,0x02,0x8D,0x0B,0x42, 0xA9,0x01,0x8D,0x0C,0x42, 0x58};
  const int n = sizeof pro / sizeof pro[0];
  for (int i = 0; i < n; i++) rom[i] = pro[i];
  if (hi) { for (int i = 0; i < n; i++) rom[i] = 0xEA; for (int i = 0; i < n; i++) rom[0x8000 + i] = pro[i]; rom[0xFFFC] = 0; rom[0xFFFD] = 0x80; }
  else { rom[0x7FFC] = 0; rom[0x7FFD] = 0x80; }
  Ppu ppu; Apu apu; SnesSystem g(&ppu, &apu); g.load(rom.data(), rom.size(), hi != 0, 0x2000);
  for (int f = 0; f < frames; f++) { g.set_buttons((f * 0x155) & 0xFFF); g.run_frame(); }
  auto& c = g.cpu();
  std::printf("%ld %d %u %u %u %u %d %d %d %d %d %d %d %d %d %d %d %d %d\n", g.cycles(), g.line(), hsh(g.wram()), hsh(g.sram()), ppu.h, apu.h, c.a, c.x, c.y, c.s, c.d, c.db, c.pb, c.pc, c.p, c.e, g.debug_rdnmi(), g.debug_timeup(), g.debug_nmitimen());
}
