#include "snes_apu.h"
#include <cstdio>
#include <vector>
using namespace emuhub;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
// Dá tempo ao SPC passando linhas de 1364 ciclos mestres
static void run_lines(SnesApu& a, int n) { for (int i = 0; i < n; i++) a.sync_line(1364); }
int main() {
  SnesApu a; a.set_sample_rate(48000);
  run_lines(a, 2);
  CHECK(a.out_port(0) == 0xAA && a.out_port(1) == 0xBB);  // assinatura do IPL
  // protocolo de upload: CC, destino $0200, 2 bytes, depois "executar" em $0200
  auto send = [&](int p0, int p1, int p2, int p3, int wait_for) {
    a.write_port(1, static_cast<std::uint8_t>(p1), 1364); a.write_port(2, static_cast<std::uint8_t>(p2), 1364); a.write_port(3, static_cast<std::uint8_t>(p3), 1364);
    a.write_port(0, static_cast<std::uint8_t>(p0), 1364);
    for (int k = 0; k < 8 && a.out_port(0) != wait_for; k++) run_lines(a, 1);
  };
  send(0xCC, 0x01, 0x00, 0x02, 0xCC);              // cabeçalho: dados para $0200
  send(0x00, 0xE8, 0, 0, 0x00);                    // byte 0: MOV A,#
  send(0x01, 0x7B, 0, 0, 0x01);                    // byte 1: #$7B
  send(0x02, 0xC4, 0, 0, 0x02);                    // byte 2: MOV $F4,A  (grava na porta de saída 0)
  send(0x03, 0xF4, 0, 0, 0x03);
  send(0x04, 0x2F, 0, 0, 0x04);                    // BRA -2 (laço)
  send(0x05, 0xFE, 0, 0, 0x05);
  send(0x07, 0x00, 0x00, 0x02, 0x07);              // executar em $0200
  CHECK(a.running());
  run_lines(a, 4);
  CHECK(a.out_port(0) == 0x7B);                    // o programa do SPC escreveu na porta
  std::printf(fails ? "snes_apu_test: %d FAILED\n" : "snes_apu_test: ok\n", fails);
  return fails != 0;
}
