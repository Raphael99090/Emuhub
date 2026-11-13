#include "nes_ppu.h"
#include <algorithm>
#include <array>

namespace emuhub {
namespace {
constexpr std::array<std::uint32_t,64> make_palette(){
 const std::array<std::uint32_t,64> rgb={
  0x666666,0x002a88,0x1412a7,0x3b00a4,0x5c007e,0x6e0040,0x6c0600,0x561d00,
  0x333500,0x0b4800,0x005200,0x004f08,0x00404d,0x000000,0x000000,0x000000,
  0xadadad,0x155fd9,0x4240ff,0x7527fe,0xa01acc,0xb71e7b,0xb53120,0x994e00,
  0x6b6d00,0x388700,0x0c9300,0x008f32,0x007c8d,0x000000,0x000000,0x000000,
  0xfffeff,0x64b0ff,0x9290ff,0xc676ff,0xf36aff,0xfe6ecc,0xfe8170,0xea9e22,
  0xbcbe00,0x88d800,0x5ce430,0x45e082,0x48cdde,0x4f4f4f,0x000000,0x000000,
  0xfffeff,0xc0dfff,0xd3d2ff,0xe8c8ff,0xfbc2ff,0xfec4ea,0xfeccc5,0xf7d8a5,
  0xe4e594,0xcfef96,0xbdf4ab,0xb3f3cc,0xb5ebf2,0xb8b8b8,0x000000,0x000000};
 std::array<std::uint32_t,64> out{};
 for(std::size_t i=0;i<64;++i){const auto c=rgb[i];out[i]=0xff000000u|((c&0xffu)<<16)|(c&0xff00u)|((c>>16)&0xffu);}
 return out;
}
constexpr auto kPalette=make_palette();
}
NesPpu::NesPpu(NesCartridge& cartridge):cartridge_(cartridge){reset();}
void NesPpu::reset(){
 ctrl_=mask_=status_=oam_addr_=fine_x_=w_=buffer_=open_bus_=0;
 v_=t_=0;dot_=0;scanline_=261;odd_=frame_done_=nmi_pending_=false;hit_dot_=-1;
 vram_.fill(0);palette_.fill(0);oam_.fill(0);bg_.fill(0);sp_.fill(0);sp_behind_.fill(0);sp0_.fill(0);
 frame_.fill(0xff000000u);
}
std::size_t NesPpu::nt_index(std::uint16_t a)const{
 const unsigned table=(a>>10)&3;unsigned n=table;
 switch(cartridge_.mirroring()){
  case 0:n=table>>1;break;
  case 1:n=table&1;break;
  case 2:n=0;break;
  case 3:n=1;break;
  default:break;
 }
 return (std::size_t(n)<<10)|(a&0x03ff);
}
std::uint8_t NesPpu::read_memory(std::uint16_t a)const{
 a&=0x3fff;
 if(a<0x2000)return cartridge_.ppu_read(a);
 if(a<0x3f00)return vram_[nt_index(a)];
 unsigned i=a&0x1f;if((i&0x13)==0x10)i&=0x0f;
 return palette_[i];
}
void NesPpu::write_memory(std::uint16_t a,std::uint8_t v){
 a&=0x3fff;
 if(a<0x2000)cartridge_.ppu_write(a,v);
 else if(a<0x3f00)vram_[nt_index(a)]=v;
 else{unsigned i=a&0x1f;if((i&0x13)==0x10)i&=0x0f;palette_[i]=v&0x3f;}
}
std::uint8_t NesPpu::read_register(std::uint16_t r){
 switch(r&7){
  case 2:{const auto val=std::uint8_t((status_&0xe0)|(open_bus_&0x1f));status_&=std::uint8_t(~0x80);w_=0;open_bus_=val;return val;}
  case 4:{auto v=oam_[oam_addr_];if((oam_addr_&3)==2)v&=0xe3;open_bus_=v;return v;}
  case 7:{
   const auto a=std::uint16_t(v_&0x3fff);std::uint8_t ret;
   if(a>=0x3f00){ret=read_memory(a);buffer_=vram_[nt_index(a)];}
   else{ret=buffer_;buffer_=read_memory(a);}
   v_=std::uint16_t((v_+((ctrl_&4)?32:1))&0x7fff);open_bus_=ret;return ret;
  }
  default:return open_bus_;
 }
}
void NesPpu::write_register(std::uint16_t r,std::uint8_t val){
 open_bus_=val;
 switch(r&7){
  case 0:{const auto old=ctrl_;ctrl_=val;t_=std::uint16_t((t_&~0x0c00)|((val&3)<<10));
   if(!(old&0x80)&&(val&0x80)&&(status_&0x80))nmi_pending_=true;break;}
  case 1:mask_=val;break;
  case 3:oam_addr_=val;break;
  case 4:oam_[oam_addr_++]=val;break;
  case 5:
   if(w_==0){fine_x_=val&7;t_=std::uint16_t((t_&~0x001f)|(val>>3));w_=1;}
   else{t_=std::uint16_t((t_&~0x73e0)|((val&7)<<12)|((val>>3)<<5));w_=0;}break;
  case 6:
   if(w_==0){t_=std::uint16_t((t_&0x00ff)|((val&0x3f)<<8));w_=1;}
   else{t_=std::uint16_t((t_&0xff00)|val);v_=t_;w_=0;}break;
  case 7:write_memory(v_&0x3fff,val);v_=std::uint16_t((v_+((ctrl_&4)?32:1))&0x7fff);break;
 }
}
void NesPpu::dma_write(std::uint8_t value){oam_[oam_addr_++]=value;}
void NesPpu::increment_y(){
 auto v=v_;
 if((v&0x7000)!=0x7000)v=std::uint16_t(v+0x1000);
 else{
  v=std::uint16_t(v&~0x7000);unsigned y=(v&0x03e0)>>5;
  if(y==29){y=0;v^=0x0800;}else if(y==31)y=0;else ++y;
  v=std::uint16_t((v&~0x03e0)|(y<<5));
 }
 v_=v;
}
void NesPpu::copy_x(){v_=std::uint16_t((v_&~0x041f)|(t_&0x041f));}
void NesPpu::copy_y(){v_=std::uint16_t((v_&~0x7be0)|(t_&0x7be0));}
void NesPpu::tick(){
 const unsigned sl=scanline_,d=dot_;const bool rend=(mask_&0x18)!=0;
 if(sl<240){
  if(d==0){hit_dot_=-1;if(rend)render_line(sl);else std::fill(frame_.begin()+sl*256,frame_.begin()+(sl+1)*256,kPalette[palette_[0]&0x3f]);}
  else if(static_cast<int>(d)==hit_dot_){status_|=0x40;hit_dot_=-1;}
  if(rend){if(d==256)increment_y();else if(d==257)copy_x();else if(d==260)cartridge_.scanline();}
 }else if(sl==241){
  if(d==1){status_|=0x80;if(ctrl_&0x80)nmi_pending_=true;frame_done_=true;}
 }else if(sl==261){
  if(d==1)status_&=std::uint8_t(~0xe0);
  if(rend){if(d==257)copy_x();else if(d==260)cartridge_.scanline();else if(d==280)copy_y();else if(d==339&&odd_)dot_=340;}
 }
 if(++dot_>=341){dot_=0;if(++scanline_>=262){scanline_=0;odd_=!odd_;}}
}
void NesPpu::advance(unsigned dots){while(dots--)tick();}
void NesPpu::render_line(unsigned y){
 const auto mask=mask_,ctrl=ctrl_;const bool show_bg=(mask&8)!=0,show_sp=(mask&16)!=0,left_bg=(mask&2)!=0,left_sp=(mask&4)!=0;
 if(show_bg){
  auto v=v_;const unsigned fine_y=(v>>12)&7,pbase=(ctrl&0x10)?0x1000:0,fx=fine_x_;
  for(unsigned tile=0;tile<33;++tile){
   const auto id=vram_[nt_index(std::uint16_t(0x2000|(v&0x0fff)))];
   auto at=vram_[nt_index(std::uint16_t(0x23c0|(v&0x0c00)|((v>>4)&0x38)|((v>>2)&7)))];
   at=std::uint8_t((at>>(((v>>4)&4)|(v&2)))&3);
   const auto addr=std::uint16_t(pbase+id*16+fine_y);
   const auto lo=cartridge_.ppu_read(addr),hi=cartridge_.ppu_read(std::uint16_t(addr+8));
   const int ax=int(tile*8)-int(fx);
   for(unsigned b=0;b<8;++b){const int px=ax+int(b);if(px<0||px>255)continue;
    const unsigned c=((lo>>(7-b))&1)|(((hi>>(7-b))&1)<<1);
    bg_[std::size_t(px)]=c?std::uint8_t((at<<2)|c):0;
   }
   if((v&31)==31)v=std::uint16_t((v&~31)^0x400);else ++v;
  }
  if(!left_bg)for(unsigned i=0;i<8;++i)bg_[i]=0;
 }else bg_.fill(0);
 sp_.fill(0);sp_behind_.fill(0);sp0_.fill(0);
 if(show_sp){
  const unsigned h=(ctrl&0x20)?16:8;unsigned count=0;
  for(unsigned i=0;i<64;++i){
   const unsigned o=i*4;const int row=int(y)-(int(oam_[o])+1);
   if(row<0||row>=int(h))continue;
   if(++count>8){status_|=0x20;if(!no_limit_)break;}
   const auto tile=oam_[o+1],attr=oam_[o+2],sx=oam_[o+3];
   const unsigned r=(attr&0x80)?(h-1-unsigned(row)):unsigned(row);
   unsigned addr;
   if(h==8)addr=((ctrl&8)?0x1000:0)+unsigned(tile)*16+r;
   else addr=((tile&1)?0x1000:0)+(unsigned(tile&0xfe)*16)+((r&8)?16:0)+(r&7);
   const auto lo=cartridge_.ppu_read(std::uint16_t(addr)),hi=cartridge_.ppu_read(std::uint16_t(addr+8));
   const bool flip_h=(attr&0x40)!=0;
   for(unsigned b=0;b<8;++b){
    const unsigned px=unsigned(sx)+b;if(px>255)break;if(px<8&&!left_sp)continue;
    const unsigned bit=flip_h?b:7-b,c=((lo>>bit)&1)|(((hi>>bit)&1)<<1);
    if(!c||sp_[px])continue;
    sp_[px]=std::uint8_t(0x10|((attr&3)<<2)|c);sp_behind_[px]=(attr&0x20)?1:0;if(i==0)sp0_[px]=1;
   }
  }
 }
 const unsigned base=y*256,gray=(mask&1)?0x30:0x3f;int hit=-1;
 for(unsigned x=0;x<256;++x){
  const auto b=bg_[x],s=sp_[x];unsigned idx;
  if(s&&(b==0||!sp_behind_[x]))idx=s;else if(b)idx=b;else idx=0;
  if(hit<0&&x<255&&sp0_[x]&&b&&show_bg&&show_sp)hit=int(x);
  frame_[base+x]=kPalette[palette_[idx]&gray];
 }
 if(hit>=0&&!(status_&0x40))hit_dot_=hit+2;
}

void NesPpu::state(StateIO& s) {
  s.v(vram_); s.v(palette_); s.v(oam_); s.v(bg_); s.v(sp_); s.v(sp_behind_); s.v(sp0_);
  s.v(ctrl_); s.v(mask_); s.v(status_); s.v(oam_addr_); s.v(fine_x_); s.v(w_); s.v(buffer_); s.v(open_bus_);
  s.v(v_); s.v(t_); s.v(dot_); s.v(scanline_); s.v(odd_); s.v(frame_done_); s.v(nmi_pending_); s.v(hit_dot_);
}

} // namespace emuhub
