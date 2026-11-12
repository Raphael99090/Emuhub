#include "emuhub_core.h"
#include "gb_machine.h"
#include "nes_machine.h"
#include <algorithm>
#include <array>

namespace {
constexpr std::uint32_t kAbi = 3;
constexpr unsigned kSampleRate = 48000;
constexpr std::size_t kAudioCapacity = 2048;
enum Console { kNes = 0, kGb = 1 };
int console = kNes;
emuhub::NesMachine nes;
emuhub::GbMachine gb;
std::array<float, kAudioCapacity> audio{};
std::size_t audio_samples = 0;
inline bool is_gb() { return console == kGb; }
void clear_audio() { audio_samples = 0; audio.fill(0.0f); }
}

extern "C" {
std::uint32_t emuhub_abi_version() { return kAbi; }
int emuhub_select_console(int c) {
  if (c != kNes && c != kGb) return -1;
  console = c; clear_audio(); return 0;
}
int emuhub_console() { return console; }
std::uint32_t emuhub_video_width() { return is_gb() ? emuhub::GbMachine::kWidth : emuhub::NesPpu::kWidth; }
std::uint32_t emuhub_video_height() { return is_gb() ? emuhub::GbMachine::kHeight : emuhub::NesPpu::kHeight; }
std::uint32_t* emuhub_video_buffer() {
  return is_gb() ? const_cast<std::uint32_t*>(gb.framebuffer().data()) : const_cast<std::uint32_t*>(nes.ppu().framebuffer().data());
}
std::size_t emuhub_video_buffer_size() { return is_gb() ? emuhub::GbMachine::kPixels : emuhub::NesPpu::kPixels; }
std::uint32_t emuhub_audio_sample_rate() { return kSampleRate; }
std::size_t emuhub_audio_buffer_size() { return audio.size(); }
std::size_t emuhub_audio_buffer_samples() { return audio_samples; }
float* emuhub_audio_buffer() { return audio.data(); }
void emuhub_set_audio_sample_rate(unsigned rate) {
  if (is_gb()) gb.set_audio_rate(rate); else nes.set_audio_rate(rate);
  audio_samples = 0;
}
void emuhub_set_audio_volume(float volume) { if (is_gb()) gb.set_audio_volume(volume); else nes.set_audio_volume(volume); }
int emuhub_load_rom(const std::uint8_t* data, std::size_t size) {
  clear_audio();
  if (is_gb()) {
    if (!data) return -1;
    const auto r = gb.load_rom(data, size, false);
    if (r == emuhub::GbError::Ok) gb.set_audio_rate(kSampleRate);
    return static_cast<int>(r);
  }
  const auto result = nes.load_rom(data, size);
  if (result == emuhub::CartridgeError::Ok) nes.set_audio_rate(kSampleRate);
  return static_cast<int>(result);
}
void emuhub_reset() { if (is_gb()) gb.reset(); else nes.reset(); clear_audio(); }
void emuhub_set_buttons(std::uint16_t mask) { if (is_gb()) gb.set_buttons(mask); else nes.set_buttons(mask); }
int emuhub_run_frame() {
  if (is_gb()) {
    if (!gb.run_frame()) return -1;
    audio_samples = std::min(gb.audio_buffered(), audio.size());
    if (audio_samples) gb.fill_audio(audio.data(), audio_samples);
    return 0;
  }
  if (!nes.run_frame()) return -1;
  audio_samples = std::min(nes.apu().buffered(), audio.size());
  if (audio_samples) nes.fill_audio(audio.data(), audio_samples);
  return 0;
}
void emuhub_destroy() { nes.destroy(); clear_audio(); }
std::uint32_t emuhub_nes_mapper() { return nes.cartridge().mapper(); }
std::size_t emuhub_nes_prg_size() { return nes.cartridge().prg_size(); }
int emuhub_nes_chr_is_ram() { return nes.cartridge().chr_is_ram() ? 1 : 0; }
std::size_t emuhub_nes_chr_rom_size() { return nes.cartridge().chr_rom_size(); }
std::uint8_t emuhub_nes_cpu_read(std::uint16_t address) { return nes.cpu_read(address); }
int emuhub_gb_is_cgb() { return gb.cgb() ? 1 : 0; }
std::uint8_t* emuhub_sram_data() { return is_gb() ? gb.sram_data() : nullptr; }
std::size_t emuhub_sram_size() { return is_gb() ? gb.sram_size() : 0; }
int emuhub_sram_battery() { return is_gb() && gb.has_battery() ? 1 : 0; }
}
