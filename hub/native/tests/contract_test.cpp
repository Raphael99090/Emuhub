#include "emuhub_core.h"
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>

int main() {
  assert(emuhub_abi_version() == 3);
  assert(emuhub_video_width() == 256);
  assert(emuhub_video_height() == 240);
  assert(emuhub_video_buffer_size() == 256u * 240u);
  assert(emuhub_audio_sample_rate() == 48000);
  assert(emuhub_load_rom(nullptr, 0) < 0);

  std::vector<std::uint8_t> ines(16 + 32768, 0);
  ines[0] = 'N'; ines[1] = 'E'; ines[2] = 'S'; ines[3] = 0x1a;
  ines[4] = 2;
  // Stable infinite loop at $8000, with the NROM reset vector.
  ines[16] = 0x4c; ines[17] = 0x00; ines[18] = 0x80;
  ines[16 + 0x7ffc] = 0x00; ines[16 + 0x7ffd] = 0x80;

  assert(emuhub_load_rom(ines.data(), ines.size()) == 0);
  assert(emuhub_nes_mapper() == 0);
  assert(emuhub_nes_prg_size() == 32768);
  assert(emuhub_nes_chr_is_ram() == 1);
  assert(emuhub_nes_chr_rom_size() == 0);
  assert(emuhub_nes_cpu_read(0x8000) == 0x4c);

  // NES 2.0 header, NROM-256, 32 KiB PRG + 8 KiB CHR.
  std::vector<std::uint8_t> nes2(16 + 32768 + 8192, 0);
  nes2[0] = 'N'; nes2[1] = 'E'; nes2[2] = 'S'; nes2[3] = 0x1a;
  nes2[4] = 2; nes2[5] = 1; nes2[6] = 0x01; nes2[7] = 0x08;
  nes2[16] = 0x4c; nes2[17] = 0x00; nes2[18] = 0x80;
  nes2[16 + 0x7ffc] = 0x00; nes2[16 + 0x7ffd] = 0x80;
  assert(emuhub_load_rom(nes2.data(), nes2.size()) == 0);
  assert(emuhub_nes_mapper() == 0);
  assert(emuhub_nes_prg_size() == 32768);
  assert(emuhub_nes_chr_is_ram() == 0);
  assert(emuhub_nes_chr_rom_size() == 8192);
  assert(emuhub_nes_cpu_read(0x8000) == 0x4c);

  assert(emuhub_video_buffer() != nullptr);
  assert(emuhub_run_frame() == 0);
  assert(emuhub_audio_buffer_samples() > 0);
  for (std::size_t i = 0; i < emuhub_audio_buffer_samples(); ++i)
    assert(std::isfinite(emuhub_audio_buffer()[i]));

  emuhub_set_buttons(0x01);
  emuhub_reset();
  assert(emuhub_audio_buffer_samples() == 0);
  emuhub_destroy();

  // Game Boy pela mesma interface
  assert(emuhub_select_console(7) < 0);
  assert(emuhub_select_console(1) == 0 && emuhub_console() == 1);
  assert(emuhub_video_width() == 160 && emuhub_video_height() == 144);
  assert(emuhub_video_buffer_size() == 160u * 144u);
  std::vector<std::uint8_t> gbrom(0x8000, 0);
  const std::uint8_t prog[] = {0x3E, 0x07, 0xEA, 0x00, 0xC0, 0x18, 0xFE};
  for (std::size_t i = 0; i < sizeof prog; ++i) gbrom[0x100 + i] = prog[i];
  assert(emuhub_load_rom(gbrom.data(), gbrom.size()) == 0);
  assert(emuhub_run_frame() == 0);
  assert(emuhub_audio_buffer_samples() > 0);
  assert(emuhub_sram_battery() == 0);
  gbrom[0x147] = 0x03; gbrom[0x149] = 2;  // MBC1+RAM+BATTERY, 8 KB
  assert(emuhub_load_rom(gbrom.data(), gbrom.size()) == 0);
  assert(emuhub_sram_battery() == 1 && emuhub_sram_size() == 0x2000 && emuhub_sram_data() != nullptr);
  assert(emuhub_select_console(0) == 0 && emuhub_video_width() == 256);

  // SNES: LoROM mínima com cabeçalho válido roda e gera quadro 256x224
  std::vector<std::uint8_t> sfc(0x10000, 0);
  for (int i = 0; i < 21; ++i) sfc[0x7FC0 + i] = 'A' + i;
  sfc[0x7FD5] = 0x20; sfc[0x7FDC] = 0xFF; sfc[0x7FDD] = 0xFF;
  sfc[0x8000] = 0x80; sfc[0x8001] = 0xFE;  // BRA -2
  sfc[0x7FFC] = 0x00; sfc[0x7FFD] = 0x80;
  assert(emuhub_select_console(2) == 0);
  assert(emuhub_load_rom(sfc.data(), sfc.size()) == 0);
  assert(emuhub_run_frame() == 0);
  assert(emuhub_video_width() == 256 && emuhub_video_height() == 224);
  sfc[0x7FD6] = 0x13;  // Super FX: ainda só no núcleo JS
  assert(emuhub_load_rom(sfc.data(), sfc.size()) == 2);
  sfc[0x7FD6] = 0x00; sfc[0x7FD5] = 0x00; sfc[0x7FDC] = 0; sfc[0x7FDD] = 0;
  for (int i = 0; i < 21; ++i) sfc[0x7FC0 + i] = 0;
  assert(emuhub_load_rom(sfc.data(), sfc.size()) == 1);  // cabeçalho irreconhecível
  return 0;
}
