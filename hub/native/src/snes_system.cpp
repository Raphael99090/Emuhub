#include "snes_system.h"
#include <algorithm>

namespace emuhub {
namespace {
const int kOffs0[] = {0}, kOffs1[] = {0, 1}, kOffs2[] = {0, 0}, kOffs3[] = {0, 0, 1, 1}, kOffs4[] = {0, 1, 2, 3}, kOffs5[] = {0, 1, 0, 1};
struct Offs { const int* v; int n; };
const Offs kDma[8] = {{kOffs0, 1}, {kOffs1, 2}, {kOffs2, 2}, {kOffs3, 4}, {kOffs4, 4}, {kOffs5, 4}, {kOffs2, 2}, {kOffs3, 4}};
}  // namespace

SnesSystem::SnesSystem(SnesPpuIface* ppu, SnesApuIface* apu) : ppu_(ppu), apu_(apu), cpu_(this) {}

void SnesSystem::load(const std::uint8_t* rom, std::size_t size, bool hirom, std::size_t sram_bytes) {
  std::size_t m = 1; while (m < size) m <<= 1;
  rom_.assign(m, 0); std::copy(rom, rom + size, rom_.begin());
  rom_mask_ = static_cast<std::uint32_t>(m - 1); hirom_ = hirom;
  sram_.assign(sram_bytes, 0); sram_mask_ = sram_bytes ? static_cast<std::uint32_t>(sram_bytes - 1) : 0;
  reset();
}

void SnesSystem::reset() {
  std::fill(wram_.begin(), wram_.end(), 0); cyc_ = 0; line_ = 0; nmi_pending = false; irq_line = false; gsu_irq = false;
  nmitimen_ = rdnmi_ = timeup_ = hvbjoy_ = memsel_ = dma_en_ = hdma_en_ = 0; htime_ = vtime_ = 0x1FF;
  ppu_->reset(); apu_->reset(); cpu_.reset();
}

int SnesSystem::speed(std::uint32_t a) const {
  const int bank = a >> 16, off = a & 0xFFFF;
  if (!(bank & 0x40)) {
    if (off < 0x2000) return 8;
    if (off < 0x4000) return 6;
    if (off < 0x4200) return 12;
    if (off < 0x6000) return 6;
    if (off < 0x8000) return 8;
    return ((bank & 0x80) && (memsel_ & 1)) ? 6 : 8;
  }
  return (bank >= 0xC0 && (memsel_ & 1)) ? 6 : 8;
}

std::uint8_t SnesSystem::read(std::uint32_t a) { cyc_ += speed(a) * clk_; mdr_ = raw_read(a); return static_cast<std::uint8_t>(mdr_); }
void SnesSystem::write(std::uint32_t a, std::uint8_t v) { cyc_ += speed(a) * clk_; raw_write(a, v); }

std::uint8_t SnesSystem::rom_at(int bank, int off) const {
  if (hirom_) return rom_[((static_cast<std::uint32_t>(bank & 0x3F) << 16) | off) & rom_mask_];
  return rom_[((static_cast<std::uint32_t>(bank & 0x7F) << 15) | (off & 0x7FFF)) & rom_mask_];
}

std::uint8_t SnesSystem::raw_read(std::uint32_t a) {
  const int bank = a >> 16, off = a & 0xFFFF;
  if (bank == 0x7E || bank == 0x7F) return wram_[((bank & 1) << 16) | off];
  if (!(bank & 0x40)) {
    if (off < 0x2000) return wram_[off];
    if (off < 0x8000) {
      if (off < 0x2100) return mdr_;
      if (off < 0x2140) return ppu_->read_reg(off);
      if (off < 0x2180) return apu_->read_port(off & 3, cyc_);
      if (off == 0x2180) { const std::uint8_t v = wram_[wmadd_]; wmadd_ = (wmadd_ + 1) & 0x1FFFF; return v; }
      if (off >= 0x4200 && off < 0x4400) return reg_read(off);
      if (off == 0x4016 || off == 0x4017) return joy_read(off & 1);
      if (off >= 0x6000 && hirom_ && (bank & 0x3F) >= 0x20 && sram_mask_) return sram_[((static_cast<std::uint32_t>(bank & 0x1F) << 13) | (off - 0x6000)) & sram_mask_];
      return mdr_;
    }
    return rom_at(bank, off);
  }
  if (hirom_) return rom_[((static_cast<std::uint32_t>(bank & 0x3F) << 16) | off) & rom_mask_];
  if (bank >= 0x70 && bank < 0x7E && off < 0x8000) return sram_mask_ ? sram_[((static_cast<std::uint32_t>(bank - 0x70) << 15) | off) & sram_mask_] : mdr_;
  if (bank >= 0xF0 && off < 0x8000) return sram_mask_ ? sram_[((static_cast<std::uint32_t>(bank - 0xF0) << 15) | off) & sram_mask_] : mdr_;
  return rom_[((static_cast<std::uint32_t>(bank & 0x7F) << 15) | (off & 0x7FFF)) & rom_mask_];
}

void SnesSystem::raw_write(std::uint32_t a, std::uint8_t v) {
  const int bank = a >> 16, off = a & 0xFFFF;
  if (bank == 0x7E || bank == 0x7F) { wram_[((bank & 1) << 16) | off] = v; return; }
  if (!(bank & 0x40)) {
    if (off < 0x2000) { wram_[off] = v; return; }
    if (off < 0x8000) {
      if (off < 0x2100) return;
      if (off < 0x2140) { ppu_->write_reg(off, v); return; }
      if (off < 0x2180) { apu_->write_port(off & 3, v, cyc_); return; }
      if (off == 0x2180) { wram_[wmadd_] = v; wmadd_ = (wmadd_ + 1) & 0x1FFFF; return; }
      if (off == 0x2181) { wmadd_ = (wmadd_ & 0x1FF00) | v; return; }
      if (off == 0x2182) { wmadd_ = (wmadd_ & 0x100FF) | (static_cast<std::uint32_t>(v) << 8); return; }
      if (off == 0x2183) { wmadd_ = (wmadd_ & 0xFFFF) | (static_cast<std::uint32_t>(v & 1) << 16); return; }
      if (off == 0x4016) { joy_strobe_ = v & 1; if (joy_strobe_) { joy_shift_[0] = joy_[0]; joy_shift_[1] = joy_[1]; } return; }
      if (off >= 0x4200 && off < 0x4400) { reg_write(off, v); return; }
      if (off >= 0x6000 && hirom_ && (bank & 0x3F) >= 0x20 && sram_mask_) sram_[((static_cast<std::uint32_t>(bank & 0x1F) << 13) | (off - 0x6000)) & sram_mask_] = v;
    }
    return;
  }
  if (hirom_) return;
  if (sram_mask_ && off < 0x8000) {
    if (bank >= 0x70 && bank < 0x7E) sram_[((static_cast<std::uint32_t>(bank - 0x70) << 15) | off) & sram_mask_] = v;
    else if (bank >= 0xF0) sram_[((static_cast<std::uint32_t>(bank - 0xF0) << 15) | off) & sram_mask_] = v;
  }
}

void SnesSystem::set_buttons(std::uint16_t m) {
  int j = 0;
  if (m & 2) j |= 0x8000; if (m & 512) j |= 0x4000; if (m & 4) j |= 0x2000; if (m & 8) j |= 0x1000;
  if (m & 16) j |= 0x0800; if (m & 32) j |= 0x0400; if (m & 64) j |= 0x0200; if (m & 128) j |= 0x0100;
  if (m & 1) j |= 0x0080; if (m & 256) j |= 0x0040; if (m & 1024) j |= 0x0020; if (m & 2048) j |= 0x0010;
  if ((j & 0x0C00) == 0x0C00) j &= ~0x0C00;
  if ((j & 0x0300) == 0x0300) j &= ~0x0300;
  joy_[0] = static_cast<std::uint16_t>(j);
}

std::uint8_t SnesSystem::joy_read(int p) {
  if (joy_strobe_) return static_cast<std::uint8_t>((mdr_ & 0xFC) | ((joy_[p] & 0x8000) ? 1 : 0));
  const int v = (joy_shift_[p] & 0x8000) ? 1 : 0;
  joy_shift_[p] = static_cast<std::uint16_t>(((joy_shift_[p] << 1) | 1) & 0xFFFF);
  return static_cast<std::uint8_t>((mdr_ & 0xFC) | v);
}

std::uint8_t SnesSystem::reg_read(int a) {
  switch (a) {
    case 0x4210: { const int v = rdnmi_ | 0x02; rdnmi_ = 0; return static_cast<std::uint8_t>(v | (mdr_ & 0x70)); }
    case 0x4211: { const int v = timeup_; timeup_ = 0; irq_line = false; return static_cast<std::uint8_t>(v | (mdr_ & 0x7F)); }
    case 0x4212: return static_cast<std::uint8_t>(hvbjoy_ | (cyc_ >= kHblank ? 0x40 : 0) | (line_ >= 225 ? 0x80 : 0) | (mdr_ & 0x3E));
    case 0x4213: return static_cast<std::uint8_t>(wrio_);
    case 0x4214: return div_q_ & 0xFF; case 0x4215: return (div_q_ >> 8) & 0xFF;
    case 0x4216: return mul_res_ & 0xFF; case 0x4217: return (mul_res_ >> 8) & 0xFF;
    case 0x4218: case 0x421A: case 0x421C: case 0x421E: return joy_auto_[(a - 0x4218) >> 1] & 0xFF;
    case 0x4219: case 0x421B: case 0x421D: case 0x421F: return joy_auto_[(a - 0x4218) >> 1] >> 8;
  }
  if (a >= 0x4300 && a < 0x4380) {
    const Channel& c = ch_[(a >> 4) & 7];
    switch (a & 0xF) {
      case 0: return c.ctl; case 1: return c.bbad; case 2: return c.a1t & 0xFF; case 3: return c.a1t >> 8; case 4: return c.a1b;
      case 5: return c.das & 0xFF; case 6: return c.das >> 8; case 7: return c.dasb; case 8: return c.a2a & 0xFF; case 9: return c.a2a >> 8;
      case 10: return c.ntrl; default: return c.unused;
    }
  }
  return static_cast<std::uint8_t>(mdr_);
}

void SnesSystem::reg_write(int a, std::uint8_t v) {
  switch (a) {
    case 0x4200: {
      const int was = nmitimen_; nmitimen_ = v;
      if (!(v & 0x80)) nmi_pending = false;
      else if (!(was & 0x80) && (rdnmi_ & 0x80)) nmi_pending = true;
      if (!(v & 0x30)) irq_line = false;
      return;
    }
    case 0x4201: wrio_ = v; return;
    case 0x4202: mul_a_ = v; return;
    case 0x4203: mul_res_ = mul_a_ * v; return;
    case 0x4204: div_a_ = (div_a_ & 0xFF00) | v; return;
    case 0x4205: div_a_ = (div_a_ & 0xFF) | (v << 8); return;
    case 0x4206: if (v) { div_q_ = div_a_ / v; mul_res_ = div_a_ % v; } else { div_q_ = 0xFFFF; mul_res_ = div_a_; } return;
    case 0x4207: htime_ = (htime_ & 0x100) | v; return;
    case 0x4208: htime_ = (htime_ & 0xFF) | ((v & 1) << 8); return;
    case 0x4209: vtime_ = (vtime_ & 0x100) | v; return;
    case 0x420A: vtime_ = (vtime_ & 0xFF) | ((v & 1) << 8); return;
    case 0x420B: dma_en_ = v; if (v) run_dma(); return;
    case 0x420C: hdma_en_ = v; return;
    case 0x420D: memsel_ = v & 1; return;
  }
  if (a >= 0x4300 && a < 0x4380) {
    Channel& c = ch_[(a >> 4) & 7];
    switch (a & 0xF) {
      case 0: c.ctl = v; break; case 1: c.bbad = v; break;
      case 2: c.a1t = (c.a1t & 0xFF00) | v; break; case 3: c.a1t = (c.a1t & 0xFF) | (v << 8); break; case 4: c.a1b = v; break;
      case 5: c.das = (c.das & 0xFF00) | v; break; case 6: c.das = (c.das & 0xFF) | (v << 8); break; case 7: c.dasb = v; break;
      case 8: c.a2a = (c.a2a & 0xFF00) | v; break; case 9: c.a2a = (c.a2a & 0xFF) | (v << 8); break;
      case 10: c.ntrl = v; break; default: c.unused = v;
    }
  }
}

std::uint8_t SnesSystem::read_b(int r) {
  if (r < 0x40) return ppu_->read_reg(0x2100 + r);
  if (r < 0x80) return apu_->read_port(r & 3, cyc_);
  if (r == 0x80) { const std::uint8_t v = wram_[wmadd_]; wmadd_ = (wmadd_ + 1) & 0x1FFFF; return v; }
  return 0;
}

void SnesSystem::run_dma() {
  cyc_ += 16;
  for (int i = 0; i < 8; i++) {
    if (!(dma_en_ & (1 << i))) continue;
    Channel& c = ch_[i]; const Offs& o = kDma[c.ctl & 7]; const int dir = c.ctl & 0x80;
    const int step = (c.ctl & 0x08) ? 0 : ((c.ctl & 0x10) ? -1 : 1);
    int n = c.das ? c.das : 0x10000, k = 0;
    cyc_ += 8;
    while (n > 0) {
      const int b = (c.bbad + o.v[k & (o.n - 1)]) & 0xFF; const std::uint32_t aa = (static_cast<std::uint32_t>(c.a1b) << 16) | c.a1t;
      if (dir) raw_write(aa, read_b(b)); else { const std::uint8_t v = raw_read(aa); write_b(b, v); }
      c.a1t = (c.a1t + step) & 0xFFFF;
      k++; n--; cyc_ += 8;
    }
    c.das = 0;
  }
  dma_en_ = 0;
}

void SnesSystem::hdma_init() {
  for (int i = 0; i < 8; i++) {
    Channel& c = ch_[i]; c.done = !(hdma_en_ & (1 << i)); c.do_transfer = false;
    if (c.done) continue;
    c.a2a = c.a1t; hdma_load(c);
  }
}
void SnesSystem::hdma_load(Channel& c) {
  c.ntrl = raw_read((static_cast<std::uint32_t>(c.a1b) << 16) | c.a2a); c.a2a = (c.a2a + 1) & 0xFFFF;
  if (c.ntrl == 0) { c.done = true; c.do_transfer = false; return; }
  if (c.ctl & 0x40) {
    c.das = raw_read((static_cast<std::uint32_t>(c.a1b) << 16) | c.a2a) | (raw_read((static_cast<std::uint32_t>(c.a1b) << 16) | ((c.a2a + 1) & 0xFFFF)) << 8);
    c.a2a = (c.a2a + 2) & 0xFFFF;
  }
  c.do_transfer = true;
}
void SnesSystem::hdma_run() {
  for (int i = 0; i < 8; i++) {
    Channel& c = ch_[i];
    if (c.done || !(hdma_en_ & (1 << i))) continue;
    if (c.do_transfer) {
      const Offs& o = kDma[c.ctl & 7]; const int ind = c.ctl & 0x40;
      for (int k = 0; k < o.n; k++) {
        std::uint8_t v;
        if (ind) { v = raw_read((static_cast<std::uint32_t>(c.dasb) << 16) | c.das); c.das = (c.das + 1) & 0xFFFF; }
        else { v = raw_read((static_cast<std::uint32_t>(c.a1b) << 16) | c.a2a); c.a2a = (c.a2a + 1) & 0xFFFF; }
        write_b((c.bbad + o.v[k]) & 0xFF, v);
      }
      cyc_ += 8 * o.n + 8;
    }
    c.ntrl = (c.ntrl - 1) & 0xFF; c.do_transfer = (c.ntrl & 0x80) != 0;
    if ((c.ntrl & 0x7F) == 0) hdma_load(c);
  }
}

int SnesSystem::irq_target() const {
  const int mode = (nmitimen_ >> 4) & 3;
  if (!mode) return -1;
  if (mode == 1) return htime_ * 4 + 14;
  if (line_ != vtime_) return -1;
  return mode == 2 ? 10 : htime_ * 4 + 14;
}

void SnesSystem::run_line() {
  const int v = line_; int irq_at = irq_target(); bool rendered = false;
  if (v == 0) { rdnmi_ &= 0x7F; hdma_init(); }
  const int vb = (ppu_->setini() & 4) ? 240 : 225;
  if (v == vb) {
    rdnmi_ |= 0x80; if (nmitimen_ & 0x80) nmi_pending = true;
    if (nmitimen_ & 1) { for (int i = 0; i < 4; i++) joy_auto_[i] = joy_[i]; hvbjoy_ = 1; }
  } else if (v == vb + 3) hvbjoy_ = 0;
  for (;;) {
    if (!rendered && cyc_ >= kHblank) {
      rendered = true;
      if (v >= 1 && v < vb) ppu_->render_line(v - 1);
      if (v < vb && hdma_en_) hdma_run();
    }
    if (irq_at >= 0 && cyc_ >= irq_at) { irq_at = -1; timeup_ = 0x80; irq_line = true; }
    if (cyc_ >= kLine) break;
    cpu_.step();
  }
  cyc_ -= kLine;
  apu_->sync_line(cyc_ + kLine);
  line_ = v + 1;
}

void SnesSystem::run_frame() {
  ppu_->begin_frame();
  for (int i = 0; i < kLines; i++) run_line();
  ppu_->finish_frame();
  line_ = 0;
}

}  // namespace emuhub
