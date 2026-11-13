#pragma once
#include <cstddef>
#include <cstdint>
#if defined(__EMSCRIPTEN__)
#  include <emscripten/emscripten.h>
#endif

#if defined(__EMSCRIPTEN__)
#  define EMUHUB_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#  define EMUHUB_EXPORT
#endif

extern "C" {
EMUHUB_EXPORT std::uint32_t emuhub_abi_version();
// Escolhe o console antes de carregar a ROM: 0 = NES (padrão), 1 = Game Boy/GBC, 2 = SNES (sem coprocessadores)
EMUHUB_EXPORT int emuhub_select_console(int console);
EMUHUB_EXPORT int emuhub_console();
// Game Boy
EMUHUB_EXPORT int emuhub_gb_is_cgb();
EMUHUB_EXPORT std::uint8_t* emuhub_sram_data();
EMUHUB_EXPORT std::size_t emuhub_sram_size();
EMUHUB_EXPORT std::size_t emuhub_state_save();
EMUHUB_EXPORT std::uint8_t* emuhub_state_buffer();
EMUHUB_EXPORT std::uint8_t* emuhub_state_alloc(std::size_t n);
EMUHUB_EXPORT int emuhub_state_load(std::size_t n);
EMUHUB_EXPORT void emuhub_cheats_clear();
EMUHUB_EXPORT void emuhub_cheat_ram(std::uint32_t addr, int val);
EMUHUB_EXPORT void emuhub_cheat_gg(std::uint32_t addr, int val, int cmp);
EMUHUB_EXPORT int emuhub_sram_battery();
// SNES
EMUHUB_EXPORT float emuhub_video_aspect();
EMUHUB_EXPORT std::uint8_t emuhub_snes_peek(std::uint32_t address);
EMUHUB_EXPORT std::uint32_t emuhub_video_width();
EMUHUB_EXPORT std::uint32_t emuhub_video_height();
EMUHUB_EXPORT std::uint32_t* emuhub_video_buffer();
EMUHUB_EXPORT std::size_t emuhub_video_buffer_size();
EMUHUB_EXPORT std::uint32_t emuhub_audio_sample_rate();
EMUHUB_EXPORT std::size_t emuhub_audio_buffer_size();
EMUHUB_EXPORT std::size_t emuhub_audio_buffer_samples();
EMUHUB_EXPORT float* emuhub_audio_buffer();
EMUHUB_EXPORT void emuhub_set_audio_sample_rate(unsigned rate);
EMUHUB_EXPORT void emuhub_set_audio_volume(float volume);
EMUHUB_EXPORT int emuhub_load_rom(const std::uint8_t* data, std::size_t size);
EMUHUB_EXPORT void emuhub_reset();
EMUHUB_EXPORT void emuhub_set_buttons(std::uint16_t mask);
EMUHUB_EXPORT int emuhub_run_frame();
EMUHUB_EXPORT void emuhub_destroy();
EMUHUB_EXPORT std::uint32_t emuhub_nes_mapper();
EMUHUB_EXPORT std::size_t emuhub_nes_prg_size();
EMUHUB_EXPORT int emuhub_nes_chr_is_ram();
EMUHUB_EXPORT std::size_t emuhub_nes_chr_rom_size();
EMUHUB_EXPORT std::uint8_t emuhub_nes_cpu_read(std::uint16_t address);
}
