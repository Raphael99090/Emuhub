#include "emuhub_core.h"
#include "gb_machine.h"
#include "gba_machine.h"
#include "neogeo_machine.h"
#include "sms_machine.h"
#include "nes_machine.h"
#include "snes_apu.h"
#include "snes_header.h"
#include "snes_ppu.h"
#include "snes_system.h"
#include <algorithm>
#include "state_io.h"
#include <array>
#include <memory>
#include <string>
#include <vector>

namespace {
constexpr std::uint32_t kAbi = 4;
constexpr unsigned kSampleRate = 48000;
constexpr std::size_t kAudioCapacity = 2048;
enum Console { kNes = 0, kGb = 1, kSnes = 2, kSms = 3, kGg = 4, kGba = 5, kNeo = 6 };
int console = kNes;
emuhub::NesMachine nes;
emuhub::GbMachine gb;
emuhub::SnesPpu snes_ppu;
emuhub::SnesApu snes_apu;
emuhub::SnesSystem snes(&snes_ppu, &snes_apu);
bool snes_battery = false;
std::unique_ptr<emuhub::SmsMachine> sms(new emuhub::SmsMachine(false));
emuhub::GbaMachine gba;
emuhub::NeoGeoMachine neo;
std::vector<emuhub::NeoGeoMachine::File> neo_files;   // arquivos acumulados (BIOS ou jogo em conjunto MAME)
std::string neo_err;
std::array<float, kAudioCapacity> audio{};
std::size_t audio_samples = 0;
std::vector<std::uint8_t> state_buf;
struct RamCheat { std::uint32_t addr; std::uint8_t val; };
std::vector<RamCheat> ram_cheats;
std::vector<std::pair<std::size_t, std::uint8_t>> snes_patched;  // desfaz o Game Genie do SNES
std::vector<emuhub::NesCartridge::Gg> nes_gg;
std::vector<emuhub::GbMachine::Gg> gb_gg;
constexpr std::uint32_t kStateMagic = 0x31534845;  // "EHS1"
inline bool is_gb() { return console == kGb; }
inline bool is_snes() { return console == kSnes; }
inline bool is_sms() { return console == kSms || console == kGg; }
inline bool is_gba() { return console == kGba; }
inline bool is_neo() { return console == kNeo; }
void sync_ext_cheats() {
  std::vector<emuhub::SmsMachine::RamCheat> sc; std::vector<emuhub::GbaMachine::Cheat> gc; std::vector<emuhub::NeoGeoMachine::Cheat> nc;
  for (const auto& c : ram_cheats) {
    sc.push_back({static_cast<std::uint16_t>(c.addr), c.val});
    gc.push_back({c.addr, c.val, 1});
    nc.push_back({c.addr, c.val, 1});
  }
  sms->set_ram_cheats(sc); gba.set_cheats(gc); neo.set_cheats(nc);
}
void apply_ram_cheats() {
  if (is_sms() || is_gba() || is_neo()) return;
  for (const auto& c : ram_cheats) {
    if (is_snes()) { const unsigned bank = c.addr >> 16; snes.wram()[(bank == 0x7E || bank == 0x7F) ? (c.addr & 0x1FFFF) : (c.addr & 0x1FFF)] = c.val; }
    else if (is_gb()) gb.write(static_cast<std::uint16_t>(c.addr), c.val);
    else nes.cpu_write(static_cast<std::uint16_t>(c.addr), c.val);
  }
}
void clear_audio() { audio_samples = 0; audio.fill(0.0f); }
}

