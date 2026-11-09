#include "nes_bus.h"
#include <array>
#include <cstdint>
#include <iostream>
#include <vector>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL: " #x " line "<<__LINE__<<'\n';return 1;}}while(0)
static std::vector<std::uint8_t> make_rom(){
 std::vector<std::uint8_t> r(16+32768,0);r[0]='N';r[1]='E';r[2]='S';r[3]=0x1a;r[4]=2;
 r[16+0x0000]=0x11;r[16+0x0001]=0x22;return r;
}
int main(){
 emuhub::NesCartridge cart;auto rom=make_rom();CHECK(cart.load(rom.data(),rom.size())==emuhub::CartridgeError::Ok);
 emuhub::NesBus bus(cart);
 bus.write(0x0002,0x5a);CHECK(bus.read(0x0802)==0x5a);CHECK(bus.read(0x1002)==0x5a);CHECK(bus.read(0x1802)==0x5a);
 CHECK(bus.read(0x8000)==0x11);bus.write(0x6000,0xa5);CHECK(bus.read(0x6000)==0xa5);
 bus.set_buttons(0x05);bus.write(0x4016,1);CHECK((bus.read(0x4016)&1)==1);CHECK((bus.read(0x4016)&1)==1);
 bus.write(0x4016,0);CHECK((bus.read(0x4016)&1)==1);CHECK((bus.read(0x4016)&1)==0);CHECK((bus.read(0x4016)&1)==1);
 for(unsigned i=0;i<256;++i)bus.write(static_cast<std::uint16_t>(0x0200+i),static_cast<std::uint8_t>(i));
 bus.write(0x4014,0x02);CHECK(bus.oam()[0]==0&&bus.oam()[1]==1&&bus.oam()[255]==255);CHECK(bus.take_dma_stall()==513);
 auto cb=bus.cpu_bus();std::array<std::uint8_t,65536> mem{};(void)mem;
 CHECK(cb.read&&cb.write);return 0;
}
