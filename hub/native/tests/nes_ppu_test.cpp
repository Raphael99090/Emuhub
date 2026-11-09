#include "nes_ppu.h"
#include <cstdint>
#include <iostream>
#include <vector>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL: " #x " line "<<__LINE__<<'\n';return 1;}}while(0)
static std::vector<std::uint8_t> make_rom(){
 std::vector<std::uint8_t> r(16+32768,0);r[0]='N';r[1]='E';r[2]='S';r[3]=0x1a;r[4]=2;return r;
}
int main(){
 emuhub::NesCartridge c;auto rom=make_rom();CHECK(c.load(rom.data(),rom.size())==emuhub::CartridgeError::Ok);
 emuhub::NesPpu ppu(c);
 ppu.write_memory(0x2000,0x31);CHECK(ppu.read_memory(0x2400)==0x31);
 ppu.write_memory(0x3f10,0x2a);CHECK(ppu.read_memory(0x3f00)==0x2a);
 ppu.write_memory(0x0000,0x80);CHECK(ppu.read_memory(0x0000)==0x80);
 ppu.write_register(0,0x80);
 ppu.advance(242*341+1);
 CHECK(ppu.frame_done());CHECK(ppu.take_nmi());CHECK((ppu.read_register(2)&0x80)!=0);
 CHECK((ppu.read_register(2)&0x80)==0);CHECK(!ppu.take_nmi());
 ppu.begin_frame();CHECK(!ppu.frame_done());
 return 0;
}