extern "C" {
std::uint32_t emuhub_abi_version() { return kAbi; }
int emuhub_select_console(int c) {
  if (c < kNes || c > kNeo) return -1;
  if (c == kSms || c == kGg) sms.reset(new emuhub::SmsMachine(c == kGg));
  console = c; clear_audio(); return 0;
}
int emuhub_console() { return console; }
std::uint32_t emuhub_video_width() {
  if (is_sms()) return sms->width();
  if (is_gba()) return 240;
  if (is_neo()) return emuhub::NeoGeoMachine::kWidth;
  if (is_snes()) return static_cast<std::uint32_t>(snes_ppu.width());
  return is_gb() ? emuhub::GbMachine::kWidth : emuhub::NesPpu::kWidth;
}
std::uint32_t emuhub_video_height() {
  if (is_sms()) return sms->height();
  if (is_gba()) return 160;
  if (is_neo()) return emuhub::NeoGeoMachine::kHeight;
  if (is_snes()) return static_cast<std::uint32_t>(snes_ppu.height());
  return is_gb() ? emuhub::GbMachine::kHeight : emuhub::NesPpu::kHeight;
}
std::uint32_t* emuhub_video_buffer() {
  if (is_sms()) return const_cast<std::uint32_t*>(sms->framebuffer().data());
  if (is_gba()) return const_cast<std::uint32_t*>(gba.framebuffer().data());
  if (is_neo()) return const_cast<std::uint32_t*>(neo.framebuffer().data());
  if (is_snes()) return const_cast<std::uint32_t*>(snes_ppu.frame());
  return is_gb() ? const_cast<std::uint32_t*>(gb.framebuffer().data()) : const_cast<std::uint32_t*>(nes.ppu().framebuffer().data());
}
std::size_t emuhub_video_buffer_size() {
  if (is_sms()) return static_cast<std::size_t>(sms->width()) * sms->height();
  if (is_gba()) return 240u * 160u;
  if (is_neo()) return 320u * 224u;
  if (is_snes()) return static_cast<std::size_t>(snes_ppu.width()) * static_cast<std::size_t>(snes_ppu.height());
  return is_gb() ? emuhub::GbMachine::kPixels : emuhub::NesPpu::kPixels;
}
float emuhub_video_aspect() {
  if (is_sms()) return static_cast<float>(sms->width()) / static_cast<float>(sms->height());
  if (is_gba()) return 240.0f / 160.0f;
  if (is_neo()) return 4.0f / 3.0f;
  if (is_snes()) return (snes_ppu.setini() & 4) ? 256.0f / 239.0f : 256.0f / 224.0f;
  return is_gb() ? 160.0f / 144.0f : 4.0f / 3.0f;
}
std::uint32_t emuhub_audio_sample_rate() { return kSampleRate; }
std::size_t emuhub_audio_buffer_size() { return audio.size(); }
std::size_t emuhub_audio_buffer_samples() { return audio_samples; }
float* emuhub_audio_buffer() { return audio.data(); }
void emuhub_set_audio_sample_rate(unsigned rate) {
  if (is_sms()) sms->set_audio_rate(rate); else if (is_gba()) gba.set_audio_rate(rate); else if (is_neo()) neo.set_audio_rate(rate); else
  if (is_snes()) snes_apu.set_sample_rate(rate);
  else if (is_gb()) gb.set_audio_rate(rate); else nes.set_audio_rate(rate);
  audio_samples = 0;
}
void emuhub_set_audio_volume(float volume) {
  if (is_sms()) sms->set_audio_volume(volume); else if (is_gba()) gba.set_audio_volume(volume); else if (is_neo()) neo.set_audio_volume(volume); else
  if (is_snes()) snes_apu.set_volume(volume);
  else if (is_gb()) gb.set_audio_volume(volume); else nes.set_audio_volume(volume);
}
int emuhub_load_rom(const std::uint8_t* data, std::size_t size) {
  clear_audio();
  if (is_sms()) {
    if (!data) return -1;
    const auto r = sms->load_rom(data, size);
    if (r == emuhub::SmsError::Ok) sms->set_audio_rate(kSampleRate);
    return static_cast<int>(r);
  }
  if (is_gba()) {
    if (!data) return -1;
    const auto r = gba.load_rom(data, size);
    if (r == emuhub::GbaError::Ok) gba.set_audio_rate(kSampleRate);
    return static_cast<int>(r);
  }
  if (is_neo()) {      // arquivo .neo único; conjuntos MAME (zip) entram por emuhub_neo_add_file + emuhub_neo_load_set
    if (!data) return -1;
    emuhub::NeoGeoMachine::Set set;
    if (!emuhub::NeoGeoMachine::is_neo(data, size)) { neo_err = "arquivo nao e .neo"; return 3; }
    if (!emuhub::NeoGeoMachine::parse_neo(data, size, set, &neo_err)) return 3;
    if (!neo.load_set(std::move(set), &neo_err)) return neo.has_bios() ? 3 : 2;
    neo.set_audio_rate(kSampleRate); return 0;
  }
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
  if (is_sms()) sms->reset(); else if (is_gba()) gba.reset(); else if (is_neo()) neo.reset(); else
  if (is_snes()) snes.reset(); else if (is_gb()) gb.reset(); else nes.reset();
  clear_audio();
}
void emuhub_set_buttons(std::uint16_t mask) {
  if (is_sms()) sms->set_buttons(mask); else if (is_gba()) gba.set_buttons(mask); else if (is_neo()) neo.set_buttons(mask); else
  if (is_snes()) snes.set_buttons(mask); else if (is_gb()) gb.set_buttons(mask); else nes.set_buttons(mask);
}
int emuhub_run_frame() {
  if (is_sms()) {
    if (!sms->run_frame()) return -1;
    audio_samples = std::min(sms->audio_buffered(), audio.size());
    if (audio_samples) sms->fill_audio(audio.data(), audio_samples);
    return 0;
  }
  if (is_gba()) {
    if (!gba.run_frame()) return -1;
    audio_samples = std::min(gba.audio_buffered(), audio.size());
    if (audio_samples) gba.fill_audio(audio.data(), audio_samples);
    return 0;
  }
  if (is_neo()) {
    if (!neo.run_frame()) return -1;
    audio_samples = std::min(neo.audio_buffered(), audio.size());
    if (audio_samples) neo.fill_audio(audio.data(), audio_samples);
    return 0;
  }
  if (is_snes()) {
    snes.run_frame(); apply_ram_cheats();
    audio_samples = std::min(snes_apu.buffered(), audio.size());
    if (audio_samples) snes_apu.fill(audio.data(), audio_samples);
    return 0;
  }
  if (is_gb()) {
    if (!gb.run_frame()) return -1;
    apply_ram_cheats();
    audio_samples = std::min(gb.audio_buffered(), audio.size());
    if (audio_samples) gb.fill_audio(audio.data(), audio_samples);
    return 0;
  }
  if (!nes.run_frame()) return -1;
  apply_ram_cheats();
  audio_samples = std::min(nes.apu().buffered(), audio.size());
  if (audio_samples) nes.fill_audio(audio.data(), audio_samples);
  return 0;
}
/* Neo Geo: arquivos de um zip (BIOS ou conjunto do jogo) chegam um a um; depois emuhub_neo_set_bios ou emuhub_neo_load_set. */
void emuhub_neo_clear_files() { neo_files.clear(); neo_err.clear(); }
void emuhub_neo_add_file(const char* name, const std::uint8_t* data, std::size_t size) {
  neo_files.push_back({name ? name : "", std::vector<std::uint8_t>(data, data + size)});
}
int emuhub_neo_set_bios() {
  emuhub::NeoGeoMachine::Bios b;
  if (!emuhub::NeoGeoMachine::parse_bios(neo_files, b, &neo_err)) return 1;
  neo.set_bios(b); neo_files.clear(); return 0;
}
int emuhub_neo_has_bios() { return neo.has_bios() ? 1 : 0; }
/* 0 ok, 2 sem BIOS, 3 conjunto invalido/criptografado (veja emuhub_neo_error) */
int emuhub_neo_load_set() {
  clear_audio();
  emuhub::NeoGeoMachine::Set set;
  if (!emuhub::NeoGeoMachine::parse_mame(neo_files, set, &neo_err)) { neo_files.clear(); return 3; }
  neo_files.clear();
  if (!neo.load_set(std::move(set), &neo_err)) return neo.has_bios() ? 3 : 2;
  neo.set_audio_rate(kSampleRate); return 0;
}
const char* emuhub_neo_error() { return neo_err.c_str(); }
void emuhub_destroy() { nes.destroy(); clear_audio(); }
std::uint32_t emuhub_nes_mapper() { return nes.cartridge().mapper(); }
std::size_t emuhub_nes_prg_size() { return nes.cartridge().prg_size(); }
int emuhub_nes_chr_is_ram() { return nes.cartridge().chr_is_ram() ? 1 : 0; }
std::size_t emuhub_nes_chr_rom_size() { return nes.cartridge().chr_rom_size(); }
std::uint8_t emuhub_nes_cpu_read(std::uint16_t address) { return nes.cpu_read(address); }
int emuhub_gb_is_cgb() { return gb.cgb() ? 1 : 0; }
std::uint8_t* emuhub_sram_data() {
  if (is_sms()) return sms->sram_data();
  if (is_gba()) return gba.sram_data();
  if (is_neo()) return neo.sram_data();
  if (is_snes()) return snes.sram().empty() ? nullptr : snes.sram().data();
  if (!is_gb()) return nes.cartridge().prg_ram_data();
  return is_gb() ? gb.sram_data() : nullptr;
}
std::size_t emuhub_sram_size() {
  if (is_sms()) return sms->sram_size();
  if (is_gba()) return gba.sram_size();
  if (is_neo()) return neo.sram_size();
  return is_snes() ? snes.sram().size() : is_gb() ? gb.sram_size() : nes.cartridge().prg_ram_size();
}
int emuhub_sram_battery() {
  if (is_sms()) return sms->has_battery() ? 1 : 0;
  if (is_gba()) return gba.has_battery() ? 1 : 0;
  if (is_neo()) return neo.has_battery() ? 1 : 0;
  return is_snes() ? (snes_battery ? 1 : 0) : is_gb() ? (gb.has_battery() ? 1 : 0) : (nes.cartridge().has_battery() ? 1 : 0);
}
std::uint32_t emuhub_nes_prg_hash() { return nes.cartridge().prg_hash(); }
int emuhub_gb_has_rtc() { return gb.has_rtc() ? 1 : 0; }
static std::uint8_t rtc_buf[13];
std::uint8_t* emuhub_gb_rtc_buffer() { return rtc_buf; }
void emuhub_gb_rtc_export() { gb.rtc_export(rtc_buf); }
void emuhub_gb_rtc_import() { gb.rtc_import(rtc_buf); }
std::uint8_t emuhub_snes_peek(std::uint32_t a) {
  const auto& w = snes.wram(); const int b = (a >> 16) & 255;
  return b == 0x7E || b == 0x7F ? w[a & 0x1FFFF] : (b < 0x40 && (a & 0xFFFF) < 0x2000 ? w[a & 0x1FFF] : 0);
}

std::size_t emuhub_state_save() {
  state_buf.clear();
  emuhub::StateIO io(&state_buf);
  std::uint32_t magic = kStateMagic; std::int32_t con = console;
  io.v(magic); io.v(con);
  if (is_sms()) sms->state(io); else if (is_gba()) gba.state(io); else if (is_neo()) neo.state(io); else if (is_snes()) snes.state(io); else if (is_gb()) gb.state(io); else nes.state(io);
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
  if (is_sms()) sms->state(io); else if (is_gba()) gba.state(io); else if (is_neo()) neo.state(io); else if (is_snes()) snes.state(io); else if (is_gb()) gb.state(io); else nes.state(io);
  return io.ok() ? 0 : 2;
}

/* Melhorias por jogo. key: 0 sem limite de sprites, 1 overclock NES (linhas), 2 V-Blank estendido NES (linhas),
 * 3 paleta do GB, 4 relógio do SNES (milésimos: 1000 = normal, 500 = CPU 2x mais rápida). */
void emuhub_set_option(int key, int val) {
  if (is_sms() || is_gba() || is_neo()) { if (is_gba() && key == 0) gba.set_turbo(val != 0); return; }
  if (key == 0) { if (is_snes()) snes_ppu.set_no_limit(val != 0); else if (is_gb()) gb.set_no_limit(val != 0); else nes.ppu().set_no_limit(val != 0); }
  else if (key == 1 || key == 2) { static unsigned pre = 0, post = 0; (key == 1 ? pre : post) = static_cast<unsigned>(val < 0 ? 0 : val); nes.ppu().set_extra_lines(pre, post); }
  else if (key == 3) gb.set_dmg_palette(val);
  else if (key == 4) snes.set_clock(val > 0 ? val / 1000.0 : 1.0);
}

/* Cheats: o hub interpreta o código (mesmo parser do núcleo JS) e manda as operações já decodificadas. */
void emuhub_cheats_clear() {
  ram_cheats.clear(); nes_gg.clear(); gb_gg.clear(); sync_ext_cheats();
  auto& rom = snes.rom();
  for (auto it = snes_patched.rbegin(); it != snes_patched.rend(); ++it) rom[it->first] = it->second;
  snes_patched.clear();
  nes.set_gg(nes_gg); gb.set_gg(gb_gg);
}
void emuhub_cheat_ram(std::uint32_t addr, int val) { ram_cheats.push_back({addr, static_cast<std::uint8_t>(val)}); sync_ext_cheats(); }
void emuhub_cheat_gg(std::uint32_t addr, int val, int cmp) {
  if (is_sms() || is_gba() || is_neo()) return;
  if (is_snes()) {
    const std::uint32_t bank = addr >> 16, off = addr & 0xFFFF; const bool hi = snes.hirom();
    if ((off < 0x8000 && !hi) || bank == 0x7E || bank == 0x7F || (hi && (bank & 0x7F) < 0x40 && off < 0x8000)) return;
    const std::size_t i = (hi ? (((bank & 0x3F) << 16) | off) : (((bank & 0x7F) << 15) | (off & 0x7FFF))) & snes.rom_mask();
    snes_patched.push_back({i, snes.rom()[i]}); snes.rom()[i] = static_cast<std::uint8_t>(val);
  } else if (is_gb()) { gb_gg.push_back({static_cast<std::uint16_t>(addr), static_cast<std::uint8_t>(val), cmp}); gb.set_gg(gb_gg); }
  else { nes_gg.push_back({static_cast<std::uint16_t>(addr), static_cast<std::uint8_t>(val), cmp}); nes.set_gg(nes_gg); }
}
}
