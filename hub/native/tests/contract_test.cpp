#include "emuhub_core.h"
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>

int main() {
  assert(emuhub_abi_version() == 2);
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
  assert(emuhub_video_buffer() != nullptr);
  assert(emuhub_run_frame() == 0);
  assert(emuhub_audio_buffer_samples() > 0);
  for (std::size_t i = 0; i < emuhub_audio_buffer_samples(); ++i)
    assert(std::isfinite(emuhub_audio_buffer()[i]));

  emuhub_set_buttons(0x01);
  emuhub_reset();
  assert(emuhub_audio_buffer_samples() == 0);
  emuhub_destroy();
  return 0;
}
