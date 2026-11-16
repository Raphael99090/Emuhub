#include "sms_machine.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>
using namespace emuhub;
int main(int, char** v) {
  std::uint32_t s = std::atoi(v[1]); int frames = std::atoi(v[2]); bool gg = std::atoi(v[3]) != 0; int btn = v[4] ? std::atoi(v[4]) : 0;
  std::vector<std::uint8_t> r(0x8000, 0);
  auto rnd = [&]() { s = s * 1664525u + 1013904223u; return static_cast<std::uint8_t>(s >> 24); };
  for (int i = 0x100; i < 0x8000; i++) r[i] = rnd();
  const std::uint8_t a0[] = {0xF3, 0xED, 0x56, 0xC3, 0x00, 0x01}, a1[] = {0xF5, 0xDB, 0xBF, 0xF1, 0xFB, 0xED, 0x4D}, a2[] = {0xED, 0x45};
  for (int i = 0; i < 6; i++) r[i] = a0[i];
  for (int i = 0; i < 7; i++) r[0x38 + i] = a1[i];
  for (int i = 0; i < 2; i++) r[0x66 + i] = a2[i];
  int pc = 0x100; r[pc++] = 0x31; r[pc++] = 0xF0; r[pc++] = 0xDF;
  for (int k = 0; k < 900; k++) { const std::uint8_t p = (std::uint8_t[]){0xBF, 0xBE, 0xBE, 0x7F}[rnd() & 3]; const std::uint8_t d = rnd(); r[pc++] = 0x3E; r[pc++] = d; r[pc++] = 0xD3; r[pc++] = p; }
  r[pc++] = 0xFB; r[pc++] = 0x76; r[pc++] = 0x18; r[pc++] = 0xFD;
  SmsMachine m(gg); m.load_rom(r.data(), r.size()); m.set_audio_rate(44100); m.set_buttons(static_cast<std::uint16_t>(btn));
  std::uint32_t h = 0x811c9dc5u;
  for (int f = 0; f < frames; f++) { m.run_frame(); for (auto p : m.framebuffer()) h = (h ^ p) * 16777619u; }
  std::uint32_t a = 0x811c9dc5u; const std::size_t n = m.audio_buffered(); std::vector<float> buf(n); m.fill_audio(buf.data(), n);
  for (std::size_t i = 0; i < n; i++) { std::uint32_t u; std::memcpy(&u, &buf[i], 4); a = (a ^ u) * 16777619u; }
  auto g = m.regs();
  std::printf("%u %u %zu %d %d %d %d %d %d %d %d %d %d %d %d\n", h, a, n, g.pc, g.sp, g.a, g.f, g.b, g.c, g.d, g.e, g.h, g.l, g.ix, g.iy);
}
