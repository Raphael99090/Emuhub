#include "nes_cartridge.h"
#include <algorithm>

namespace emuhub {
namespace {
constexpr std::size_t kHeaderSize = 16;
constexpr std::size_t kTrainerSize = 512;
constexpr std::size_t kPrgBankSize = 16 * 1024;
constexpr std::size_t kChrBankSize = 8 * 1024;
constexpr std::size_t kMaxRomSize = 64u * 1024u * 1024u;
}

CartridgeError NesCartridge::load(const std::uint8_t* data, std::size_t size) {
  reset();
  if (!data || size < kHeaderSize || size > kMaxRomSize)
    return CartridgeError::InvalidArgument;
  if (data[0] != 'N' || data[1] != 'E' || data[2] != 'S' || data[3] != 0x1a)
    return CartridgeError::InvalidHeader;

  const std::uint8_t flags6 = data[6], flags7 = data[7];
  // NES 2.0 has a different size/mapper encoding; do not silently parse it as iNES 1.0.
  if ((flags7 & 0x0c) == 0x08) return CartridgeError::UnsupportedFormat;
  // Legacy iNES headers commonly contain garbage in bytes 12..15.
  const std::uint8_t mapper = static_cast<std::uint8_t>((flags7 & 0xf0) | (flags6 >> 4));
  const std::uint8_t prg_banks = data[4], chr_banks = data[5];
  if (prg_banks == 0) return CartridgeError::InvalidPrgSize;
  if (mapper != 0 && mapper != 2) return CartridgeError::UnsupportedMapper;
  if (mapper == 0 && prg_banks > 2) return CartridgeError::InvalidMapperLayout;
  if (mapper == 2 && prg_banks < 2) return CartridgeError::InvalidMapperLayout;

  const bool trainer = (flags6 & 0x04) != 0;
  const std::size_t prg_bytes = static_cast<std::size_t>(prg_banks) * kPrgBankSize;
  const std::size_t chr_bytes = static_cast<std::size_t>(chr_banks) * kChrBankSize;
  const std::size_t offset = kHeaderSize + (trainer ? kTrainerSize : 0);
  if (prg_bytes > size - offset || chr_bytes > size - offset - prg_bytes)
    return CartridgeError::TruncatedRom;

  mapper_ = mapper;
  mirroring_ = (flags6 & 0x08) ? 2 : ((flags6 & 1) ? 1 : 0);
  battery_ = (flags6 & 0x02) != 0;
  trainer_present_ = trainer;
  prg_.assign(data + offset, data + offset + prg_bytes);
  if (chr_banks == 0) {
    chr_.assign(kChrBankSize, 0);
    chr_is_ram_ = true;
  } else {
    chr_.assign(data + offset + prg_bytes, data + offset + prg_bytes + chr_bytes);
    chr_is_ram_ = false;
  }
  prg_ram_.assign(8 * 1024, 0);
  loaded_ = true;
  uxrom_bank_ = 0;
  return CartridgeError::Ok;
}

void NesCartridge::reset() {
  loaded_ = false;
  mapper_ = 0;
  mirroring_ = 0;
  battery_ = false;
  trainer_present_ = false;
  chr_is_ram_ = false;
  prg_.clear();
  chr_.clear();
  prg_ram_.clear();
  uxrom_bank_ = 0;
}

std::uint8_t NesCartridge::cpu_read(std::uint16_t address) const {
  if (!loaded_) return 0;
  if (address >= 0x6000 && address < 0x8000)
    return prg_ram_[address - 0x6000];
  if (address < 0x8000) return 0;

  std::size_t offset = 0;
  if (mapper_ == 2) {
    const std::size_t bank = address < 0xc000
      ? (static_cast<std::size_t>(uxrom_bank_) % (prg_.size() / kPrgBankSize))
      : (prg_.size() / kPrgBankSize - 1);
    offset = bank * kPrgBankSize + (address & 0x3fff);
  } else {
    offset = (address - 0x8000) % prg_.size();
  }
  return prg_[offset];
}

void NesCartridge::cpu_write(std::uint16_t address, std::uint8_t value) {
  if (!loaded_) return;
  if (address >= 0x6000 && address < 0x8000) {
    prg_ram_[address - 0x6000] = value;
    return;
  }
  if (mapper_ == 2 && address >= 0x8000)
    uxrom_bank_ = value;
}

std::uint8_t NesCartridge::ppu_read(std::uint16_t address) const {
  if (!loaded_ || address >= 0x2000) return 0;
  return chr_[address];
}

void NesCartridge::ppu_write(std::uint16_t address, std::uint8_t value) {
  if (loaded_ && chr_is_ram_ && address < 0x2000)
    chr_[address] = value;
}
} // namespace emuhub
