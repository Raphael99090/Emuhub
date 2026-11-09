#include "emuhub_core.h"
#include <array>
#include <cassert>
#include <cstdint>

int main() {
  assert(emuhub_abi_version() == 1);
  assert(emuhub_video_width() == 256);
  assert(emuhub_video_height() == 240);
  assert(emuhub_video_buffer_size() == 256u * 240u);
  assert(emuhub_audio_sample_rate() == 48000);
  assert(emuhub_load_rom(nullptr, 0) < 0);

  std::array<std::uint8_t, 16> ines{};
  ines[0] = 'N'; ines[1] = 'E'; ines[2] = 'S'; ines[3] = 0x1a;
  assert(emuhub_load_rom(ines.data(), ines.size()) == 0);
  // Explicitly verifies the scaffold does not pretend to emulate yet.
  assert(emuhub_run_frame() == -3);
  emuhub_reset();
  emuhub_destroy();
  return 0;
}
