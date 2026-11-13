#pragma once
#include "state_io.h"
#include "nes_cartridge.h"
#include <array>
#include <cstdint>

namespace emuhub {
class NesPpu {
 public:
  void state(StateIO& s);
  static constexpr unsigned kWidth=256,kHeight=240,kPixels=kWidth*kHeight;
  explicit NesPpu(NesCartridge& cartridge);
  void reset();
  std::uint8_t read_register(std::uint16_t reg);
  void write_register(std::uint16_t reg,std::uint8_t value);
  void dma_write(std::uint8_t value);
  std::uint8_t read_memory(std::uint16_t address) const;
  void write_memory(std::uint16_t address,std::uint8_t value);
  void advance(unsigned dots);
  bool frame_done() const { return frame_done_; }
  void begin_frame() { frame_done_=false; }
  bool take_nmi() { const bool n=nmi_pending_; nmi_pending_=false; return n; }
  void set_no_limit(bool value) { no_limit_=value; }
  using ExtraFn=void(*)(void*,unsigned);
  void set_extra(ExtraFn fn,void* ctx) { extra_fn_=fn; extra_ctx_=ctx; }
  void set_extra_lines(unsigned pre,unsigned post) { x_pre_=pre; x_post_=post; }
  const std::array<std::uint32_t,kPixels>& framebuffer() const { return frame_; }
  const std::array<std::uint8_t,256>& oam() const { return oam_; }
 private:
  NesCartridge& cartridge_;
  std::array<std::uint32_t,kPixels> frame_{};
  std::array<std::uint8_t,4096> vram_{};
  std::array<std::uint8_t,32> palette_{};
  std::array<std::uint8_t,256> oam_{},bg_{},sp_{},sp_behind_{},sp0_{};
  std::uint8_t ctrl_=0,mask_=0,status_=0,oam_addr_=0,fine_x_=0,w_=0,buffer_=0,open_bus_=0;
  std::uint16_t v_=0,t_=0;
  unsigned dot_=0,scanline_=261;
  bool odd_=false,frame_done_=false,nmi_pending_=false,no_limit_=false;
  int hit_dot_=-1;
  ExtraFn extra_fn_=nullptr; void* extra_ctx_=nullptr; unsigned x_pre_=0,x_post_=0; bool in_extra_=false;
  void run_extra(unsigned lines) { if(!extra_fn_||in_extra_) return; in_extra_=true; extra_fn_(extra_ctx_,lines); in_extra_=false; }
  std::size_t nt_index(std::uint16_t address) const;
  void increment_y();
  void copy_x();
  void copy_y();
  void tick();
  void render_line(unsigned y);
};
} // namespace emuhub
