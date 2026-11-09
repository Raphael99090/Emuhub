#include "nes_bus.h"

namespace emuhub {
NesBus::NesBus(NesCartridge& cartridge):cartridge_(cartridge){reset();}
void NesBus::reset(){
  ram_.fill(0);ppu_registers_.fill(0);apu_registers_.fill(0);oam_.fill(0);
  buttons_=controller_shift_=strobe_=open_bus_=0;dma_stall_=0;
}
std::uint8_t NesBus::read_callback(void* context,std::uint16_t address){
  return static_cast<NesBus*>(context)->read(address);
}
void NesBus::write_callback(void* context,std::uint16_t address,std::uint8_t value){
  static_cast<NesBus*>(context)->write(address,value);
}
std::uint8_t NesBus::read(std::uint16_t a){
  std::uint8_t value=open_bus_;
  if(a<0x2000)value=ram_[a&0x07ff];
  else if(a<0x4000)value=ppu_registers_[a&7];
  else if(a==0x4015)value=apu_registers_[0x15-0x4000]&0xdf;
  else if(a==0x4016){
    if(strobe_)controller_shift_=buttons_;
    value=static_cast<std::uint8_t>((controller_shift_&1)|0x40);
    controller_shift_=static_cast<std::uint8_t>((controller_shift_>>1)|0x80);
  }else if(a==0x4017)value=0x40;
  else if(a>=0x6000)value=cartridge_.cpu_read(a);
  open_bus_=value;return value;
}
void NesBus::write(std::uint16_t a,std::uint8_t v){
  open_bus_=v;
  if(a<0x2000)ram_[a&0x07ff]=v;
  else if(a<0x4000)ppu_registers_[a&7]=v;
  else if(a==0x4014){
    const std::uint16_t base=std::uint16_t(v)<<8;
    for(unsigned i=0;i<256;++i)oam_[i]=read(static_cast<std::uint16_t>(base+i));
    dma_stall_+=513;
  }else if(a==0x4016){strobe_=v&1;if(strobe_)controller_shift_=buttons_;}
  else if(a>=0x4000&&a<0x4018)apu_registers_[a-0x4000]=v;
  else if(a>=0x4020)cartridge_.cpu_write(a,v);
}
} // namespace emuhub
