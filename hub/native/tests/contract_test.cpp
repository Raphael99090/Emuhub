#include "emuhub_core.h"
#include "nes_cartridge.h"
#include <array>
#include <cassert>
#include <cstdint>
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
 auto n=rom(2,1,0);assert(c.load(n.data(),n.size())==emuhub::CartridgeError::Ok);
 assert(c.mapper()==0&&c.prg_size()==32768&&c.cpu_read(0x8000)==0x40&&c.cpu_read(0xc000)==0x41&&c.cpu_read(0xffff)==0x41);
 assert(c.ppu_read(0)==0x80&&c.chr_rom_size()==8192&&!c.chr_is_ram());c.ppu_write(0,0x55);assert(c.ppu_read(0)==0x80);
 auto n16=rom(1,0,0,true);assert(c.load(n16.data(),n16.size())==emuhub::CartridgeError::Ok);assert(c.has_trainer()&&c.chr_is_ram()&&c.cpu_read(0x8000)==c.cpu_read(0xc000));
 c.cpu_write(0x6000,0x5a);assert(c.cpu_read(0x6000)==0x5a);c.ppu_write(0x1fff,0xa5);assert(c.ppu_read(0x1fff)==0xa5);
 auto u=rom(3,0,2);assert(c.load(u.data(),u.size())==emuhub::CartridgeError::Ok);assert(c.cpu_read(0x8000)==0x40&&c.cpu_read(0xc000)==0x42);c.cpu_write(0x8000,1);assert(c.cpu_read(0x8000)==0x41&&c.cpu_read(0xc000)==0x42);
 std::array<std::uint8_t,16> bad{};assert(c.load(nullptr,0)==emuhub::CartridgeError::InvalidArgument);assert(c.load(bad.data(),bad.size())==emuhub::CartridgeError::InvalidHeader);
 auto trunc=rom(1,1,0);trunc.pop_back();assert(c.load(trunc.data(),trunc.size())==emuhub::CartridgeError::TruncatedRom);
 auto unsupported=rom(1,0,1);assert(c.load(unsupported.data(),unsupported.size())==emuhub::CartridgeError::UnsupportedMapper);
 auto layout=rom(1,0,2);assert(c.load(layout.data(),layout.size())==emuhub::CartridgeError::InvalidMapperLayout);
 auto nes2=rom(1,0,0);nes2[7]|=8;assert(c.load(nes2.data(),nes2.size())==emuhub::CartridgeError::UnsupportedFormat);
 auto abi=rom(2,0,0);assert(emuhub_load_rom(abi.data(),abi.size())==0);assert(emuhub_nes_mapper()==0&&emuhub_nes_prg_size()==32768&&emuhub_nes_cpu_read(0x8000)==0x40);emuhub_destroy();
}
