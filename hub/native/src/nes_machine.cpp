#include "nes_machine.h"

namespace emuhub {
NesMachine::NesMachine():bus_(cartridge_),cpu_(bus_.cpu_bus()){}
CartridgeError NesMachine::load_rom(const std::uint8_t* data,std::size_t size){
  const auto result=cartridge_.load(data,size);
  if(result==CartridgeError::Ok){bus_.reset();cpu_.reset();}
  return result;
}
void NesMachine::reset(){if(!loaded())return;cartridge_.reset_mapper();bus_.reset();cpu_.reset();}
void NesMachine::destroy(){cartridge_.reset();bus_.reset();cpu_.set_state(Cpu6502::State{});}
unsigned NesMachine::step_instruction(){
  if(!loaded())return 0;
  cpu_.set_irq(bus_.irq_line());
  const unsigned used=cpu_.step();
  return used+bus_.take_dma_stall();
}
} // namespace emuhub
