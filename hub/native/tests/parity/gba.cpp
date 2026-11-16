#include "gba_machine.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
using namespace emuhub;
static std::uint32_t fnv(std::uint32_t h, std::uint32_t v) { return (h ^ v) * 16777619u; }
int main(int, char** v) {
  std::ifstream f(v[1], std::ios::binary);
  std::vector<std::uint8_t> r((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  int frames = std::atoi(v[2]); int btn = std::atoi(v[3]);
  GbaMachine g;
  if (g.load_rom(r.data(), r.size()) != GbaError::Ok) { std::puts("rom invalida"); return 1; }
  g.set_audio_rate(44100); g.set_buttons(static_cast<std::uint16_t>(btn));
  std::uint32_t h = 0x811c9dc5u;
  for (int i = 0; i < frames; i++) { g.run_frame(); for (auto p : g.framebuffer()) h = fnv(h, p); }
  std::uint32_t a = 0x811c9dc5u; const std::size_t n = g.audio_buffered(); std::vector<float> buf(n); g.fill_audio(buf.data(), n);
  for (std::size_t i = 0; i < n; i++) { std::uint32_t u; std::memcpy(&u, &buf[i], 4); a = fnv(a, u); }
  std::uint32_t m = 0x811c9dc5u;
  for (int i = 0; i < 0x40000; i++) m = fnv(m, g.ewram()[i]);
  for (int i = 0; i < 0x8000; i++) m = fnv(m, g.iwram()[i]);
  for (int i = 0; i < 0x400; i++) m = fnv(m, g.io_regs()[i]);
  for (int i = 0; i < 0x18000; i++) m = fnv(m, g.vram()[i]);
  for (int i = 0; i < 0x400; i++) m = fnv(m, g.pal()[i]);
  for (int i = 0; i < 0x400; i++) m = fnv(m, g.oam()[i]);
  std::printf("%u %u %zu %u", h, a, n, m);
  for (int i = 0; i < 16; i++) std::printf(" %u", g.reg(i));
  std::printf(" %u\n", g.cpsr());
}
