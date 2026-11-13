#undef NDEBUG
// Salvar/carregar estado: rodar N quadros, salvar, rodar M, tirar hash; carregar, rodar M, hash igual.
#include "emuhub_core.h"
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <vector>
#define CHECK(c) do { if (!(c)) { std::fprintf(stderr, "FALHOU linha %d: %s\n", __LINE__, #c); return 1; } } while (0)

static std::uint64_t fnv(const std::uint8_t* p, std::size_t n, std::uint64_t h = 1469598103934665603ull) {
  for (std::size_t i = 0; i < n; i++) { h ^= p[i]; h *= 1099511628211ull; } return h;
}
static std::uint64_t hv, ha;
static std::uint64_t run(int frames) {
  std::uint64_t h = 1469598103934665603ull; hv = ha = h;
  for (int i = 0; i < frames; i++) {
    emuhub_set_buttons(static_cast<std::uint16_t>((i * 37) & 0xFF));
    emuhub_run_frame();
    hv = fnv(reinterpret_cast<const std::uint8_t*>(emuhub_video_buffer()), emuhub_video_buffer_size() * 4, hv);
    ha = fnv(reinterpret_cast<const std::uint8_t*>(emuhub_audio_buffer()), emuhub_audio_buffer_samples() * 4, ha);
    h = hv ^ (ha * 31);
  }
  return h;
}
static void check(const char* name, int con, const std::vector<std::uint8_t>& rom) {
  assert(emuhub_select_console(con) == 0);
  int r = emuhub_load_rom(rom.data(), rom.size());
  if (r != 0) { std::fprintf(stderr, "%s: load=%d\n", name, r); assert(false); }
  run(40);
  std::size_t n = emuhub_state_save();
  assert(n > 16);
  std::vector<std::uint8_t> st(emuhub_state_buffer(), emuhub_state_buffer() + n);
  std::uint64_t a = run(30), av = hv, aa = ha;
  std::uint8_t* p = emuhub_state_alloc(n); for (std::size_t i = 0; i < n; i++) p[i] = st[i];
  assert(emuhub_state_load(n) == 0);
  std::uint64_t b = run(30);
  std::fprintf(stderr, "video %s audio %s\n", av == hv ? "ok" : "DIFF", aa == ha ? "ok" : "DIFF");
  std::fprintf(stderr, "%s: %zu bytes, %llx %llx\n", name, n, (unsigned long long)a, (unsigned long long)b);
  assert(a == b);
  // truncado e de outro console são rejeitados
  p = emuhub_state_alloc(n); for (std::size_t i = 0; i < n; i++) p[i] = st[i];
  assert(emuhub_state_load(n - 5) == 2);
  p[4] ^= 1; assert(emuhub_state_load(n) == 1);
}
int main() {
  std::vector<std::uint8_t> nes(16 + 32768, 0);
  nes[0]='N'; nes[1]='E'; nes[2]='S'; nes[3]=0x1a; nes[4]=2;
  const std::uint8_t np[] = {0xA9,0x1E,0x8D,0x01,0x20, 0xE6,0x10,0xA5,0x10,0x8D,0x05,0x20,0x8D,0x00,0x40,0x8D,0x0F,0x40,0x8D,0x15,0x40, 0x4C,0x05,0x80};
  for (unsigned i = 0; i < sizeof np; i++) nes[16+i] = np[i];
  nes[16+0x7ffc]=0; nes[16+0x7ffd]=0x80;
  check("nes", 0, nes);

  std::vector<std::uint8_t> gb(32768, 0);
  gb[0x100]=0xC3; gb[0x101]=0x50; gb[0x102]=0x01;
  const std::uint8_t gp[] = {0x3C,0xE0,0x47,0xEA,0x00,0xC0,0xE0,0x42,0x18,0xF6};
  for (unsigned i = 0; i < sizeof gp; i++) gb[0x150+i] = gp[i];
  // checksum do cabeçalho
  std::uint8_t c = 0; for (int i = 0x134; i <= 0x14C; i++) c = static_cast<std::uint8_t>(c - gb[i] - 1); gb[0x14D] = c;
  check("gb", 1, gb);

  std::vector<std::uint8_t> sn(32768, 0);
  const std::uint8_t sp[] = {0xE6,0x10,0xA5,0x10,0x8D,0x21,0x21,0x8D,0x22,0x21,0x8D,0x00,0x21,0x4C,0x00,0x80};
  for (unsigned i = 0; i < sizeof sp; i++) sn[i] = sp[i];
  const char* t = "STATE TEST ROM       "; for (int i = 0; i < 21; i++) sn[0x7FC0+i] = t[i];
  sn[0x7FD5]=0x20; sn[0x7FD7]=0x08; sn[0x7FDC]=0xFF; sn[0x7FDD]=0xFF; sn[0x7FDE]=0; sn[0x7FDF]=0;
  sn[0x7FFC]=0; sn[0x7FFD]=0x80;
  check("snes", 2, sn);
  // cheats
  emuhub_select_console(0); emuhub_load_rom(nes.data(), nes.size());
  emuhub_cheat_ram(0x0020, 0x5A); emuhub_cheat_gg(0x8002, 0x99, -1); emuhub_cheat_gg(0x8003, 0x77, 0x00);
  emuhub_run_frame();
  CHECK(emuhub_nes_cpu_read(0x0020) == 0x5A); CHECK(emuhub_nes_cpu_read(0x8002) == 0x99);
  CHECK(emuhub_nes_cpu_read(0x8003) == 0x01);  // compare não bate: sem troca
  emuhub_cheats_clear(); emuhub_run_frame(); CHECK(emuhub_nes_cpu_read(0x8002) == 0x8D); 
  emuhub_select_console(2); emuhub_load_rom(sn.data(), sn.size());
  emuhub_cheat_ram(0x7E0100, 0x42); emuhub_run_frame(); CHECK(emuhub_snes_peek(0x7E0100) == 0x42);
  emuhub_cheats_clear(); 
  // bateria do NES e relógio do MBC3
  nes[6] |= 2; emuhub_select_console(0); CHECK(emuhub_load_rom(nes.data(), nes.size()) == 0);
  CHECK(emuhub_sram_battery() == 1 && emuhub_sram_size() == 8192 && emuhub_sram_data() != nullptr);
  CHECK(emuhub_nes_prg_hash() != 0);
  gb[0x147] = 0x10; gb[0x149] = 2; { std::uint8_t c2 = 0; for (int i = 0x134; i <= 0x14C; i++) c2 = static_cast<std::uint8_t>(c2 - gb[i] - 1); gb[0x14D] = c2; }
  emuhub_select_console(1); CHECK(emuhub_load_rom(gb.data(), gb.size()) == 0);
  CHECK(emuhub_gb_has_rtc() == 1 && emuhub_sram_battery() == 1);
  { std::uint8_t* b = emuhub_gb_rtc_buffer(); for (int i = 0; i < 13; i++) b[i] = static_cast<std::uint8_t>(i + 1); b[12] = 1; emuhub_gb_rtc_import();
    for (int i = 0; i < 13; i++) b[i] = 0; emuhub_gb_rtc_export(); for (int i = 0; i < 12; i++) CHECK(b[i] == i + 1); CHECK(b[12] == 1); }
  // melhorias por jogo (fumaça: rodam e não quebram o estado)
  emuhub_select_console(0); emuhub_load_rom(nes.data(), nes.size());
  emuhub_set_option(0, 1); emuhub_set_option(1, 26); emuhub_set_option(2, 21);
  for (int i = 0; i < 5; i++) CHECK(emuhub_run_frame() == 0);
  emuhub_set_option(1, 0); emuhub_set_option(2, 0);
  emuhub_select_console(1); emuhub_load_rom(gb.data(), gb.size()); emuhub_set_option(0, 1); emuhub_set_option(3, 2);
  for (int i = 0; i < 5; i++) CHECK(emuhub_run_frame() == 0);
  emuhub_select_console(2); emuhub_load_rom(sn.data(), sn.size()); emuhub_set_option(4, 500); emuhub_set_option(0, 1);
  for (int i = 0; i < 5; i++) CHECK(emuhub_run_frame() == 0);
  emuhub_set_option(4, 1000);
  std::puts("ok");
}
