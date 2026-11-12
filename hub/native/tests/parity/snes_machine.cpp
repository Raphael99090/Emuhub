// Máquina SNES completa via ABI nativa (emuhub_*), para comparar com o núcleo JS.
#include "emuhub_core.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
static std::uint32_t HS[3] = {0x811c9dc5u, 0x811c9dc5u, 0x811c9dc5u};
static int cur = 0;
static void mix(std::uint32_t v) { HS[cur] = (HS[cur] ^ v) * 16777619u; }
int main(int, char** v) {
  std::ifstream f(v[1], std::ios::binary); std::vector<std::uint8_t> rom((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  const int frames = std::atoi(v[2]);
  emuhub_select_console(2);
  if (emuhub_load_rom(rom.data(), rom.size()) != 0) { std::printf("load falhou\n"); return 1; }
  emuhub_set_audio_sample_rate(48000);
  for (int i = 0; i < frames; i++) {
    emuhub_set_buttons(static_cast<std::uint16_t>((i * 0x155) & 0xFFF)); emuhub_run_frame();
    cur = 0; const std::uint32_t* fr = emuhub_video_buffer(); const std::size_t n = emuhub_video_buffer_size();
    for (std::size_t k = 0; k < n; k++) mix(fr[k]);
    mix(emuhub_video_width()); mix(emuhub_video_height());
    // áudio: o JS pergunta buffered() e pede min(n,2048); o ABI já entrega isso por quadro
    cur = 1; const std::size_t cnt = emuhub_audio_buffer_samples(); mix(static_cast<std::uint32_t>(cnt));
    const float* a = emuhub_audio_buffer(); for (std::size_t k = 0; k < cnt; k++) { std::uint32_t u; std::memcpy(&u, &a[k], 4); mix(u); }
  }
  cur = 2; for (std::uint32_t a = 0; a < 0x20000; a++) mix(emuhub_snes_peek(0x7E0000 + a));
  std::printf("%u %u %u\n", HS[0], HS[1], HS[2]);
}
