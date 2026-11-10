#include "emuhub_core.h"
#include "nes_machine.h"
#include <algorithm>
#include <array>

namespace {
constexpr std::uint32_t kAbi = 2;
constexpr unsigned kSampleRate = 48000;
constexpr std::size_t kAudioCapacity = 2048;
emuhub::NesMachine machine;
std::array<float, kAudioCapacity> audio{};
std::size_t audio_samples = 0;
}

extern "C" {
std::uint32_t emuhub_abi_version() { return kAbi; }
std::uint32_t emuhub_video_width() { return emuhub::NesPpu::kWidth; }
std::uint32_t emuhub_video_height() { return emuhub::NesPpu::kHeight; }
std::uint32_t* emuhub_video_buffer() {
  return const_cast<std::uint32_t*>(machine.ppu().framebuffer().data());
}
std::size_t emuhub_video_buffer_size() { return emuhub::NesPpu::kPixels; }
std::uint32_t emuhub_audio_sample_rate() { return kSampleRate; }
std::size_t emuhub_audio_buffer_size() { return audio.size(); }
std::size_t emuhub_audio_buffer_samples() { return audio_samples; }
float* emuhub_audio_buffer() { return audio.data(); }
void emuhub_set_audio_sample_rate(unsigned rate) {
  machine.set_audio_rate(rate);
  audio_samples = 0;
}
void emuhub_set_audio_volume(float volume) { machine.set_audio_volume(volume); }
int emuhub_load_rom(const std::uint8_t* data, std::size_t size) {
  const auto result = machine.load_rom(data, size);
  audio_samples = 0;
  audio.fill(0.0f);
  if (result == emuhub::CartridgeError::Ok) machine.set_audio_rate(kSampleRate);
  return static_cast<int>(result);
}
void emuhub_reset() {
  machine.reset();
  audio_samples = 0;
  audio.fill(0.0f);
}
void emuhub_set_buttons(std::uint16_t mask) { machine.set_buttons(mask); }
int emuhub_run_frame() {
  if (!machine.run_frame()) return -1;
  audio_samples = std::min(machine.apu().buffered(), audio.size());
  if (audio_samples) machine.fill_audio(audio.data(), audio_samples);
  return 0;
}
void emuhub_destroy() {
  machine.destroy();
  audio_samples = 0;
  audio.fill(0.0f);
}
std::uint32_t emuhub_nes_mapper() { return machine.cartridge().mapper(); }
std::size_t emuhub_nes_prg_size() { return machine.cartridge().prg_size(); }
int emuhub_nes_chr_is_ram() { return machine.cartridge().chr_is_ram() ? 1 : 0; }
std::size_t emuhub_nes_chr_rom_size() { return machine.cartridge().chr_rom_size(); }
std::uint8_t emuhub_nes_cpu_read(std::uint16_t address) { return machine.cpu_read(address); }
}
