#include "emuhub_core.h"
#include <algorithm>
#include <array>
#include <vector>

namespace {
constexpr std::uint32_t kAbi = 1;
constexpr std::uint32_t kWidth = 256;
constexpr std::uint32_t kHeight = 240;
constexpr std::uint32_t kSampleRate = 48000;
std::array<std::uint32_t, kWidth * kHeight> video{};
std::array<float, 2048> audio{};
std::vector<std::uint8_t> rom;
std::uint16_t buttons = 0;
bool loaded = false;
}

extern "C" {
std::uint32_t emuhub_abi_version() { return kAbi; }
std::uint32_t emuhub_video_width() { return kWidth; }
std::uint32_t emuhub_video_height() { return kHeight; }
std::uint32_t* emuhub_video_buffer() { return video.data(); }
std::size_t emuhub_video_buffer_size() { return video.size(); }
std::uint32_t emuhub_audio_sample_rate() { return kSampleRate; }
std::size_t emuhub_audio_buffer_size() { return audio.size(); }
float* emuhub_audio_buffer() { return audio.data(); }
int emuhub_load_rom(const std::uint8_t* data, std::size_t size) {
  if (!data || size < 16 || size > 64u * 1024u * 1024u) return -1;
  if (data[0] != 'N' || data[1] != 'E' || data[2] != 'S' || data[3] != 0x1a) return -2;
  rom.assign(data, data + size);
  loaded = true;
  emuhub_reset();
  return 0;
}
void emuhub_reset() { buttons = 0; video.fill(0xff100d18u); audio.fill(0.0f); }
void emuhub_set_buttons(std::uint16_t mask) { buttons = mask; }
int emuhub_run_frame() {
  // Integração real do núcleo NES será feita em uma etapa posterior.
  // Não desenha um frame falso nem declara compatibilidade antes do port e dos testes.
  return loaded ? -3 : -1;
}
void emuhub_destroy() { rom.clear(); rom.shrink_to_fit(); loaded = false; buttons = 0; }
}
