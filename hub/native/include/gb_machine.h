#pragma once
// Game Boy / Game Boy Color em C++17: porte do núcleo JavaScript (hub/src/cores/gb).
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace emuhub {

enum class GbError { Ok = 0, TooSmall = 1, Unsupported = 2 };

class GbMachine {
 public:
  static constexpr unsigned kWidth = 160, kHeight = 144, kPixels = kWidth * kHeight;
  static constexpr unsigned kFrameCycles = 70224, kAudioSize = 32768;

  GbMachine();
  GbError load_rom(const std::uint8_t* data, std::size_t size, bool force_dmg = false);
  void reset();
  void set_buttons(std::uint16_t mask);      // bits do hub: A=1 B=2 SEL=4 START=8 DIR=16..128
  bool run_frame();
  const std::array<std::uint32_t, kPixels>& framebuffer() const { return frame_; }
  bool loaded() const { return loaded_; }
  bool cgb() const { return cgb_; }

  // áudio mono (float), entregue ao frontend
  void set_audio_rate(unsigned rate);
  void set_audio_volume(float v) { volume_ = v; }
  std::size_t audio_buffered() const { return wp_ - rp_; }
  void fill_audio(float* out, std::size_t n);

  // acesso de depuração/teste
  std::uint8_t read(std::uint16_t a);
  void write(std::uint16_t a, std::uint8_t v);
  struct Regs { std::uint8_t a, b, c, d, e, h, l; std::uint16_t sp, pc; bool z, n, hc, cy; };
  Regs regs() const;

 private:
  // ---- CPU ----
  struct Cpu {
    std::uint8_t a = 0, b = 0, c = 0, d = 0, e = 0, h = 0, l = 0;
    std::uint8_t z = 0, n = 0, hc = 0, cy = 0;
    std::uint16_t sp = 0, pc = 0;
    std::uint8_t ime = 0, ime_next = 0; bool halted = false, halt_bug = false;
  } cpu_;
  std::uint8_t fetch();
  std::uint16_t fetch16();
  void push(std::uint16_t v);
  std::uint16_t pop();
  std::uint8_t get_r(int i);
  void set_r(int i, std::uint8_t v);
  std::uint16_t get_rr(int i) const;
  void set_rr(int i, std::uint16_t v);
  bool cond(int i) const;
  void alu(int k, std::uint8_t v);
  std::uint8_t inc8(std::uint8_t v);
  std::uint8_t dec8(std::uint8_t v);
  void add_hl(std::uint16_t v);
  std::uint16_t sp_off(int e);
  void daa();
  int cb_op();
  int cpu_step();
  std::uint8_t f() const { return (cpu_.z << 7) | (cpu_.n << 6) | (cpu_.hc << 5) | (cpu_.cy << 4); }
  void set_f(std::uint8_t v) { cpu_.z = (v >> 7) & 1; cpu_.n = (v >> 6) & 1; cpu_.hc = (v >> 5) & 1; cpu_.cy = (v >> 4) & 1; }

  // ---- cartucho / barramento ----
  struct Cart { int type = 0, mbc = 0, ram_banks = 1, rom_banks = 2; bool battery = false, rtc = false; } cart_;
  std::vector<std::uint8_t> rom_, ram_;
  std::uint32_t rom_mask_ = 0x7FFF, ram_mask_ = 0, rom_off0_ = 0, rom_off1_ = 0x4000, ram_off_ = 0;
  bool ram_en_ = false; int rom_bank_ = 1, ram_bank_ = 0, mode_ = 0, upper_ = 0, rtc_sel_ = 0;
  struct Rtc { std::uint8_t latched[5] = {0, 0, 0, 0, 0}; std::int64_t base = 0, halt_at = 0; bool halt = false; int latch = 0; } rtc_;
  std::array<std::uint8_t, 0x8000> wram_{};
  std::array<std::uint8_t, 0x80> hram_{}, io_{};
  bool cgb_ = false, double_speed_ = false, speed_armed_ = false, loaded_ = false;
  int wbank_ = 1; std::uint8_t ifl_ = 0, ie_ = 0, joy_sel_ = 0x30; std::uint8_t buttons_ = 0;
  std::uint32_t divc_ = 0; std::uint8_t tima_ = 0, tma_ = 0, tac_ = 0, sb_ = 0, sc_ = 0;
  struct Hdma { std::uint16_t src = 0, dst = 0; int len = 0; bool active = false; } hdma_;
  int extra_ = 0;
  void update_banks();
  void mbc_write(std::uint16_t a, std::uint8_t v);
  std::int64_t now() const;
  void rtc_now(std::uint8_t out[5]) const;
  void rtc_write(int sel, std::uint8_t v);
  std::uint8_t read_ram(std::uint16_t a);
  std::uint8_t read_io(std::uint16_t a);
  void write_io(std::uint16_t a, std::uint8_t v);
  void hdma_write(std::uint8_t v);
  void hdma_block();
  void hdma_step();
  void timer_tick(int c);

  // ---- PPU ----
  std::array<std::uint32_t, kPixels> frame_{};
  std::array<std::uint8_t, 0x4000> vram_{};
  std::array<std::uint8_t, 0xA0> oam_{};
  std::array<std::uint8_t, 64> bg_pal_{}, ob_pal_{};
  std::array<std::uint32_t, 32> bg_col_{}, ob_col_{};
  std::uint8_t line_idx_[160], line_pri_[160];
  std::uint8_t lcdc_ = 0x91, stat_ = 0, scy_ = 0, scx_ = 0, ly_ = 0, lyc_ = 0, bgp_ = 0xFC, obp0_ = 0xFF, obp1_ = 0xFF, wy_ = 0, wx_ = 0, bcps_ = 0, ocps_ = 0, vbk_ = 0;
  int mode_ppu_ = 2, cyc_ = 0, win_line_ = 0; bool stat_line_ = false, frame_done_ = false, lyc_flag_ = false;
  std::uint8_t ppu_read(std::uint16_t a) const;
  void ppu_write(std::uint16_t a, std::uint8_t v);
  void pal_write(std::array<std::uint8_t, 64>& pal, std::array<std::uint32_t, 32>& col, int i, std::uint8_t v);
  void check_lyc() { lyc_flag_ = ly_ == lyc_; }
  void update_stat();
  void ppu_tick(int c);
  void render_line();
  void bg_pixel(int x, int px, int py, int map_base, bool signed_, std::uint32_t* out);
  void render_sprites(int ly, std::uint32_t* out);

  // ---- APU ----
  struct Chan {
    bool on = false, dac = false, len_en = false; int len = 0, vol = 0, init_vol = 0, env_dir = 0, env_per = 0, env_t = 0, timer = 0;
    int duty = 0, freq = 0, seq = 0, pos = 0, code = 0, sample = 0, shift = 0, div = 0; bool width7 = false; std::uint32_t lfsr = 0x7FFF;
    void clock_len() { if (len_en && len > 0) { if (--len == 0) on = false; } }
    void clock_env() { if (env_per == 0) return; if (--env_t <= 0) { env_t = env_per; if (env_dir && vol < 15) vol++; else if (!env_dir && vol > 0) vol--; } }
    void set_env(int v) { init_vol = v >> 4; env_dir = (v >> 3) & 1; env_per = v & 7; dac = (v & 0xF8) != 0; if (!dac) on = false; }
    void trig_env() { vol = init_vol; env_t = env_per ? env_per : 8; }
  } p1_, p2_, wv_, nz_;
  std::array<std::uint8_t, 0x30> aregs_{}; std::array<std::uint8_t, 16> wave_ram_{};
  int sweep_per_ = 0, sweep_shift_ = 0, sweep_t_ = 0, shadow_ = 0, fs_ = 0, fs_t_ = 0; bool sweep_neg_ = false, sweep_en_ = false, neg_used_ = false;
  std::uint8_t nr50_ = 0, nr51_ = 0; bool power_ = true; double acc_ = 0, cps_ = 4194304.0 / 48000.0;
  std::vector<float> abuf_ = std::vector<float>(kAudioSize); std::size_t rp_ = 0, wp_ = 0; float last_ = 0, volume_ = 1; double px_ = 0, py_ = 0; unsigned rate_ = 48000;
  std::uint8_t apu_read(std::uint16_t a) const;
  void apu_write(std::uint16_t a, std::uint8_t v);
  void apu_reg(std::uint16_t a, std::uint8_t v, bool force);
  void len_enable(Chan& ch, std::uint8_t v);
  void trig_len(Chan& ch, int max);
  void trig_pulse(Chan& p, bool sw);
  bool sweep_calc(bool apply);
  void frame_seq();
  double chan_out() const;
  void apu_tick(int c);
  void apu_push(double s);
  void apu_reset();
  void ppu_reset();
};

}  // namespace emuhub
