#include "emuhub_core.h"
#include "nes_cartridge.h"
#include <array>
#include <cstdlib>
#include <iostream>
#define CHECK(expr) do { if (!(expr)) { std::cerr << "FAIL: " #expr << " at " << __FILE__ << ':' << __LINE__ << '\n'; return 1; } } while (0)
#include <cstdint>
#include <cmath>
#include <vector>
static std::vector<std::uint8_t> rom(std::uint8_t prg,std::uint8_t chr,std::uint8_t mapper,bool trainer=false){
 const std::size_t tr=trainer?512:0;std::vector<std::uint8_t>d(16+tr+std::size_t(prg)*16384+std::size_t(chr)*8192,0);
 d[0]='N';d[1]='E';d[2]='S';d[3]=0x1a;d[4]=prg;d[5]=chr;d[6]=std::uint8_t((mapper&15)<<4)|(trainer?4:0);d[7]=std::uint8_t(mapper&0xf0);
 for(std::size_t i=0;i<std::size_t(prg)*16384;i++)d[16+tr+i]=std::uint8_t(i/16384+0x40);
 for(std::size_t i=0;i<std::size_t(chr)*8192;i++)d[16+tr+std::size_t(prg)*16384+i]=std::uint8_t(i/8192+0x80);
 return d;
}
int main(){
 emuhub::NesCartridge c;
 auto n=rom(2,1,0);CHECK(c.load(n.data(),n.size())==emuhub::CartridgeError::Ok);
 CHECK(c.mapper()==0&&c.prg_size()==32768&&c.cpu_read(0x8000)==0x40&&c.cpu_read(0xc000)==0x41&&c.cpu_read(0xffff)==0x41);
 CHECK(c.ppu_read(0)==0x80&&c.chr_rom_size()==8192&&!c.chr_is_ram());c.ppu_write(0,0x55);CHECK(c.ppu_read(0)==0x80);
 auto n16=rom(1,0,0,true);CHECK(c.load(n16.data(),n16.size())==emuhub::CartridgeError::Ok);CHECK(c.has_trainer()&&c.chr_is_ram()&&c.cpu_read(0x8000)==c.cpu_read(0xc000));
 c.cpu_write(0x6000,0x5a);CHECK(c.cpu_read(0x6000)==0x5a);c.ppu_write(0x1fff,0xa5);CHECK(c.ppu_read(0x1fff)==0xa5);
 auto u=rom(3,0,2);CHECK(c.load(u.data(),u.size())==emuhub::CartridgeError::Ok);CHECK(c.cpu_read(0x8000)==0x40&&c.cpu_read(0xc000)==0x42);c.cpu_write(0x8000,1);CHECK(c.cpu_read(0x8000)==0x41&&c.cpu_read(0xc000)==0x42);
 std::array<std::uint8_t,16> bad{};CHECK(c.load(nullptr,0)==emuhub::CartridgeError::InvalidArgument);CHECK(c.load(bad.data(),bad.size())==emuhub::CartridgeError::InvalidHeader);
 auto trunc=rom(1,1,0);trunc.pop_back();CHECK(c.load(trunc.data(),trunc.size())==emuhub::CartridgeError::TruncatedRom);
 auto unsupported=rom(1,0,5);CHECK(c.load(unsupported.data(),unsupported.size())==emuhub::CartridgeError::UnsupportedMapper);
 auto layout=rom(1,0,2);CHECK(c.load(layout.data(),layout.size())==emuhub::CartridgeError::InvalidMapperLayout);
 auto nes2=rom(1,0,0);nes2[7]|=8;CHECK(c.load(nes2.data(),nes2.size())==emuhub::CartridgeError::UnsupportedFormat);

 // MMC1: serially select PRG bank 2 in 16 KiB mode.
 auto mmc1=rom(4,4,1); CHECK(c.load(mmc1.data(),mmc1.size())==emuhub::CartridgeError::Ok);
 const std::uint8_t bank2bits[]={0,1,0,0,0};
 for(auto bit:bank2bits)c.cpu_write(0xe000,bit);
 CHECK(c.cpu_read(0x8000)==0x42&&c.cpu_read(0xc000)==0x43);
 // Switch MMC1 to 4 KiB CHR banks and select CHR bank 1.
 const std::uint8_t ctrlBits[]={0,0,1,1,1}; for(auto bit:ctrlBits)c.cpu_write(0x8000,bit);
 const std::uint8_t chrBits[]={0,1,0,0,0}; for(auto bit:chrBits)c.cpu_write(0xa000,bit);
 CHECK(c.ppu_read(0x0000)==0x81);
 // CNROM switches CHR banks while keeping NROM PRG mapping.
 auto cnrom=rom(2,4,3); CHECK(c.load(cnrom.data(),cnrom.size())==emuhub::CartridgeError::Ok);
 c.cpu_write(0x8000,2); CHECK(c.ppu_read(0)==0x82);
 // MMC3 PRG bank arrangement and IRQ counter.
 auto mmc3=rom(4,4,4); CHECK(c.load(mmc3.data(),mmc3.size())==emuhub::CartridgeError::Ok);
 CHECK(c.cpu_read(0x8000)==0x40&&c.cpu_read(0xc000)==0x43);
 c.cpu_write(0x8000,0x46); c.cpu_write(0x8001,3);
 CHECK(c.cpu_read(0x8000)==0x43&&c.cpu_read(0xc000)==0x41);
 c.cpu_write(0xc000,2); c.cpu_write(0xc001,0); c.cpu_write(0xe001,0);
 c.scanline(); CHECK(!c.irq_pending()); c.scanline(); CHECK(!c.irq_pending());
 c.scanline(); CHECK(c.irq_pending()); c.cpu_write(0xe000,0); CHECK(!c.irq_pending());
 // AxROM switches 32 KiB PRG banks and single-screen mirroring.
 auto axrom=rom(4,0,7); CHECK(c.load(axrom.data(),axrom.size())==emuhub::CartridgeError::Ok);
 c.cpu_write(0x8000,0x11); CHECK(c.cpu_read(0x8000)==0x42&&c.cpu_read(0xffff)==0x43);
 CHECK(c.mirroring()==3); c.cpu_write(0x8000,0); CHECK(c.mirroring()==2);

 auto abi=rom(2,0,0);
 const std::uint8_t frameLoop[]={0x4c,0x00,0x80};
 for(std::size_t i=0;i<sizeof(frameLoop);++i)abi[16+i]=frameLoop[i];
 abi[16+0x7ffc]=0x00;abi[16+0x7ffd]=0x80;
 CHECK(emuhub_load_rom(abi.data(),abi.size())==0);
 CHECK(emuhub_abi_version()==3);
 CHECK(emuhub_nes_mapper()==0&&emuhub_nes_prg_size()==32768&&emuhub_nes_cpu_read(0x8000)==0x4c);
 emuhub_set_audio_sample_rate(44100);CHECK(emuhub_audio_sample_rate()==44100);
 emuhub_set_audio_sample_rate(48000);CHECK(emuhub_audio_sample_rate()==48000);
 emuhub_set_audio_volume(0.5f);
 CHECK(emuhub_run_frame()==0);
 CHECK(emuhub_video_buffer_size()==256u*240u&&emuhub_video_buffer()[0]!=0);
 for(std::size_t i=0;i<emuhub_audio_buffer_size();++i)CHECK(std::isfinite(emuhub_audio_buffer()[i]));
 emuhub_destroy();
}
