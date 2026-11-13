#pragma once
#include "state_io.h"
#include "snes_system.h"
#include <array>
#include <cstddef>
#include <cstdint>

namespace emuhub {

/* APU do SNES: SPC700 + DSP de 8 vozes (BRR, ADSR/GAIN, ruído, modulação de pitch, eco com FIR).
 * O IPL é emulado por código seguindo o protocolo de upload das portas 2140-2143 (nenhuma ROM da Nintendo).
 * Portado do núcleo JavaScript; usa a mesma aritmética para os resultados baterem. */
class SnesApu : public SnesApuIface {
 public:
  void state(StateIO& s) override;
  SnesApu();
  void reset() override;
  std::uint8_t read_port(int port, long cyc) override { sync(static_cast<double>(cyc), false); return out_ports_[port]; }
  void write_port(int port, std::uint8_t v, long cyc) override { sync(static_cast<double>(cyc), false); in_ports_[port] = v; port_clock_ = clock_; }
  void sync_line(long cyc) override { sync(static_cast<double>(cyc), true); }

  void set_sample_rate(unsigned sr) { step_ = 32000.0 / sr; }
  void set_volume(double v) { volume_ = v; }
  std::size_t buffered() const;
  void fill(float* out, std::size_t n);

  // acesso para testes
  std::array<std::uint8_t, 65536>& ram() { return ram_; }
  std::array<std::uint8_t, 128>& dsp() { return dsp_; }
  void dsp_write(int r, int v) { dsp_write_(r, v); }
  void start(int pc) { pc_ = pc; sp_ = 0xEF; x_ = 0; running_ = true; }
  std::uint8_t out_port(int i) const { return out_ports_[i]; }
  void set_in_port(int i, std::uint8_t v) { in_ports_[i] = v; }
  bool running() const { return running_; }
  struct Regs { int a, x, y, sp, pc, psw; };
  Regs regs() const { return {a_, x_, y_, sp_, pc_, psw()}; }

 private:
  void sync(double cyc, bool eol);
  void boot_ipl();
  void ipl_step();
  void ipl_header(int p0);
  void skip_idle();
  void step_cycles(int c);
  void step_cycles2(double c);
  std::uint8_t rd(int a);
  void wr(int a, int v);
  void dsp_write_(int r, int v);
  int psw() const { return (n_ << 7) | (v_ << 6) | (p_ << 5) | (h_ << 3) | (i_ << 2) | (z_ << 1) | c_; }
  void set_psw(int v) { n_ = (v >> 7) & 1; v_ = (v >> 6) & 1; p_ = (v >> 5) & 1; h_ = (v >> 3) & 1; i_ = (v >> 2) & 1; z_ = (v >> 1) & 1; c_ = v & 1; }
  int f8();
  int f16();
  int dpa(int o) const { return (p_ ? 0x100 : 0) | (o & 0xFF); }
  void push(int v);
  int pop();
  void nz(int v) { n_ = (v >> 7) & 1; z_ = (v & 0xFF) == 0 ? 1 : 0; }
  int alu(int k, int a, int b);
  int bra(bool cond);
  int shl(int v, int k);
  int exec();
  void decode_block(int v);
  void advance_sample(int v);
  int loop_addr(int v) const;
  bool rate_hit(int rate) const;
  void dsp_sample();

  std::array<std::uint8_t, 65536> ram_{};
  std::uint8_t in_ports_[4] = {}, out_ports_[4] = {};
  std::array<std::uint8_t, 128> dsp_{};
  int timer_target_[3] = {}, timer_stage_[3] = {}, timer_out_[3] = {};
  double timer_cyc_[3] = {};
  int v_addr_[8] = {}, v_idx_[8] = {}, v_frac_[8] = {}, v_env_[8] = {}, v_mode_[8] = {};
  int v_hist_[32] = {}, v_blk_[128] = {}, v_p1_[8] = {}, v_p2_[8] = {}, v_out_[8] = {};
  int echo_hist_[16] = {}, echo_pos_ = 0, echo_idx_ = 0;
  std::array<float, 65536> sample_buf_{};
  double wp_ = 0, rpf_ = 0, step_ = 32000.0 / 44100.0, volume_ = 1.0, last_ = 0;
  int a_ = 0, x_ = 0, y_ = 0, sp_ = 0xEF, pc_ = 0, n_ = 0, v_ = 0, p_ = 0, h_ = 0, i_ = 0, z_ = 0, c_ = 0;
  int control_ = 0x80, dsp_addr_ = 0;
  bool running_ = false, clock_init_ = false;
  double owed_ = 0, last_cyc_ = 0, dsp_cyc_ = 0, clock_ = 0, port_clock_ = 0;
  int ipl_mode_ = 0, ipl_counter_ = 0, ipl_dest_ = 0, ipl_last_ = -1;
  int noise_ = 0x4000, sample_count_ = 0, kon_ = 0, koff_ = 0, endx_ = 0;
};

}  // namespace emuhub
