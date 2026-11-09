#include "emuhub_core.h"
#include "nes_cartridge.h"
#include <array>
namespace {
constexpr std::uint32_t kAbi=1,kWidth=256,kHeight=240,kSampleRate=48000;
std::array<std::uint32_t,kWidth*kHeight> video{};
std::array<float,2048> audio{};
emuhub::NesCartridge cartridge;
std::uint16_t buttons=0;
}
extern "C" {
std::uint32_t emuhub_abi_version(){return kAbi;}
std::uint32_t emuhub_video_width(){return kWidth;}
std::uint32_t emuhub_video_height(){return kHeight;}
std::uint32_t* emuhub_video_buffer(){return video.data();}
std::size_t emuhub_video_buffer_size(){return video.size();}
std::uint32_t emuhub_audio_sample_rate(){return kSampleRate;}
std::size_t emuhub_audio_buffer_size(){return audio.size();}
float* emuhub_audio_buffer(){return audio.data();}
int emuhub_load_rom(const std::uint8_t* data,std::size_t size){return static_cast<int>(cartridge.load(data,size));}
void emuhub_reset(){buttons=0;video.fill(0xff100d18u);audio.fill(0.0f);}
void emuhub_set_buttons(std::uint16_t mask){buttons=mask;}
int emuhub_run_frame(){return cartridge.loaded()?-3:-1;}
void emuhub_destroy(){cartridge.reset();buttons=0;}
std::uint32_t emuhub_nes_mapper(){return cartridge.mapper();}
std::size_t emuhub_nes_prg_size(){return cartridge.prg_size();}
std::size_t emuhub_nes_chr_rom_size(){return cartridge.chr_rom_size();}
int emuhub_nes_chr_is_ram(){return cartridge.chr_is_ram()?1:0;}
std::uint32_t emuhub_nes_flags(){return (cartridge.has_battery()?1u:0u)|(cartridge.has_trainer()?2u:0u)|(static_cast<std::uint32_t>(cartridge.mirroring())<<2);}
std::uint32_t emuhub_nes_cpu_read(std::uint32_t a){return a<=0xffffu?cartridge.cpu_read(static_cast<std::uint16_t>(a)):0;}
void emuhub_nes_cpu_write(std::uint32_t a,std::uint32_t v){if(a<=0xffffu&&v<=0xffu)cartridge.cpu_write(static_cast<std::uint16_t>(a),static_cast<std::uint8_t>(v));}
std::uint32_t emuhub_nes_ppu_read(std::uint32_t a){return a<=0xffffu?cartridge.ppu_read(static_cast<std::uint16_t>(a)):0;}
void emuhub_nes_ppu_write(std::uint32_t a,std::uint32_t v){if(a<=0xffffu&&v<=0xffu)cartridge.ppu_write(static_cast<std::uint16_t>(a),static_cast<std::uint8_t>(v));}
}
