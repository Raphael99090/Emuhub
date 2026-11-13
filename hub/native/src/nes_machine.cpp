#include "nes_machine.h"

namespace emuhub {
NesMachine::NesMachine():ppu_(cartridge_),bus_(cartridge_),cpu_(bus_.cpu_bus()){bus_.connect_ppu(&ppu_);bus_.connect_apu(&apu_);apu_.set_sample_rate(48000);}
CartridgeError NesMachine::load_rom(const std::uint8_t* data,std::size_t size){
  const auto result=cartridge_.load(data,size);
  if(result==CartridgeError::Ok){bus_.reset();ppu_.reset();apu_.reset();cpu_.reset();}
  return result;
}
void NesMachine::reset(){if(!loaded())return;cartridge_.reset_mapper();ppu_.reset();apu_.reset();bus_.reset();cpu_.reset();}
void NesMachine::destroy(){cartridge_.reset();ppu_.reset();apu_.reset();bus_.reset();cpu_.set_state(Cpu6502::State{});}
unsigned NesMachine::step_instruction(){
  if(!loaded())return 0;
  if(ppu_.take_nmi())cpu_.request_nmi();
  cpu_.set_irq(bus_.irq_line());
  const unsigned used=cpu_.step();
  const unsigned total=used+bus_.take_dma_stall();
  apu_.run(total);
  ppu_.advance(total*3);
  return total;
}
bool NesMachine::run_frame(){
  if(!loaded())return false;
  ppu_.begin_frame();
  while(!ppu_.frame_done())step_instruction();
  return true;
}

void NesMachine::state(StateIO& s) { cartridge_.state(s); ppu_.state(s); apu_.state(s); bus_.state(s); cpu_.state(s); }

} // namespace emuhub
