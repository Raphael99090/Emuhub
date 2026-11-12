#include "gb_machine.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace emuhub;
int main(int, char** v){
  std::vector<std::uint8_t> r(0x8000,0); std::uint32_t s=std::atoi(v[1]);
  for(int i=0x150;i<0x8000;i++){s=s*1664525u+1013904223u;r[i]=s>>24;}
  r[0x100]=0xC3;r[0x101]=0x50;r[0x102]=0x01;
  GbMachine m; m.load_rom(r.data(),r.size(),false);
  std::uint32_t h=0x811c9dc5u; int fr=std::atoi(v[2]);
  for(int f=0;f<fr;f++){m.run_frame();for(auto p:m.framebuffer())h=(h^p)*16777619u;}
  auto g=m.regs(); std::printf("%u %d %d %d %d %d %d %d %d %d\n",h,g.pc,g.sp,g.a,g.b,g.c,g.d,g.e,g.h,g.l);
}
