#include "snes_cpu.h"
#include <cstdio>
#include <vector>
using namespace emuhub;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
struct Ram : SnesBus {
  std::vector<std::uint8_t> m = std::vector<std::uint8_t>(1 << 24, 0); long cyc = 0;
  std::uint8_t read(std::uint32_t a) override { cyc += 6; return m[a & 0xFFFFFF]; }
  void write(std::uint32_t a, std::uint8_t v) override { cyc += 6; m[a & 0xFFFFFF] = v; }
  void idle(int n) override { cyc += 6 * n; }
  void put(std::uint32_t a, std::initializer_list<int> b) { for (int v : b) m[a++] = static_cast<std::uint8_t>(v); }
};
int main() {
  Ram r; r.put(0xFFFC, {0x00, 0x80});
  r.put(0x8000, {0x18, 0xFB,              // CLC; XCE -> modo nativo
                 0xC2, 0x30,              // REP #$30 (A,X,Y de 16 bits)
                 0xA9, 0x34, 0x12,        // LDA #$1234
                 0x18, 0x69, 0x11, 0x11,  // CLC; ADC #$1111 -> $2345
                 0x8D, 0x00, 0x20,        // STA $2000
                 0x20, 0x20, 0x80,        // JSR $8020
                 0xE2, 0x20,              // SEP #$20
                 0xF8, 0xA9, 0x19, 0x69, 0x01,  // SED; LDA #$19; ADC #$01 -> BCD $20
                 0xDB});                  // STP
  r.put(0x8020, {0xA2, 0xCD, 0xAB, 0x60});  // LDX #$ABCD; RTS
  Snes65816 c(&r); c.reset();
  CHECK(c.pc == 0x8000 && c.e == 1);
  for (int i = 0; i < 40 && !c.stp; i++) c.step();
  CHECK(c.stp); CHECK(c.e == 0);
  CHECK(r.m[0x2000] == 0x45 && r.m[0x2001] == 0x23);
  CHECK(c.x == 0xABCD);
  CHECK((c.a & 0xFF) == 0x20);   // BCD
  CHECK((c.a >> 8) == 0x23);     // byte alto preservado em modo M=8
  CHECK(c.bad_opcode < 0);
  // NMI em modo nativo empilha PB, PC, P e vai para o vetor $FFEA
  Ram q; q.put(0xFFFC, {0x00, 0x80}); q.put(0xFFEA, {0x00, 0x90}); q.put(0x8000, {0x18, 0xFB, 0xEA}); q.put(0x9000, {0xDB});
  Snes65816 n(&q); n.reset(); n.step(); n.step(); q.nmi_pending = true; n.step();
  CHECK(n.pc == 0x9000 && (n.p & Snes65816::I));
  n.step(); CHECK(n.stp);
  std::printf(fails ? "snes_cpu_test: %d FAILED\n" : "snes_cpu_test: ok\n", fails);
  return fails != 0;
}
