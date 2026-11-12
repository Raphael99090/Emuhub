#include "snes_system.h"
#include <cstdio>
#include <vector>
using namespace emuhub;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
struct Ppu : SnesPpuIface {
  int lines = 0, frames = 0; std::uint8_t last = 0;
  void reset() override {} std::uint8_t read_reg(std::uint32_t) override { return 0; }
  void write_reg(std::uint32_t a, std::uint8_t v) override { if (a == 0x2118) last = v; }
  void render_line(int) override { lines++; } void begin_frame() override {} void finish_frame() override { frames++; }
  int setini() const override { return 0; }
};
struct Apu : SnesApuIface {
  void reset() override {} std::uint8_t read_port(int, long) override { return 0; } void write_port(int, std::uint8_t, long) override {} void sync_line(long) override {}
};
int main() {
  std::vector<std::uint8_t> rom(0x8000, 0xEA);
  const int prog[] = {0xA9, 0x80, 0x8D, 0x00, 0x42,           // NMI ligado
                      0xA9, 0x00, 0x8D, 0x00, 0x43,           // DMA ch0: modo 0, A->B
                      0xA9, 0x18, 0x8D, 0x01, 0x43,           // destino $2118
                      0xA9, 0x00, 0x8D, 0x02, 0x43, 0xA9, 0x81, 0x8D, 0x03, 0x43, 0xA9, 0x00, 0x8D, 0x04, 0x43,  // origem $00:8100
                      0xA9, 0x01, 0x8D, 0x05, 0x43, 0xA9, 0x00, 0x8D, 0x06, 0x43,  // 1 byte
                      0xA9, 0x01, 0x8D, 0x0B, 0x42,           // dispara
                      0x4C, 0x00, 0x00 + 0x80};               // laço
  for (size_t i = 0; i < sizeof prog / sizeof prog[0]; i++) rom[i] = static_cast<std::uint8_t>(prog[i]);
  rom[0x100] = 0x5A; rom[0x7FFC] = 0x00; rom[0x7FFD] = 0x80;
  Ppu ppu; Apu apu; SnesSystem s(&ppu, &apu); s.load(rom.data(), rom.size(), false, 0);
  s.run_frame();
  CHECK(ppu.frames == 1);
  CHECK(ppu.lines == 224);        // linhas 1..224 visíveis
  CHECK(ppu.last == 0x5A);        // DMA copiou o byte da ROM para $2118
  s.set_buttons(0x01);            // A
  s.run_frame();
  std::printf(fails ? "snes_system_test: %d FAILED\n" : "snes_system_test: ok\n", fails);
  return fails != 0;
}
