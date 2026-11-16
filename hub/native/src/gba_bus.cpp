// Mapa de memória do GBA (porte de hub/src/cores/gba/bus.js): regiões, ciclos de espera, SRAM/Flash/EEPROM.
#include "gba_machine.h"

namespace emuhub {

namespace {
const int kWait16[16] = {1, 1, 3, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 5, 5};
const int kWait32[16] = {1, 1, 6, 1, 1, 2, 2, 1, 6, 6, 6, 6, 6, 6, 5, 5};
inline std::uint32_t ld16(const std::uint8_t* p) { std::uint16_t v; std::memcpy(&v, p, 2); return v; }
inline std::uint32_t ld32(const std::uint8_t* p) { std::uint32_t v; std::memcpy(&v, p, 4); return v; }
inline void st16(std::uint8_t* p, std::uint32_t v) { std::uint16_t x = static_cast<std::uint16_t>(v); std::memcpy(p, &x, 2); }
inline void st32(std::uint8_t* p, std::uint32_t v) { std::memcpy(p, &v, 4); }
inline std::uint32_t vram_off(std::uint32_t a) { std::uint32_t v = a & 0x1FFFF; return v >= 0x18000 ? v - 0x8000 : v; }
}  // namespace

std::uint32_t GbaMachine::rom_read16(std::uint32_t a) const {
  const std::uint32_t o = a & 0x1FFFFFE;
  if (o >= rom_len_) return (o >> 1) & 0xFFFF;
  return ld16(rom_.data() + o);
}
std::uint32_t GbaMachine::rom_read32(std::uint32_t a) const {
  const std::uint32_t o = a & 0x1FFFFFC;
  if (o + 4 <= rom_len_) return ld32(rom_.data() + o);
  return (rom_read16(o + 2) << 16) | rom_read16(o);
}
std::uint32_t GbaMachine::rom_read8(std::uint32_t a) const {
  const std::uint32_t o = a & 0x1FFFFFF;
  if (o >= rom_len_) return ((o >> 1) >> ((o & 1) << 3)) & 0xFF;
  return rom_[o];
}

std::uint32_t GbaMachine::save_read(std::uint32_t a) const {
  a &= 0xFFFF;
  if (save_type_ == 1 || save_type_ == 2) {
    if (fl_.id && a < 2) {
      static const std::uint8_t id128[2] = {0x62, 0x13}, id64[2] = {0x32, 0x1B};
      return save_type_ == 2 ? id128[a] : id64[a];
    }
    return sram_[(static_cast<std::uint32_t>(fl_.bank) << 16) | a];
  }
  return sram_[a];
}

void GbaMachine::save_write(std::uint32_t a, std::uint32_t v) {
  a &= 0xFFFF;
  if (save_type_ == 0) { sram_[a] = static_cast<std::uint8_t>(v); return; }
  if (save_type_ == 3) return;
  Flash& f = fl_;
  const std::uint32_t base = static_cast<std::uint32_t>(f.bank) << 16;
  if (f.prog) { sram_[base | a] = static_cast<std::uint8_t>(v); f.prog = 0; return; }
  if (f.bank_sw) { if (a == 0 && save_type_ == 2) f.bank = v & 1; f.bank_sw = 0; return; }
  if (f.state == 0) { if (a == 0x5555 && v == 0xAA) f.state = 1; else if (v == 0xF0) f.id = 0; return; }
  if (f.state == 1) { f.state = (a == 0x2AAA && v == 0x55) ? 2 : 0; return; }
  f.state = 0;
  if (a == 0x5555) {
    switch (v) {
      case 0x90: f.id = 1; break;
      case 0xF0: f.id = 0; break;
      case 0x80: f.erase = 1; break;
      case 0x10: if (f.erase) std::memset(sram_.data(), 0xFF, save_type_ == 2 ? 0x20000 : 0x10000); f.erase = 0; break;
      case 0xA0: f.prog = 1; break;
      case 0xB0: if (save_type_ == 2) f.bank_sw = 1; break;
      default: break;
    }
  } else if (f.erase && v == 0x30) {
    std::memset(sram_.data() + (base | (a & 0xF000)), 0xFF, 0x1000); f.erase = 0;
  }
}

void GbaMachine::ee_detect(int n) {
  if (ee_.size) return;
  if (n == 9 || n == 73) ee_.size = 512; else if (n == 17 || n == 81) ee_.size = 8192;
}
std::uint32_t GbaMachine::ee_read() { return ee_.out_pos < 68 ? ee_.out[ee_.out_pos++] : 1; }
void GbaMachine::ee_write(std::uint32_t v) {
  Eeprom& e = ee_;
  e.out_pos = 68;
  if (!e.size) return;
  if (e.bits < 256) e.buf[e.bits] = v & 1;
  e.bits++;
  const int ab = e.size == 512 ? 6 : 14;
  if (e.bits < 2 + ab + 1) return;
  const bool rd = e.buf[0] == 1 && e.buf[1] == 1, wr = e.buf[0] == 1 && e.buf[1] == 0;
  if (!rd && !wr) { e.bits = 0; return; }
  std::uint32_t addr = 0;
  for (int i = 0; i < ab; i++) addr = (addr << 1) | e.buf[2 + i];
  addr &= static_cast<std::uint32_t>((e.size >> 3) - 1);
  if (rd && e.bits == 3 + ab) {
    std::memset(e.out, 0, 4);
    for (int i = 0; i < 64; i++) e.out[4 + i] = (e.data[addr * 8 + (i >> 3)] >> (7 - (i & 7))) & 1;
    e.out_pos = 0; e.bits = 0;
  } else if (wr && e.bits == 3 + ab + 64) {
    for (int i = 0; i < 8; i++) {
      int b = 0;
      for (int k = 0; k < 8; k++) b = (b << 1) | e.buf[2 + ab + i * 8 + k];
      e.data[addr * 8 + i] = static_cast<std::uint8_t>(b);
    }
    e.bits = 0;
  }
}

std::uint32_t GbaMachine::read32(std::uint32_t a) {
  const std::uint32_t r = a >> 24;
  cycles_ += kWait32[r & 15];
  switch (r) {
    case 0: return a < 0x4000 ? ld32(bios_.data() + (a & ~3u)) : 0;
    case 2: return ld32(ewram_.data() + ((a & 0x3FFFF) & ~3u));
    case 3: return ld32(iwram_.data() + ((a & 0x7FFF) & ~3u));
    case 4: { const std::uint32_t o = a & 0x3FC; return (io_read(o + 2) << 16) | io_read(o); }
    case 5: return ld32(pal_.data() + ((a & 0x3FF) & ~3u));
    case 6: return ld32(vram_.data() + (vram_off(a) & ~3u));
    case 7: return ld32(oam_.data() + ((a & 0x3FF) & ~3u));
    case 8: case 9: case 10: case 11: case 12: return rom_read32(a);
    case 13: return ee_active(a) ? ee_read() * 0x10001u : rom_read32(a);
    case 14: case 15: return save_read(a) * 0x01010101u;
    default: return 0;
  }
}
std::uint32_t GbaMachine::read16(std::uint32_t a) {
  const std::uint32_t r = a >> 24;
  cycles_ += kWait16[r & 15];
  switch (r) {
    case 0: return a < 0x4000 ? ld16(bios_.data() + ((a & 0x3FFF) & ~1u)) : 0;
    case 2: return ld16(ewram_.data() + ((a & 0x3FFFF) & ~1u));
    case 3: return ld16(iwram_.data() + ((a & 0x7FFF) & ~1u));
    case 4: return io_read(a & 0x3FE);
    case 5: return ld16(pal_.data() + ((a & 0x3FF) & ~1u));
    case 6: return ld16(vram_.data() + (vram_off(a) & ~1u));
    case 7: return ld16(oam_.data() + ((a & 0x3FF) & ~1u));
    case 8: case 9: case 10: case 11: case 12: return rom_read16(a);
    case 13: return ee_active(a) ? ee_read() : rom_read16(a);
    case 14: case 15: return save_read(a) * 0x0101u;
    default: return 0;
  }
}
std::uint32_t GbaMachine::read8(std::uint32_t a) {
  const std::uint32_t r = a >> 24;
  cycles_ += kWait16[r & 15];
  switch (r) {
    case 0: return a < 0x4000 ? bios_[a] : 0;
    case 2: return ewram_[a & 0x3FFFF];
    case 3: return iwram_[a & 0x7FFF];
    case 4: return (io_read(a & 0x3FE) >> ((a & 1) << 3)) & 0xFF;
    case 5: return pal_[a & 0x3FF];
    case 6: return vram_[vram_off(a)];
    case 7: return oam_[a & 0x3FF];
    case 8: case 9: case 10: case 11: case 12: return rom_read8(a);
    case 13: return ee_active(a) ? ee_read() & 0xFF : rom_read8(a);
    case 14: case 15: return save_read(a);
    default: return 0;
  }
}

void GbaMachine::write32(std::uint32_t a, std::uint32_t v) {
  const std::uint32_t r = a >> 24;
  cycles_ += kWait32[r & 15];
  switch (r) {
    case 2: st32(ewram_.data() + ((a & 0x3FFFF) & ~3u), v); break;
    case 3: st32(iwram_.data() + ((a & 0x7FFF) & ~3u), v); break;
    case 4: { const std::uint32_t o = a & 0x3FC; io_write(o, v & 0xFFFF); io_write(o + 2, v >> 16); break; }
    case 5: st32(pal_.data() + ((a & 0x3FF) & ~3u), v); break;
    case 6: st32(vram_.data() + (vram_off(a) & ~3u), v); break;
    case 7: st32(oam_.data() + ((a & 0x3FF) & ~3u), v); break;
    case 13: if (ee_active(a)) ee_write(v); break;
    case 14: case 15: save_write(a, v & 0xFF); break;
    default: break;
  }
}
void GbaMachine::write16(std::uint32_t a, std::uint32_t v) {
  const std::uint32_t r = a >> 24;
  cycles_ += kWait16[r & 15];
  switch (r) {
    case 2: st16(ewram_.data() + ((a & 0x3FFFF) & ~1u), v); break;
    case 3: st16(iwram_.data() + ((a & 0x7FFF) & ~1u), v); break;
    case 4: io_write(a & 0x3FE, v & 0xFFFF); break;
    case 5: st16(pal_.data() + ((a & 0x3FF) & ~1u), v); break;
    case 6: st16(vram_.data() + (vram_off(a) & ~1u), v); break;
    case 7: st16(oam_.data() + ((a & 0x3FF) & ~1u), v); break;
    case 13: if (ee_active(a)) ee_write(v); break;
    case 14: case 15: save_write(a, v & 0xFF); break;
    default: break;
  }
}
void GbaMachine::write8(std::uint32_t a, std::uint32_t v) {
  const std::uint32_t r = a >> 24;
  v &= 0xFF;
  cycles_ += kWait16[r & 15];
  switch (r) {
    case 2: ewram_[a & 0x3FFFF] = static_cast<std::uint8_t>(v); break;
    case 3: iwram_[a & 0x7FFF] = static_cast<std::uint8_t>(v); break;
    case 4: io_write8(a & 0x3FF, v); break;
    case 5: st16(pal_.data() + ((a & 0x3FF) & ~1u), v * 0x0101u); break;   // byte duplicado nos dois lados
    case 6: { const std::uint32_t o = vram_off(a); if (o < 0x10000) st16(vram_.data() + (o & ~1u), v * 0x0101u); break; }
    case 13: if (ee_active(a)) ee_write(v); break;
    case 14: case 15: save_write(a, v); break;
    default: break;   // OAM: escrita de 8 bits é ignorada
  }
}

void GbaMachine::put8(std::uint32_t a, std::uint32_t v) {
  switch (a >> 24) {
    case 2: ewram_[a & 0x3FFFF] = static_cast<std::uint8_t>(v); break;
    case 3: iwram_[a & 0x7FFF] = static_cast<std::uint8_t>(v); break;
    case 5: pal_[a & 0x3FF] = static_cast<std::uint8_t>(v); break;
    case 6: vram_[vram_off(a)] = static_cast<std::uint8_t>(v); break;
    case 7: oam_[a & 0x3FF] = static_cast<std::uint8_t>(v); break;
    default: write8(a, v);
  }
}

std::uint8_t GbaMachine::peek(std::uint32_t a) {
  const std::uint32_t r = a >> 24;
  if (r != 2 && r != 3) return 0;
  const int c = cycles_;
  const std::uint8_t v = static_cast<std::uint8_t>(read8(a));
  cycles_ = c;
  return v;
}

}  // namespace emuhub
