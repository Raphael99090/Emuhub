#include "nes_machine.h"
#include <cstdint>
#include <iostream>
#include <vector>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL: " #x " line "<<__LINE__<<'\n';return 1;}}while(0)
static std::vector<std::uint8_t> program_rom(){
 std::vector<std::uint8_t> r(16+32768,0);r[0]='N';r[1]='E';r[2]='S';r[3]=0x1a;r[4]=2;
 const std::uint8_t code[]={0xa9,0x42,0x85,0x02,0xa2,0x08,0x86,0x03,0xea};
 for(unsigned i=0;i<sizeof(code);++i)r[16+i]=code[i];
 r[16+0x7ffc]=0x00;r[16+0x7ffd]=0x80;
 return r;
}
int main(){
 emuhub::NesMachine nes;auto rom=program_rom();
 CHECK(nes.load_rom(rom.data(),rom.size())==emuhub::CartridgeError::Ok);
 CHECK(nes.loaded()&&nes.cpu_state().pc==0x8000);
 CHECK(nes.step_instruction()==2&&nes.cpu_state().a==0x42);
 CHECK(nes.step_instruction()==3&&nes.cpu_read(0x0002)==0x42);
 CHECK(nes.step_instruction()==2&&nes.cpu_state().x==0x08);
 CHECK(nes.step_instruction()==3&&nes.cpu_read(0x0803)==0x08);
 nes.cpu_write(0x4016,1);nes.set_buttons(0x05);nes.cpu_write(0x4016,0);
 CHECK((nes.cpu_read(0x4016)&1)==1);CHECK((nes.cpu_read(0x4016)&1)==0);
 nes.reset();CHECK(nes.loaded()&&nes.cpu_state().pc==0x8000);
 return 0;
}
