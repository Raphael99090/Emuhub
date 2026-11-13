#pragma once
#include "state_io.h"
#include "snes_system.h"
#include <array>
#include <cstdint>

namespace emuhub {

/* PPU do SNES (S-PPU1/2), portada do núcleo JavaScript: modos 0-4 e 7, alta resolução (5/6) e
 * entrelaçamento, sprites com limites reais, janelas, mosaico e matemática de cores. */
class SnesPpu : public SnesPpuIface {
 public:
  void state(StateIO& s) override;
  SnesPpu();
  void set_host(SnesPpuHost* h) override { host_ = h; }
  void reset() override;
  std::uint8_t read_reg(std::uint32_t r) override;
  void write_reg(std::uint32_t r, std::uint8_t v) override;
  void render_line(int y) override;
  void begin_frame() override { range_over_ = 0; time_over_ = 0; }
  void finish_frame() override;
  int setini() const override { return setini_; }

  void set_skip(bool s) { skip_ = s; }
  void set_no_limit(bool n) { no_limit_ = n; }
  const std::uint32_t* frame() const { return frame_; }
  int width() const { return out_w_; }
  int height() const { return out_h_; }

 private:
  static constexpr int kStride = 512;
  SnesPpuHost* host_ = nullptr;
  std::array<std::uint32_t, 512 * 478> fb_{};
  std::array<std::uint32_t, 256 * 478> fb256_{};
  std::array<std::uint8_t, 478> line_hires_{};
  const std::uint32_t* frame_ = nullptr;
  int out_w_ = 256, out_h_ = 224;
  std::array<std::uint8_t, 65536> vram_{};
  std::array<std::uint8_t, 544> oam_{};
  std::array<std::uint16_t, 256> cgram_{};
  std::uint8_t bgcol_[4][272], bgpri_[4][272], bgcol_s_[4][272], bgpri_s_[4][272];
  std::uint8_t chr_px_[8];
  std::uint8_t objcol_[272], objpri_[272], objmath_[272];
  std::uint8_t masks_[12][256];
  // registradores
  int inidisp_ = 0x80, obsel_ = 0, oam_addr_ = 0, oam_int_ = 0, oam_latch_ = 0, bgmode_ = 0, mosaic_ = 0;
  int bgsc_[4] = {}, bgnba_[4] = {}, hofs_[4] = {}, vofs_[4] = {}, bg_latch_ = 0, m7_latch_ = 0;
  int vmain_ = 0, vmaddr_ = 0, vprefetch_ = 0, cgadd_ = 0, cg_latch_ = 0, cg_flip_ = 0;
  int m7sel_ = 0, m7_[4] = {}, m7x_ = 0, m7y_ = 0, m7hofs_ = 0, m7vofs_ = 0, mpy_ = 0;
  int wsel_[3] = {}, wh_[4] = {}, wlog_[2] = {};
  int tm_ = 0, ts_ = 0, tmw_ = 0, tsw_ = 0, cgwsel_ = 0, cgadsub_ = 0, fix_r_ = 0, fix_g_ = 0, fix_b_ = 0, setini_ = 0;
  int range_over_ = 0, time_over_ = 0, field_ = 0;
  bool no_limit_ = false, skip_ = false;
  int h_latch_ = 0, v_latch_ = 0, latch_flag_ = 0, h_sel_ = 0, v_sel_ = 0;

  int vram_addr() const;
  void vram_inc();
  int vram_word() const;
  static int sx13(int v) { return static_cast<std::int32_t>(static_cast<std::uint32_t>(v & 0x1FFF) << 19) >> 19; }
  int bg3_entry(int c, int r) const;
  void render_bg(int n, int y, int bpp, int pal_base, std::uint8_t* col, std::uint8_t* pri);
  void decode_chr(int ch, int f, int bpp, int chr_base, bool hf, std::uint8_t* out) const;
  void render_bg_hires(int n, int y, int bpp, std::uint8_t* col, std::uint8_t* pri, std::uint8_t* col_s, std::uint8_t* pri_s);
  void render_mode7(int y, std::uint8_t* col, std::uint8_t* pri);
  void render_objs(int y);
  void window_mask(int layer, std::uint8_t* out) const;
  int pick(int x, int en, int enw, const int* order, int order_n, std::uint8_t (*colors)[272], std::uint8_t (*pris)[272]) const;
};

}  // namespace emuhub
