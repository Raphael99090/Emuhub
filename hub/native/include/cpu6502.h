#pragma once
#include "state_io.h"
#include <cstdint>

namespace emuhub {
class Cpu6502 {
 public:
  void state(StateIO& s);
  using Read = std::uint8_t (*)(void*, std::uint16_t);
  using Write = void (*)(void*, std::uint16_t, std::uint8_t);
  struct Bus { void* context = nullptr; Read read = nullptr; Write write = nullptr; };
  struct State { std::uint16_t pc=0; std::uint8_t a=0,x=0,y=0,sp=0xfd,p=0x24; std::uint64_t cycles=0; };
  explicit Cpu6502(Bus bus);
  void reset();
  unsigned step();
  void request_nmi();
  void set_irq(bool level);
  const State& state() const { return state_; }
  void set_state(const State& s) { state_=s; }
 private:
  Bus bus_; State state_{}; bool nmi_=false, irq_=false;
  std::uint8_t read(std::uint16_t a) const;
  void write(std::uint16_t a,std::uint8_t v) const;
  std::uint8_t fetch();
  std::uint16_t fetch16();
  void push(std::uint8_t v); std::uint8_t pull();
  void push16(std::uint16_t v); std::uint16_t pull16();
  void set_zn(std::uint8_t v); void adc(std::uint8_t v); void compare(std::uint8_t r,std::uint8_t v);
  void interrupt(std::uint16_t vector,bool brk);
};
} // namespace emuhub
