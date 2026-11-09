#include "cpu6502.h"
#include <array>
#include <cstdint>
#include <iostream>
#define CHECK(x) do { if(!(x)){std::cerr<<"FAIL: " #x " line "<<__LINE__<<'\n';return 1;} } while(0)
struct Memory { std::array<std::uint8_t,65536> data{}; };
static std::uint8_t rd(void* p,std::uint16_t a){return static_cast<Memory*>(p)->data[a];}
static void wr(void* p,std::uint16_t a,std::uint8_t v){static_cast<Memory*>(p)->data[a]=v;}
int main(){
 Memory mem; mem.data[0xfffc]=0x00;mem.data[0xfffd]=0x80;
 const std::uint8_t program[]={0xa9,0x2a,0xaa,0xe8,0x8e,0x10,0x00,0xa9,0x01,0x69,0x01,0x85,0x11,0xea};
 for(std::size_t i=0;i<sizeof(program);++i)mem.data[0x8000+i]=program[i];
 emuhub::Cpu6502 cpu({&mem,rd,wr});cpu.reset();
 CHECK(cpu.state().pc==0x8000);
 CHECK(cpu.step()==2&&cpu.state().a==0x2a);
 CHECK(cpu.step()==2&&cpu.state().x==0x2a);
 CHECK(cpu.step()==2&&cpu.state().x==0x2b);
 CHECK(cpu.step()==4&&mem.data[0x10]==0x2b);
 CHECK(cpu.step()==2&&cpu.state().a==1);
 CHECK(cpu.step()==2&&cpu.state().a==2);
 CHECK(cpu.step()==3&&mem.data[0x11]==2);
 const auto before=cpu.state().cycles;cpu.step();CHECK(cpu.state().cycles==before+2);
 // IRQ is deferred while I is set, then vectors correctly after CLI.
 mem.data[0x9000]=0xea;mem.data[0xfffe]=0x00;mem.data[0xffff]=0x90;
 auto s=cpu.state();s.pc=0x800d;s.p=0x24;cpu.set_state(s);cpu.set_irq(true);
 cpu.step();CHECK(cpu.state().pc==0x800e);
 s=cpu.state();s.p=0x20;cpu.set_state(s);cpu.step();CHECK(cpu.state().pc==0x9000);
 return 0;
}
