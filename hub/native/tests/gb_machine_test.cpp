#include "gb_machine.h"
#include <cstdio>
#include <vector>
using namespace emuhub;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)

static std::vector<std::uint8_t> make_rom() {
  std::vector<std::uint8_t> r(0x8000, 0);
  const std::uint8_t prog[] = {
    0x3E, 0x91, 0xE0, 0x40,        // LCDC on
    0x3E, 0xE4, 0xE0, 0x47,        // BGP
    0x21, 0x00, 0x80, 0x3E, 0xFF,  // HL=8000 A=FF
    0x22, 0x22, 0x22, 0x22,        // tile 0 rows -> color 3
    0x3E, 0x05, 0xC6, 0x03,        // A=8 (ADD)
    0xEA, 0x00, 0xC0,              // LD (C000),A
    0x18, 0xFE};                   // JR -2
  for (size_t i = 0; i < sizeof prog; i++) r[0x100 + i] = prog[i];
  r[0x147] = 0; r[0x148] = 0; r[0x149] = 0;
  return r;
}
int main() {
  auto rom = make_rom();
  GbMachine m;
  CHECK(m.load_rom(rom.data(), 10) == GbError::TooSmall);
  CHECK(m.load_rom(rom.data(), rom.size(), false) == GbError::Ok);
  for (int i = 0; i < 3; i++) m.run_frame();
  CHECK(m.read(0xC000) == 8);
  CHECK(m.read(0x8000) == 0xFF);
  CHECK(m.read(0xFF40) == 0x91);
  CHECK(m.framebuffer()[0] == 0xFF201808);  // tile 0 color 3 via BGP E4
  GbMachine a, b; a.load_rom(rom.data(), rom.size(), false); b.load_rom(rom.data(), rom.size(), false);
  std::uint64_t ha = 1469598103934665603ull, hb = ha;
  for (int f = 0; f < 30; f++) {
    a.run_frame(); b.run_frame();
    for (auto p : a.framebuffer()) ha = (ha ^ p) * 1099511628211ull;
    for (auto p : b.framebuffer()) hb = (hb ^ p) * 1099511628211ull;
  }
  CHECK(ha == hb);
  CHECK(a.regs().pc >= 0x100);
  std::printf(fails ? "gb_machine_test: %d FAILED\n" : "gb_machine_test: ok\n", fails);
  return fails != 0;
}
