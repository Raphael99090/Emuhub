#include "nes_cartridge.h"
#include <algorithm>

namespace emuhub {
namespace {
constexpr std::size_t kHeaderSize=16, kTrainerSize=512, kPrgBankSize=16384,
                      kChrBankSize=8192, kMaxRomSize=64u*1024u*1024u;
constexpr std::uint8_t kHorizontal=0, kVertical=1, kSingle0=2, kSingle1=3, kFour=4;
}

CartridgeError NesCartridge::load(const std::uint8_t* data,std::size_t size) {
  reset();
  if(!data||size<kHeaderSize||size>kMaxRomSize) return CartridgeError::InvalidArgument;
  if(data[0]!='N'||data[1]!='E'||data[2]!='S'||data[3]!=0x1a) return CartridgeError::InvalidHeader;
  const auto f6=data[6], f7=data[7];
  // NES 2.0: bits 2-3 de f7 == 0b10 e o tamanho declarado cabe no arquivo
  bool nes2=(f7&0x0c)==0x08;
  std::size_t prg_bytes, chr_bytes;
  auto size_of=[&](std::uint8_t lsb,std::uint8_t msb,std::size_t unit) -> std::size_t {
    if(msb==0x0f) return (std::size_t(1)<<(lsb>>2))*(std::size_t(lsb&3)*2+1);  // notação exponencial
    return (std::size_t(msb)<<8|lsb)*unit;
  };
  unsigned mapper;
  std::size_t prg_ram_bytes=8192;
  if(nes2) {
    mapper=unsigned(f6>>4)|(f7&0xf0)|(unsigned(data[8]&0x0f)<<8);
    prg_bytes=size_of(data[4],data[9]&0x0f,kPrgBankSize);
    chr_bytes=size_of(data[5],data[9]>>4,kChrBankSize);
    const unsigned ram=(data[10]&0x0f)|(data[10]>>4);          // RAM volátil ou com bateria (o maior)
    const unsigned sh=std::max(data[10]&0x0f,data[10]>>4);
    if(sh) prg_ram_bytes=std::max<std::size_t>(8192,std::size_t(64)<<sh);
    (void)ram;
  } else {
    // iNES 1.0: cabeçalhos "sujos" (ex.: DiskDude!) têm lixo nos bytes 8-15; nesse caso o mapper vem só de f6
    bool dirty=false; for(int i=8;i<16;i++) if(data[i]) dirty=true;
    mapper=dirty?unsigned(f6>>4):unsigned((f7&0xf0)|(f6>>4));
    prg_bytes=std::size_t(data[4])*kPrgBankSize; chr_bytes=std::size_t(data[5])*kChrBankSize;
    if(data[8]) prg_ram_bytes=std::max<std::size_t>(8192,std::size_t(data[8])*8192);
  }
  if(!prg_bytes) return CartridgeError::InvalidPrgSize;
  if(mapper!=0&&mapper!=1&&mapper!=2&&mapper!=3&&mapper!=4&&mapper!=7)
    return CartridgeError::UnsupportedMapper;
  const bool trainer=(f6&4)!=0;
  const std::size_t off=kHeaderSize+(trainer?kTrainerSize:0);
  if(off>size||prg_bytes>size-off||chr_bytes>size-off-prg_bytes) return CartridgeError::TruncatedRom;
  mapper_=static_cast<std::uint8_t>(mapper);
  mirroring_=(f6&8)?kFour:((f6&1)?kVertical:kHorizontal); header_mirroring_=mirroring_;
  battery_=(f6&2)!=0; trainer_present_=trainer;
  prg_.assign(data+off,data+off+prg_bytes);
  if(chr_bytes) { chr_.assign(data+off+prg_bytes,data+off+prg_bytes+chr_bytes); chr_is_ram_=false; }
  else { chr_.assign(kChrBankSize,0); chr_is_ram_=true; }
  prg_ram_.assign(prg_ram_bytes,0); loaded_=true;
  uxrom_bank_=0; mmc1_shift_=0x10; mmc1_control_=0x0c;
  mmc1_chr0_=mmc1_chr1_=mmc1_prg_=0;
  mmc3_select_=0; const std::uint8_t init[8]={0,2,4,5,6,7,0,1};
  std::copy(init,init+8,mmc3_regs_);
  mmc3_irq_latch_=mmc3_irq_counter_=0;
  mmc3_irq_reload_=mmc3_irq_enable_=irq_=false;
  if(mapper_==1) mmc1_mirroring();
  return CartridgeError::Ok;
}

void NesCartridge::reset() {
  loaded_=false; mapper_=0; mirroring_=header_mirroring_=kHorizontal; battery_=false;
  trainer_present_=false; chr_is_ram_=false; prg_.clear(); chr_.clear();
  prg_ram_.clear(); uxrom_bank_=0; mmc1_shift_=0x10; mmc1_control_=0x0c;
  mmc1_chr0_=mmc1_chr1_=mmc1_prg_=0; mmc3_select_=0;
  const std::uint8_t init[8]={0,2,4,5,6,7,0,1}; std::copy(init,init+8,mmc3_regs_);
  mmc3_irq_latch_=mmc3_irq_counter_=0; mmc3_irq_reload_=mmc3_irq_enable_=irq_=false;
}

void NesCartridge::reset_mapper() {
  if(!loaded_) return;
  uxrom_bank_=0; mmc1_shift_=0x10; mmc1_control_=0x0c;
  mmc1_chr0_=mmc1_chr1_=mmc1_prg_=0;
  mmc3_select_=0; const std::uint8_t init[8]={0,2,4,5,6,7,0,1};
  std::copy(init,init+8,mmc3_regs_);
  mmc3_irq_latch_=mmc3_irq_counter_=0;
  mmc3_irq_reload_=mmc3_irq_enable_=irq_=false;
  mirroring_=header_mirroring_;
  if(mapper_==1) mmc1_mirroring();
}

void NesCartridge::mmc1_mirroring() {
  if(mirroring_==kFour) return;
  const std::uint8_t modes[4]={kSingle0,kSingle1,kVertical,kHorizontal};
  mirroring_=modes[mmc1_control_&3];
}

std::size_t NesCartridge::prg_offset(std::uint16_t a) const {
  const std::size_t len=prg_.size(), banks=len/kPrgBankSize;
  switch(mapper_) {
    case 1: {
      const unsigned mode=(mmc1_control_>>2)&3;
      if(mode<2) return ((((std::size_t(mmc1_prg_)&0x0e)<<14)+(a-0x8000))%len);
      const std::size_t bank=mode==2?(a<0xc000?0:(mmc1_prg_&0x0f)):
        (a<0xc000?(mmc1_prg_&0x0f):(banks-1));
      return (bank*kPrgBankSize+(a&0x3fff))%len;
    }
    case 2: {
      const std::size_t bank=a<0xc000?std::size_t(uxrom_bank_)%banks:banks-1;
      return bank*kPrgBankSize+(a&0x3fff);
    }
    case 4: {
      const std::size_t n8=len/8192; const unsigned slot=(a>>13)&3; std::size_t bank;
      if(slot==3) bank=n8-1;
      else if(slot==1) bank=mmc3_regs_[7];
      else if((slot==0)==((mmc3_select_&0x40)==0)) bank=mmc3_regs_[6];
      else bank=n8-2;
      return ((bank&0x3f)%n8)*8192+(a&0x1fff);
    }
    case 7: return (((std::size_t(uxrom_bank_)&7)<<15)+(a-0x8000))%len;
    default: return (a-0x8000)%len; // NROM and CNROM
  }
}

std::size_t NesCartridge::chr_offset(std::uint16_t a) const {
  const std::size_t len=chr_.size();
  switch(mapper_) {
    case 1:
      if(!(mmc1_control_&0x10)) return (((std::size_t(mmc1_chr0_)&0x1e)<<12)+a)%len;
      return a<0x1000?((std::size_t(mmc1_chr0_)<<12)+a)%len:
        ((std::size_t(mmc1_chr1_)<<12)+(a&0x0fff))%len;
    case 3: return ((std::size_t(uxrom_bank_&3)<<13)+a)%len;
    case 4: {
      unsigned x=a; if(mmc3_select_&0x80) x^=0x1000;
      const unsigned slot=x>>10; unsigned bank;
      if(slot==0) bank=mmc3_regs_[0]&0xfe;
      else if(slot==1) bank=mmc3_regs_[0]|1;
      else if(slot==2) bank=mmc3_regs_[1]&0xfe;
      else if(slot==3) bank=mmc3_regs_[1]|1;
      else bank=mmc3_regs_[slot-2];
      const std::size_t count=len/1024;
      return ((std::size_t(bank)%count)<<10)+(a&0x03ff);
    }
    default: return a%len;
  }
}

std::uint8_t NesCartridge::cpu_read(std::uint16_t a) const {
  if(!loaded_) return 0;
  if(a>=0x6000&&a<0x8000) return prg_ram_[a-0x6000];
  if(a<0x8000) return 0;
  return prg_[prg_offset(a)];
}

void NesCartridge::mmc1_write(std::uint16_t a,std::uint8_t v) {
  if(v&0x80) { mmc1_shift_=0x10; mmc1_control_|=0x0c; mmc1_mirroring(); return; }
  const bool complete=(mmc1_shift_&1)!=0;
  mmc1_shift_=std::uint8_t((mmc1_shift_>>1)|((v&1)<<4));
  if(complete) {
    const auto value=mmc1_shift_;
    switch((a>>13)&3) {
      case 0: mmc1_control_=value; mmc1_mirroring(); break;
      case 1: mmc1_chr0_=value; break;
      case 2: mmc1_chr1_=value; break;
      case 3: mmc1_prg_=value; break;
    }
    mmc1_shift_=0x10;
  }
}

void NesCartridge::mmc3_write(std::uint16_t a,std::uint8_t v) {
  const bool even=(a&1)==0;
  if(a<0xa000) {
    if(even) mmc3_select_=v;
    else mmc3_regs_[mmc3_select_&7]=v;
  } else if(a<0xc000) {
    if(even&&mirroring_!=kFour) mirroring_=(v&1)?kHorizontal:kVertical;
  } else if(a<0xe000) {
    if(even) mmc3_irq_latch_=v;
    else { mmc3_irq_counter_=0; mmc3_irq_reload_=true; }
  } else if(even) { mmc3_irq_enable_=false; irq_=false; }
  else mmc3_irq_enable_=true;
}

void NesCartridge::cpu_write(std::uint16_t a,std::uint8_t v) {
  if(!loaded_) return;
  if(a>=0x6000&&a<0x8000) { prg_ram_[a-0x6000]=v; return; }
  if(a<0x8000) return;
  switch(mapper_) {
    case 1: mmc1_write(a,v); break;
    case 2: uxrom_bank_=v; break;
    case 3: uxrom_bank_=v&3; break;
    case 4: mmc3_write(a,v); break;
    case 7: uxrom_bank_=v; mirroring_=(v&0x10)?kSingle1:kSingle0; break;
    default: break;
  }
}

void NesCartridge::scanline() {
  if(mapper_!=4) return;
  if(mmc3_irq_counter_==0||mmc3_irq_reload_) {
    mmc3_irq_counter_=mmc3_irq_latch_; mmc3_irq_reload_=false;
  } else --mmc3_irq_counter_;
  if(mmc3_irq_counter_==0&&mmc3_irq_enable_) irq_=true;
}

std::uint8_t NesCartridge::ppu_read(std::uint16_t a) const {
  return loaded_&&a<0x2000?chr_[chr_offset(a)]:0;
}
void NesCartridge::ppu_write(std::uint16_t a,std::uint8_t v) {
  if(loaded_&&chr_is_ram_&&a<0x2000) chr_[chr_offset(a)]=v;
}
} // namespace emuhub
