#include "neogeo_machine.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
using namespace emuhub;
static std::uint32_t fnv(std::uint32_t h, std::uint32_t v) { return (h ^ v) * 16777619u; }
static std::vector<std::uint8_t> rd(const std::string& d, const char* n) {
  std::ifstream f(d + "/" + n + ".bin", std::ios::binary);
  return std::vector<std::uint8_t>((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}
int main(int, char** v) {
  int frames = std::atoi(v[1]); int btn = std::atoi(v[2]); std::string dir = v[3];
  NeoGeoMachine g; NeoGeoMachine::Bios b; b.bios = rd(dir, "bios"); b.sfix = rd(dir, "sfix"); g.set_bios(b);
  NeoGeoMachine::Set s; s.p = rd(dir, "p"); s.s = rd(dir, "s"); s.m1 = rd(dir, "m1"); s.v = rd(dir, "v"); s.c1 = rd(dir, "c1"); s.c2 = rd(dir, "c2");
  std::string err; if (!g.load_set(std::move(s), &err)) { std::printf("erro %s\n", err.c_str()); return 1; }
  g.set_audio_rate(44100); g.set_buttons(static_cast<std::uint16_t>(btn));
  std::uint32_t h = 0x811c9dc5u;
  for (int i = 0; i < frames; i++) { g.run_frame(); for (auto p : g.framebuffer()) h = fnv(h, p); }
  std::uint32_t a = 0x811c9dc5u; const std::size_t n = g.audio_buffered(); std::vector<float> buf(n); g.fill_audio(buf.data(), n);
  for (std::size_t i = 0; i < n; i++) { std::uint32_t u; std::memcpy(&u, &buf[i], 4); a = fnv(a, u); }
  std::uint32_t m = 0x811c9dc5u;
  for (int i = 0; i < 0x10000; i++) m = fnv(m, g.wram()[i]);
  for (int i = 0; i < 0x8800; i++) m = fnv(m, g.vram()[i]);
  const auto& c = g.cpu().st(); const auto& z = g.z80().regs();
  std::printf("%u %u %zu %u %d", h, a, n, m, c.pc);
  for (int i = 0; i < 8; i++) std::printf(" %d", c.d[i]);
  std::printf(" %d %u %u %u %u %u %u %u %u %u\n", c.a[7], c.x, c.n, c.z, c.v, c.c, z.pc, z.sp, z.R[7], z.f);
}
