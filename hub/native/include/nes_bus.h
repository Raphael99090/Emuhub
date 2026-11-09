#pragma once
#include "nes_cartridge.h"
#include "cpu6502.h"
#include <array>
#include <cstdint>

namespace emuhub {
class NesBus {
 public:
  explicit NesBus(NesCartridge& cartridge);
  void reset();
  std::uint8_t read(std::uint16_t address);
  void write(std::uint16_t address,std::uint8_t value);
  void set_buttons(std::uint16_t mask) { buttons_=static_cast<std::uint8_t>(mask&0xff); }
  bool irq_line() const { return cartridge_.irq_pending(); }
  unsigned take_dma_stall() { const auto n=dma_stall_; dma_stall_=0; return n; }
  const std::array<std::uint8_t,2048>& ram() const { return ram_; }
  const std::array<std::uint8_t,256>& oam() const { return oam_; }
  static std::uint8_t read_callback(void* context,std::uint16_t address);
  static void write_callback(void* context,std::uint16_t address,std::uint8_t value);
  Cpu6502::Bus cpu_bus() { return {this,read_callback,write_callback}; }
 private:
  NesCartridge& cartridge_;
  std::array<std::uint8_t,2048> ram_{};
  std::array<std::uint8_t,8> ppu_registers_{};
  std::array<std::uint8_t,24> apu_registers_{};
  std::array<std::uint8_t,256> oam_{};
  std::uint8_t buttons_=0,controller_shift_=0,strobe_=0,open_bus_=0;
  unsigned dma_stall_=0;
};
} // namespace emuhub
