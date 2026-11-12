#include "snes_cpu.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
using namespace emuhub;
struct B : SnesBus { std::vector<std::uint8_t> m; long cyc=0;
  std::uint8_t read(std::uint32_t a) override{cyc+=6;return m[a&0xFFFFF];}
  void write(std::uint32_t a,std::uint8_t v) override{cyc+=6;m[a&0xFFFFF]=v;}
  void idle(int n) override{cyc+=6*n;} };
int main(int,char**v){
  B b; b.m.resize(1<<20); std::uint32_t s=std::atoi(v[1]); int steps=std::atoi(v[2]);
  for(auto& x:b.m){s=s*1664525u+1013904223u;x=s>>24;if(x==0xDB)x=0xEA;}
  Snes65816 c(&b); c.reset(); int n=0;
  for(;n<steps;n++){ if(n%37==36)b.nmi_pending=true; b.irq_line=(n%91)>60; c.step(); if(c.bad_opcode>=0)break; }
  std::uint32_t h=0x811c9dc5u; for(auto x:b.m)h=(h^x)*16777619u;
  std::printf("%d %d %ld %u %d %d %d %d %d %d %d %d %d %d %d %d\n",n,c.bad_opcode,b.cyc,h,c.a,c.x,c.y,c.s,c.d,c.db,c.pb,c.pc,c.p,c.e,c.wai?1:0,c.stp?1:0);
}
