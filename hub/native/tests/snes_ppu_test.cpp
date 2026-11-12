#include "snes_ppu.h"
#include <cstdio>
using namespace emuhub;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
struct Host : SnesPpuHost { long host_cycles() const override { return 0; } int host_line() const override { return 0; } int host_mdr() const override { return 0; } };
int main() {
  Host h; SnesPpu p; p.set_host(&h); p.reset();
  auto W = [&](int a, int v) { p.write_reg(a, static_cast<std::uint8_t>(v)); };
  W(0x2100, 0x0F);                       // tela ligada, brilho máximo
  W(0x2105, 0); W(0x2107, 0); W(0x210B, 1);  // modo 0, mapa em 0, caracteres na palavra $1000
  W(0x212C, 0x01);                       // BG1 na tela principal
  W(0x2115, 0x80); W(0x2116, 0x00); W(0x2117, 0x10);  // VRAM palavra $1000, incrementa após o byte alto
  for (int i = 0; i < 8; i++) { W(0x2118, 0xFF); W(0x2119, 0x00); }  // tile 0: plano 0 cheio = cor 1
  W(0x2121, 1); W(0x2122, 0x1F); W(0x2122, 0x00);    // cor 1 = vermelho
  p.begin_frame();
  for (int y = 0; y < 224; y++) p.render_line(y);
  p.finish_frame();
  CHECK(p.width() == 256 && p.height() == 224);
  CHECK(p.frame()[0] == 0xFF0000FFu);
  CHECK(p.frame()[7] == 0xFF0000FFu);
  W(0x2100, 0x80);                       // blanking forçado
  p.begin_frame(); for (int y = 0; y < 224; y++) p.render_line(y); p.finish_frame();
  CHECK(p.frame()[0] == 0xFF000000u);
  W(0x2133, 0x01);                       // entrelaçado: altura dobra
  p.begin_frame(); for (int y = 0; y < 224; y++) p.render_line(y); p.finish_frame();
  CHECK(p.height() == 448);
  std::printf(fails ? "snes_ppu_test: %d FAILED\n" : "snes_ppu_test: ok\n", fails);
  return fails != 0;
}
