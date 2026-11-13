#include "emuhub_core.h"
#include "gb_machine.h"
#include "nes_machine.h"
#include "snes_apu.h"
#include "snes_header.h"
#include "snes_ppu.h"
#include "snes_system.h"
#include <algorithm>
#include "state_io.h"
#include <array>
#include <vector>

namespace {
constexpr std::uint32_t kAbi = 4;
constexpr unsigned kSampleRate = 48000;
constexpr std::size_t kAudioCapacity = 2048;
enum Console { kNes = 0, kGb = 1, kSnes = 2 };
int console = kNes;
emuhub::NesMachine nes;
emuhub::GbMachine gb;
emuhub::SnesPpu snes_ppu;
emuhub::SnesApu snes_apu;
emuhub::SnesSystem snes(&snes_ppu, &snes_apu);
bool snes_battery = false;
std::array<float, kAudioCapacity> audio{};
std::size_t audio_samples = 0;
std::vector<std::uint8_t> state_buf;
bool rom_loaded = false;
constexpr std::uint32_t kStateMagic = 0x31534845;  // "EHS1"
inline bool is_gb() { return console == kGb; }
inline bool is_snes() { return console == kSnes; }
void clear_audio() { audio_samples = 0; audio.fill(0.0f); }
}

extern "C" {
std::uint32_t emuhub_abi_version() { return kAbi; }
int emuhub_select_console(int c) {
  if (c != kNes && c != kGb && c != kSnes) return -1;
  console = c; clear_audio(); return 0;
}
int emuhub_console() { return console; }
std::uint32_t emuhub_video_width() {
  if (is_snes()) return static_cast<std::uint32_t>(snes_ppu.width());
  return is_gb() ? emuhub::GbMachine::kWidth : emuhub::NesPpu::kWidth;
}
std::uint32_t emuhub_video_height() {
  if (is_snes()) return static_cast<std::uint32_t>(snes_ppu.height());
  return is_gb() ? emuhub::GbMachine::kHeight : emuhub::NesPpu::kHeight;
}
std::uint32_t* emuhub_video_buffer() {
  if (is_snes()) return const_cast<std::uint32_t*>(snes_ppu.frame());
  return is_gb() ? const_cast<std::uint32_t*>(gb.framebuffer().data()) : const_cast<std::uint32_t*>(nes.ppu().framebuffer().data());
}
std::size_t emuhub_video_buffer_size() {
  if (is_snes()) return static_cast<std::size_t>(snes_ppu.width()) * static_cast<std::size_t>(snes_ppu.height());
  return is_gb() ? emuhub::GbMachine::kPixels : emuhub::NesPpu::kPixels;
}
float emuhub_video_aspect() {
  if (is_snes()) return (snes_ppu.setini() & 4) ? 256.0f / 239.0f : 256.0f / 224.0f;
  return is_gb() ? 160.0f / 144.0f : 4.0f / 3.0f;
}
std::uint32_t emuhub_audio_sample_rate() { return kSampleRate; }
std::size_t emuhub_audio_buffer_size() { return audio.size(); }
std::size_t emuhub_audio_buffer_samples() { return audio_samples; }
float* emuhub_audio_buffer() { return audio.data(); }
void emuhub_set_audio_sample_rate(unsigned rate) {
  if (is_snes()) snes_apu.set_sample_rate(rate);
  else if (is_gb()) gb.set_audio_rate(rate); else nes.set_audio_rate(rate);
  audio_samples = 0;
}
void emuhub_set_audio_volume(float volume) {
  if (is_snes()) snes_apu.set_volume(volume);
  else if (is_gb()) gb.set_audio_volume(volume); else nes.set_audio_volume(volume);
}
int emuhub_load_rom(const std::uint8_t* data, std::size_t size) {
  clear_audio();
  if (is_snes()) {
    if (!data) return -1;
    const emuhub::SnesHeader h = emuhub::parse_snes_header(data, size);
    if (!h.ok) return 1;                 // cabeçalho não reconhecido
    if (h.coprocessor) return 2;         // SuperFX, SA-1, DSP-1... só no núcleo JS por enquanto
    const std::size_t skip = h.copier ? 512 : 0;
    const std::size_t sram = h.sram_kb ? std::min<std::size_t>(h.sram_kb, 128) * 1024 : 0;
    snes.load(data + skip, size - skip, h.hirom, sram);
    snes_battery = sram != 0;
    snes_apu.set_sample_rate(kSampleRate);
    return 0;
  }
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
void emuhub_reset() {
  if (is_snes()) snes.reset(); else if (is_gb()) gb.reset(); else nes.reset();
  clear_audio();
}
void emuhub_set_buttons(std::uint16_t mask) {
  if (is_snes()) snes.set_buttons(mask); else if (is_gb()) gb.set_buttons(mask); else nes.set_buttons(mask);
}
int emuhub_run_frame() {
  if (is_snes()) {
    snes.run_frame();
    audio_samples = std::min(snes_apu.buffered(), audio.size());
    if (audio_samples) snes_apu.fill(audio.data(), audio_samples);
    return 0;
  }
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
std::uint8_t* emuhub_sram_data() {
  if (is_snes()) return snes.sram().empty() ? nullptr : snes.sram().data();
  return is_gb() ? gb.sram_data() : nullptr;
}
std::size_t emuhub_sram_size() { return is_snes() ? snes.sram().size() : is_gb() ? gb.sram_size() : 0; }
int emuhub_sram_battery() { return is_snes() ? (snes_battery ? 1 : 0) : (is_gb() && gb.has_battery() ? 1 : 0); }
std::uint8_t emuhub_snes_peek(std::uint32_t a) {
  const auto& w = snes.wram(); const int b = (a >> 16) & 255;
  return b == 0x7E || b == 0x7F ? w[a & 0x1FFFF] : (b < 0x40 && (a & 0xFFFF) < 0x2000 ? w[a & 0x1FFF] : 0);
}

std::size_t emuhub_state_save() {
  state_buf.clear();
  emuhub::StateIO io(&state_buf);
  std::uint32_t magic = kStateMagic; std::int32_t con = console;
  io.v(magic); io.v(con);
  if (is_snes()) snes.state(io); else if (is_gb()) gb.state(io); else nes.state(io);
  return state_buf.size();
}
std::uint8_t* emuhub_state_buffer() { return state_buf.data(); }
std::uint8_t* emuhub_state_alloc(std::size_t n) { state_buf.assign(n, 0); return state_buf.data(); }
/* 0 ok, 1 formato/console errado (estado de outro motor), 2 dados incompatíveis (ROM diferente / truncado) */
int emuhub_state_load(std::size_t n) {
  if (n < 8 || n > state_buf.size()) return 1;
  emuhub::StateIO io(state_buf.data(), n);
  std::uint32_t magic = 0; std::int32_t con = -1;
  io.v(magic); io.v(con);
  if (magic != kStateMagic || con != console) return 1;
  if (is_snes()) snes.state(io); else if (is_gb()) gb.state(io); else nes.state(io);
  return io.ok() ? 0 : 2;
}
}
