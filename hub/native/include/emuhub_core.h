#pragma once
#include <cstddef>
#include <cstdint>
#if defined(__EMSCRIPTEN__)
# include <emscripten/emscripten.h>
# define EMUHUB_EXPORT EMSCRIPTEN_KEEPALIVE
#else
# define EMUHUB_EXPORT
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
EMUHUB_EXPORT int emuhub_load_rom(const std::uint8_t*,std::size_t);
EMUHUB_EXPORT void emuhub_reset();
EMUHUB_EXPORT void emuhub_set_buttons(std::uint16_t);
EMUHUB_EXPORT int emuhub_run_frame();
EMUHUB_EXPORT void emuhub_destroy();
EMUHUB_EXPORT std::uint32_t emuhub_nes_mapper();
EMUHUB_EXPORT unsigned emuhub_nes_cpu_step();
EMUHUB_EXPORT std::uint32_t emuhub_nes_cpu_pc();
EMUHUB_EXPORT std::uint64_t emuhub_nes_cpu_cycles();
EMUHUB_EXPORT std::size_t emuhub_nes_prg_size();
EMUHUB_EXPORT std::size_t emuhub_nes_chr_rom_size();
EMUHUB_EXPORT int emuhub_nes_chr_is_ram();
EMUHUB_EXPORT std::uint32_t emuhub_nes_flags();
EMUHUB_EXPORT std::uint32_t emuhub_nes_cpu_read(std::uint32_t);
EMUHUB_EXPORT void emuhub_nes_cpu_write(std::uint32_t,std::uint32_t);
EMUHUB_EXPORT std::uint32_t emuhub_nes_ppu_read(std::uint32_t);
EMUHUB_EXPORT void emuhub_nes_ppu_write(std::uint32_t,std::uint32_t);
}
