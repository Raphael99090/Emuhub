#pragma once
#include "cpu6502.h"
#include "nes_bus.h"
#include "nes_ppu.h"
#include "nes_cartridge.h"
#include <cstddef>
#include <cstdint>

namespace emuhub {
class NesMachine {
 public:
  NesMachine();
  CartridgeError load_rom(const std::uint8_t* data,std::size_t size);
  void reset();
  void destroy();
  void set_buttons(std::uint16_t mask) { bus_.set_buttons(mask); }
  unsigned step_instruction();
  bool run_frame();
  const NesPpu& ppu() const { return ppu_; }
  NesPpu& ppu() { return ppu_; }
  bool loaded() const { return cartridge_.loaded(); }
  const NesCartridge& cartridge() const { return cartridge_; }
  NesCartridge& cartridge() { return cartridge_; }
  const Cpu6502::State& cpu_state() const { return cpu_.state(); }
  std::uint8_t cpu_read(std::uint16_t address) { return bus_.read(address); }
  void cpu_write(std::uint16_t address,std::uint8_t value) { bus_.write(address,value); }
 private:
  NesCartridge cartridge_;
  NesPpu ppu_;
  NesBus bus_;
  Cpu6502 cpu_;
};
} // namespace emuhub
