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
 s=cpu.state();s.p=0x20;cpu.set_state(s);cpu.step();CHECK(cpu.state().pc==0x9000);cpu.set_irq(false);
 // ORA (indirect),Y must dereference the zero-page pointer, not read an immediate byte.
 mem.data[0x8020]=0x11;mem.data[0x8021]=0x40;mem.data[0x0040]=0x00;mem.data[0x0041]=0x90;mem.data[0x9001]=0x80;
 s=cpu.state();s.pc=0x8020;s.a=0x01;s.y=1;s.p=0x20;cpu.set_state(s);
 CHECK(cpu.step()==5&&cpu.state().a==0x81&&(cpu.state().p&0x80));
 // ORA immediate and zero-page forms.
 mem.data[0x8022]=0x09;mem.data[0x8023]=0x04; s=cpu.state();s.pc=0x8022;s.a=0x01;cpu.set_state(s);
 CHECK(cpu.step()==2&&cpu.state().a==0x05);
 mem.data[0x8024]=0x05;mem.data[0x8025]=0x30;mem.data[0x30]=0x10;s=cpu.state();s.pc=0x8024;s.a=0x01;cpu.set_state(s);
 CHECK(cpu.step()==3&&cpu.state().a==0x11);

 // Match the unofficial LAX/SAX instructions supported by the JavaScript core.
 mem.data[0x8026]=0xa7;mem.data[0x8027]=0x31;mem.data[0x31]=0x80;
 s=cpu.state();s.pc=0x8026;s.p=0x20;cpu.set_state(s);
 CHECK(cpu.step()==3&&cpu.state().a==0x80&&cpu.state().x==0x80&&(cpu.state().p&0x80));
 mem.data[0x8028]=0x87;mem.data[0x8029]=0x32;
 s=cpu.state();s.pc=0x8028;cpu.set_state(s);
 CHECK(cpu.step()==3&&mem.data[0x32]==0x80);
 // Absolute-X undocumented NOP consumes operands and charges page-cross timing.
 mem.data[0x802a]=0x1c;mem.data[0x802b]=0xff;mem.data[0x802c]=0x20;
 s=cpu.state();s.pc=0x802a;s.x=1;cpu.set_state(s);
 CHECK(cpu.step()==5&&cpu.state().pc==0x802d);

 return 0;
}
