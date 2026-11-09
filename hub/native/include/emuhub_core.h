#pragma once
#include <cstdint>
#include <cstddef>

#if defined(__EMSCRIPTEN__)
#  define EMUHUB_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#  define EMUHUB_EXPORT
#endif

extern "C" {
EMUHUB_EXPORT std::uint32_t emuhub_abi_version();
EMUHUB_EXPORT std::uint32_t emuhub_video_width();
EMUHUB_EXPORT std::uint32_t emuhub_video_height();
EMUHUB_EXPORT std::uint32_t* emuhub_video_buffer();
EMUHUB_EXPORT std::size_t emuhub_video_buffer_size();
EMUHUB_EXPORT std::uint32_t emuhub_audio_sample_rate();
EMUHUB_EXPORT std::size_t emuhub_audio_buffer_size();
EMUHUB_EXPORT float* emuhub_audio_buffer();
EMUHUB_EXPORT int emuhub_load_rom(const std::uint8_t* data, std::size_t size);
EMUHUB_EXPORT void emuhub_reset();
EMUHUB_EXPORT void emuhub_set_buttons(std::uint16_t mask);
EMUHUB_EXPORT int emuhub_run_frame();
EMUHUB_EXPORT void emuhub_destroy();
}
