#pragma once
#include "state_io.h"
// YM2610 (Neo Geo): porte de hub/src/cores/neogeo/ym2610.js. 4 canais FM (4 operadores), SSG, ADPCM-A (6 canais) e ADPCM-B.
// Gera uma amostra a cada 144 ciclos do clock de 8 MHz (55.555 Hz); a saída é reamostrada para o áudio do aparelho.
#include <cstddef>
#include <cstdint>
#include <vector>

namespace emuhub {

class Ym2610 {
 public:
  static constexpr std::size_t kBuf = 1 << 15;
  Ym2610();
  void reset();
  void set_rom(std::vector<std::uint8_t> rom) { rom_ = std::move(rom); }
  void set_sample_rate(unsigned sr) { host_sr_ = sr; }
  void set_volume(double v) { volume_ = v; }
  std::size_t buffered() const;
  void fill(float* out, std::size_t n);
  std::uint32_t read(int p);
  void write(int p, std::uint32_t v);
  void sample();
  bool irq() const { return k_.irq != 0; }
  void discard_audio() { rp_ = wp_; }
  void state(StateIO& s);

 private:
  void update_irq();
  void wa(int a, std::uint32_t v);
  void wb(int a, std::uint32_t v);
  void fm_reg(int port, int a, std::uint32_t v);
  void upd_inc(int c);
  int eg_rate(int o, int R) const;
  void eg_tick(int o);
  double op_out(int o, double pm) const;
  double ssg();
  void env_step();
  double adpcm_a();
  double adpcm_b();

  std::vector<std::uint8_t> rom_;
  double rate_ = 8000000.0 / 144;
  std::uint8_t r_[2][256]{};
  std::int32_t addr_[2]{};
  float abuf_[kBuf]{};
  std::uint64_t wp_ = 0, rp_ = 0;
  double pos_ = 0, last_ = 0, volume_ = 1;
  std::uint32_t host_sr_ = 44100;
  // estado do chip (zerado por reset())
  struct Chip {
    double ta, tb;
    std::int32_t ta_on, tb_on, flags, irq, eg_cnt, eg_div;
    double ph[24];
    std::int32_t att[24];
    std::uint8_t st[24];
    double dtm[24];
    std::int32_t tl[24];
    std::uint8_t ks[24], ar[24], dr[24], sr[24];
    std::int32_t sl[24];
    std::uint8_t rr[24];
    double inc[24];
    std::int32_t rate4[24], fn[6];
    std::uint8_t blk[6];
    std::int32_t fn_hi;
    std::uint8_t alg[6], fb[6];
    double fbo[12], o[24];
    double s_cnt[3];
    std::uint8_t s_out[3];
    double n_cnt;
    std::int32_t n_out, lfsr;
    double e_cnt;
    std::int32_t e_step, e_vol, e_dir, e_hold;
    std::uint8_t a_on[6];
    double a_addr[6];
    std::int32_t a_end[6], a_acc[6], a_idx[6], a_nib[6];
    double a_out[6];
    std::int32_t a_div, a_flags, b_flag;
    std::int32_t b_on, b_addr, b_end, b_acc, b_delta;
    double b_pos;
    std::int32_t b_out, b_prev, b_nib, b_cur, b_nib_left;
  } k_;
};

}  // namespace emuhub
