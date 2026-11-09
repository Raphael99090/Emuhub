#include "cpu6502.h"
#include <utility>

namespace emuhub {
namespace {
constexpr std::uint8_t C=1,Z=2,I=4,D=8,B=16,U=32,V=64,N=128;
enum class Mode { Imm,Zp,ZpX,ZpY,Abs,AbsX,AbsY,IndX,IndY,Rel };
}
Cpu6502::Cpu6502(Bus bus):bus_(bus) {}
std::uint8_t Cpu6502::read(std::uint16_t a) const { return bus_.read?bus_.read(bus_.context,a):0; }
void Cpu6502::write(std::uint16_t a,std::uint8_t v) const { if(bus_.write) bus_.write(bus_.context,a,v); }
std::uint8_t Cpu6502::fetch(){ auto v=read(state_.pc++); return v; }
std::uint16_t Cpu6502::fetch16(){ auto l=fetch(); return std::uint16_t(l|(std::uint16_t(fetch())<<8)); }
void Cpu6502::push(std::uint8_t v){write(std::uint16_t(0x100|state_.sp),v);--state_.sp;}
std::uint8_t Cpu6502::pull(){++state_.sp;return read(std::uint16_t(0x100|state_.sp));}
void Cpu6502::push16(std::uint16_t v){push(std::uint8_t(v>>8));push(std::uint8_t(v));}
std::uint16_t Cpu6502::pull16(){auto l=pull();return std::uint16_t(l|(std::uint16_t(pull())<<8));}
void Cpu6502::set_zn(std::uint8_t v){state_.p=std::uint8_t((state_.p&~(Z|N))|(v?0:Z)|(v&N)|U);}
void Cpu6502::adc(std::uint8_t v){const auto a=state_.a;const unsigned sum=unsigned(a)+v+(state_.p&C);const auto r=std::uint8_t(sum);state_.p=std::uint8_t((state_.p&~(C|V))|(sum>255?C:0)|((~(a^v)&(a^r)&0x80)?V:0)|U);state_.a=r;set_zn(r);}
void Cpu6502::compare(std::uint8_t r,std::uint8_t v){state_.p=std::uint8_t((state_.p&~C)|(r>=v?C:0));set_zn(std::uint8_t(r-v));}
void Cpu6502::reset(){state_={};state_.sp=0xfd;state_.p=0x24;state_.pc=std::uint16_t(read(0xfffc)|(std::uint16_t(read(0xfffd))<<8));nmi_=irq_=false;}
void Cpu6502::request_nmi(){nmi_=true;}
void Cpu6502::set_irq(bool level){irq_=level;}
void Cpu6502::interrupt(std::uint16_t vector,bool brk){push16(state_.pc);push(std::uint8_t((state_.p&~B)|U|(brk?B:0)));state_.p|=I;state_.pc=std::uint16_t(read(vector)|(std::uint16_t(read(vector+1))<<8));}
unsigned Cpu6502::step(){
 if(nmi_){nmi_=false;interrupt(0xfffa,false);state_.cycles+=7;return 7;}
 if(irq_&&!(state_.p&I)){interrupt(0xfffe,false);state_.cycles+=7;return 7;}
 const auto op=fetch(); unsigned cycles=2; std::uint16_t addr=0; bool crossed=false;
 auto resolve=[&](Mode m)->std::uint16_t{
  switch(m){
   case Mode::Imm: addr=state_.pc++; break;
   case Mode::Zp: addr=fetch(); break;
   case Mode::ZpX: addr=std::uint8_t(fetch()+state_.x); break;
   case Mode::ZpY: addr=std::uint8_t(fetch()+state_.y); break;
   case Mode::Abs: addr=fetch16(); break;
   case Mode::AbsX: {auto base=fetch16();addr=std::uint16_t(base+state_.x);crossed=(base&0xff00)!=(addr&0xff00);break;}
   case Mode::AbsY: {auto base=fetch16();addr=std::uint16_t(base+state_.y);crossed=(base&0xff00)!=(addr&0xff00);break;}
   case Mode::IndX: {auto z=std::uint8_t(fetch()+state_.x);addr=std::uint16_t(read(z)|(std::uint16_t(read(std::uint8_t(z+1)))<<8));break;}
   case Mode::IndY: {auto z=fetch();auto base=std::uint16_t(read(z)|(std::uint16_t(read(std::uint8_t(z+1)))<<8));addr=std::uint16_t(base+state_.y);crossed=(base&0xff00)!=(addr&0xff00);break;}
   case Mode::Rel: {auto o=std::int8_t(fetch());addr=std::uint16_t(state_.pc+o);break;}
  } return addr;
 };
 auto load=[&](Mode m,unsigned c,std::uint8_t& r){resolve(m);cycles=c+(crossed?1:0);r=read(addr);set_zn(r);};
 auto store=[&](Mode m,unsigned c,std::uint8_t v){resolve(m);cycles=c;write(addr,v);};
 auto branch=[&](bool yes){auto target=resolve(Mode::Rel);cycles=2;if(yes){cycles+=1+(((state_.pc&0xff00)!=(target&0xff00))?1:0);state_.pc=target;}};
 auto rmw=[&](Mode m,unsigned c,auto fn){resolve(m);cycles=c;auto v=read(addr);v=fn(v);write(addr,v);set_zn(v);};
 switch(op){
 // Loads
 case 0xa9:load(Mode::Imm,2,state_.a);break; case 0xa5:load(Mode::Zp,3,state_.a);break;case 0xb5:load(Mode::ZpX,4,state_.a);break;case 0xad:load(Mode::Abs,4,state_.a);break;case 0xbd:load(Mode::AbsX,4,state_.a);break;case 0xb9:load(Mode::AbsY,4,state_.a);break;case 0xa1:load(Mode::IndX,6,state_.a);break;case 0xb1:load(Mode::IndY,5,state_.a);break;
 case 0xa2:load(Mode::Imm,2,state_.x);break;case 0xa6:load(Mode::Zp,3,state_.x);break;case 0xb6:load(Mode::ZpY,4,state_.x);break;case 0xae:load(Mode::Abs,4,state_.x);break;case 0xbe:load(Mode::AbsY,4,state_.x);break;
 case 0xa0:load(Mode::Imm,2,state_.y);break;case 0xa4:load(Mode::Zp,3,state_.y);break;case 0xb4:load(Mode::ZpX,4,state_.y);break;case 0xac:load(Mode::Abs,4,state_.y);break;case 0xbc:load(Mode::AbsX,4,state_.y);break;
 // Stores
 case 0x85:store(Mode::Zp,3,state_.a);break;case 0x95:store(Mode::ZpX,4,state_.a);break;case 0x8d:store(Mode::Abs,4,state_.a);break;case 0x9d:store(Mode::AbsX,5,state_.a);break;case 0x99:store(Mode::AbsY,5,state_.a);break;case 0x81:store(Mode::IndX,6,state_.a);break;case 0x91:store(Mode::IndY,6,state_.a);break;
 case 0x86:store(Mode::Zp,3,state_.x);break;case 0x96:store(Mode::ZpY,4,state_.x);break;case 0x8e:store(Mode::Abs,4,state_.x);break;case 0x84:store(Mode::Zp,3,state_.y);break;case 0x94:store(Mode::ZpX,4,state_.y);break;case 0x8c:store(Mode::Abs,4,state_.y);break;
 // Logic and arithmetic
 case 0x69:case 0x65:case 0x75:case 0x6d:case 0x7d:case 0x79:case 0x61:case 0x71:{Mode m=op==0x69?Mode::Imm:op==0x65?Mode::Zp:op==0x75?Mode::ZpX:op==0x6d?Mode::Abs:op==0x7d?Mode::AbsX:op==0x79?Mode::AbsY:op==0x61?Mode::IndX:Mode::IndY;resolve(m);cycles=(m==Mode::Imm?2:m==Mode::Zp?3:m==Mode::ZpX?4:m==Mode::Abs?4:m==Mode::AbsX?4:m==Mode::AbsY?4:m==Mode::IndX?6:5)+(crossed?1:0);adc(read(addr));break;}
 case 0xe9:case 0xeb:case 0xe5:case 0xf5:case 0xed:case 0xfd:case 0xf9:case 0xe1:case 0xf1:{Mode m=op==0xe9||op==0xeb?Mode::Imm:op==0xe5?Mode::Zp:op==0xf5?Mode::ZpX:op==0xed?Mode::Abs:op==0xfd?Mode::AbsX:op==0xf9?Mode::AbsY:op==0xe1?Mode::IndX:Mode::IndY;resolve(m);cycles=(m==Mode::Imm?2:m==Mode::Zp?3:m==Mode::ZpX?4:m==Mode::Abs?4:m==Mode::AbsX?4:m==Mode::AbsY?4:m==Mode::IndX?6:5)+(crossed?1:0);adc(std::uint8_t(read(addr)^0xff));break;}
 case 0x29:case 0x25:case 0x35:case 0x2d:case 0x3d:case 0x39:case 0x21:case 0x31:
 case 0x09:case 0x05:case 0x15:case 0x0d:case 0x1d:case 0x19:case 0x01:case 0x11:
 case 0x49:case 0x45:case 0x55:case 0x4d:case 0x5d:case 0x59:case 0x41:case 0x51:{
  const bool isAnd=(op&0xe0)==0x20, isOra=(op&0xe0)==0x00; Mode m=(op&0x1f)==0x09||(op&0x1f)==0x01||(op&0x1f)==0x11||(op&0x1f)==0x19?Mode::Imm:Mode::Abs;
  // Decode addressing by opcode low pattern.
  if((op&0x1f)==0x05)m=Mode::Zp;else if((op&0x1f)==0x15)m=Mode::ZpX;else if((op&0x1f)==0x0d)m=Mode::Abs;else if((op&0x1f)==0x1d)m=Mode::AbsX;else if((op&0x1f)==0x19)m=Mode::AbsY;else if((op&0x1f)==0x01)m=Mode::IndX;else if((op&0x1f)==0x11)m=Mode::IndY;else m=Mode::Imm;
  resolve(m);cycles=(m==Mode::Imm?2:m==Mode::Zp?3:m==Mode::ZpX?4:m==Mode::Abs?4:m==Mode::AbsX?4:m==Mode::AbsY?4:m==Mode::IndX?6:5)+(crossed?1:0);
  auto v=read(addr);state_.a=isAnd?std::uint8_t(state_.a&v):isOra?std::uint8_t(state_.a|v):std::uint8_t(state_.a^v);set_zn(state_.a);break;}
 // Compare
 case 0xc9:case 0xc5:case 0xd5:case 0xcd:case 0xdd:case 0xd9:case 0xc1:case 0xd1:{Mode m=op==0xc9?Mode::Imm:op==0xc5?Mode::Zp:op==0xd5?Mode::ZpX:op==0xcd?Mode::Abs:op==0xdd?Mode::AbsX:op==0xd9?Mode::AbsY:op==0xc1?Mode::IndX:Mode::IndY;resolve(m);cycles=(m==Mode::Imm?2:m==Mode::Zp?3:m==Mode::ZpX?4:m==Mode::Abs?4:m==Mode::AbsX?4:m==Mode::AbsY?4:m==Mode::IndX?6:5)+(crossed?1:0);compare(state_.a,read(addr));break;}
 // Branches
 case 0x10:branch(!(state_.p&N));break;case 0x30:branch(state_.p&N);break;case 0x50:branch(!(state_.p&V));break;case 0x70:branch(state_.p&V);break;case 0x90:branch(!(state_.p&C));break;case 0xb0:branch(state_.p&C);break;case 0xd0:branch(!(state_.p&Z));break;case 0xf0:branch(state_.p&Z);break;
 // Transfers, increments and flags
 case 0xaa:state_.x=state_.a;set_zn(state_.x);break;case 0x8a:state_.a=state_.x;set_zn(state_.a);break;case 0xa8:state_.y=state_.a;set_zn(state_.y);break;case 0x98:state_.a=state_.y;set_zn(state_.a);break;case 0xba:state_.x=state_.sp;set_zn(state_.x);break;case 0x9a:state_.sp=state_.x;break;
 case 0xe8:++state_.x;set_zn(state_.x);break;case 0xca:--state_.x;set_zn(state_.x);break;case 0xc8:++state_.y;set_zn(state_.y);break;case 0x88:--state_.y;set_zn(state_.y);break;
 case 0x18:state_.p&=~C;break;case 0x38:state_.p|=C;break;case 0x58:state_.p&=~I;break;case 0x78:state_.p|=I;break;case 0xb8:state_.p&=~V;break;case 0xd8:state_.p&=~D;break;case 0xf8:state_.p|=D;break;
 // Stack and control
 case 0x48:push(state_.a);cycles=3;break;case 0x68:state_.a=pull();set_zn(state_.a);cycles=4;break;case 0x08:push(state_.p|B|U);cycles=3;break;case 0x28:state_.p=std::uint8_t((pull()&~B)|U);cycles=4;break;
 case 0x4c:state_.pc=fetch16();cycles=3;break;case 0x6c:{auto p=fetch16();auto l=read(p);auto h=read(std::uint16_t((p&0xff00)|std::uint8_t(p+1)));state_.pc=std::uint16_t(l|(std::uint16_t(h)<<8));cycles=5;break;}
 case 0x20:{auto target=fetch16();push16(std::uint16_t(state_.pc-1));state_.pc=target;cycles=6;break;}case 0x60:state_.pc=std::uint16_t(pull16()+1);cycles=6;break;
 case 0x40:state_.p=std::uint8_t((pull()&~B)|U);state_.pc=pull16();cycles=6;break;case 0x00:++state_.pc;interrupt(0xfffe,true);cycles=7;break;
 // Shifts and memory RMW
 case 0x0a:state_.p=std::uint8_t((state_.p&~C)|((state_.a&0x80)?C:0));state_.a=std::uint8_t(state_.a<<1);set_zn(state_.a);break;
 case 0x4a:state_.p=std::uint8_t((state_.p&~C)|(state_.a&1));state_.a>>=1;set_zn(state_.a);break;
 case 0x2a:{auto c=state_.p&C;state_.p=std::uint8_t((state_.p&~C)|((state_.a&0x80)?C:0));state_.a=std::uint8_t((state_.a<<1)|c);set_zn(state_.a);break;}
 case 0x6a:{auto c=state_.p&C;state_.p=std::uint8_t((state_.p&~C)|(state_.a&1));state_.a=std::uint8_t((state_.a>>1)|(c?0x80:0));set_zn(state_.a);break;}
 case 0xea:break;
 default: // Unknown/unsupported opcode is a deterministic 2-cycle NOP.
  break;
 }
 state_.p|=U;state_.cycles+=cycles;return cycles;
}
} // namespace emuhub
