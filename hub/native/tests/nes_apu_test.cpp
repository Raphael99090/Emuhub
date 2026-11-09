#include "nes_apu.h"
#include <array>
#include <cmath>
#include <cstdint>
#include <iostream>
#define CHECK(x) do{if(!(x)){std::cerr<<"FAIL: " #x " line "<<__LINE__<<'\n';return 1;}}while(0)
int main(){
 emuhub::NesApu apu;apu.set_sample_rate(48000);apu.set_volume(1.0f);
 apu.write(0x4015,1);apu.write(0x4000,0x3f);apu.write(0x4002,0x40);apu.write(0x4003,0x08);
 CHECK((apu.read(0x4015)&1)!=0);
 apu.run(20000);CHECK(apu.buffered()>100);
 std::array<float,256> samples{};apu.fill(samples.data(),samples.size());
 bool nonzero=false;for(float x:samples){CHECK(std::isfinite(x));if(std::fabs(x)>1.0e-7f)nonzero=true;}
 CHECK(nonzero);
 apu.write(0x4017,0x00);apu.run(29829);CHECK(apu.irq_pending());
 CHECK((apu.read(0x4015)&0x40)!=0);CHECK(!apu.irq_pending());
 apu.write(0x4017,0x40);apu.run(30000);CHECK(!apu.irq_pending());
 apu.reset();CHECK(apu.buffered()==0);return 0;
}
