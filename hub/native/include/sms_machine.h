#pragma once
#include "state_io.h"
// Master System / Game Gear em C++17: porte do núcleo JavaScript (hub/src/cores/sms: z80, vdp, psg, sms, core).
// Z80 + VDP (modo 4) + PSG SN76489, mapeadores Sega e Codemasters, RAM de 8 KB e RAM de cartucho de 32 KB.
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace emuhub {

enum class SmsError { Ok = 0, TooSmall = 1 };

class SmsMachine {
 public:
  static constexpr unsigned kSmsWidth = 256, kSmsHeight = 192;
  static constexpr unsigned kGgWidth = 160, kGgHeight = 144;
  static constexpr unsigned kFrameLines = 262, kCycLine = 228;
  static constexpr unsigned kAudioSize = 32768;

  explicit SmsMachine(bool gg = false);

  /* Aceita ROM com cabeçalho de 512 bytes. Devolve TooSmall abaixo de 8 KB. Faz reset(). */
  SmsError load_rom(const std::uint8_t* data, std::size_t size);
  void reset();
  /* bits do hub: A=1 (botão 1) B=2 (botão 2) SEL=4 START=8 (Pause no SMS) UP=16 DOWN=32 LEFT=64 RIGHT=128 */
  void set_buttons(std::uint16_t mask);
  bool run_frame();
  bool loaded() const { return loaded_; }

  bool gg() const { return gg_; }
  unsigned width() const { return gg_ ? kGgWidth : kSmsWidth; }
  unsigned height() const { return gg_ ? kGgHeight : kSmsHeight; }
  /* width()*height() pixels no mesmo formato do JS (0xFFBBGGRR) */
  const std::vector<std::uint32_t>& framebuffer() const { return out_; }

  // áudio mono (float), entregue ao frontend
  void set_audio_rate(unsigned rate);
  void set_audio_volume(float v) { volume_ = v; }
  std::size_t audio_buffered() const { return static_cast<std::size_t>(p_.wp - p_.rp); }
  void fill_audio(float* out, std::size_t n);

  /* RAM do cartucho (32 KB). Só vale a pena gravar se has_battery(): "nunca usou RAM de cartucho" = nada a gravar. */
  std::uint8_t* sram_data() { return cart_ram_.data(); }
  std::size_t sram_size() const { return ram_dirty_ ? cart_ram_.size() : 0; }
  bool has_battery() const { return ram_dirty_; }
  void sram_restore(const std::uint8_t* data, std::size_t n);

  /* Cheats de RAM (C000-FFFF), aplicados no fim de cada quadro. */
  struct RamCheat { std::uint16_t addr; std::uint8_t val; };
  void set_ram_cheats(const std::vector<RamCheat>& c) { cheats_ = c; }

  struct Header { bool found; int region; unsigned product; bool is_gg; };
  const Header& header() const { return header_; }
  bool codemasters() const { return mapper_ == 1; }
  std::size_t rom_size() const { return rom_.size(); }
  std::uint32_t rom_hash() const { return rom_hash_; }

  void state(StateIO& s);

  // acesso de depuração/teste
  std::uint8_t read(std::uint16_t a) const;
  void write(std::uint16_t a, std::uint8_t v);
  struct Regs { std::uint8_t a, b, c, d, e, h, l, f; std::uint16_t ix, iy, sp, pc; };
  Regs regs() const;
  std::uint8_t peek(std::uint16_t a) const { return a >= 0xC000 ? ram_[a & 0x1FFF] : 0; }

 private:
  struct Z80Regs {
    std::uint8_t R[8], R2[8];   // B C D E H L (livre) A / sombra
    std::uint8_t f, f2;
    std::uint16_t ix, iy, sp, pc;
    std::uint8_t i, r, iff1, iff2, im, halted, ei_wait, nmi, irq_line, idx;
  };
  struct Vdp {
    std::uint8_t vram[0x4000], cram[64], regs[16];
    std::uint32_t pal[32];
    std::uint16_t addr;
    std::uint8_t code, latch, low, buf, vint, line_irq, ovf, col;
    std::int32_t line, line_cnt;
  };
  struct Psg {
    std::int32_t freq[3], cnt[3], out[3], att[4];
    std::int32_t noise_ctl, noise_cnt, noise_flip, lfsr, noise_out, latch_ch, latch_type, clk, n;
    double acc, cyc, px, py, last;
    std::uint64_t rp, wp;
  };

  // Z80
  void z80_reset();
  int z80_step();
  int z80_exec(int op);
  int z80_cb();
  int z80_ed();
  int z80_block(int y, int z);
  std::uint16_t rd16(std::uint16_t a) const;
  void wr16(std::uint16_t a, std::uint16_t v);
  void push16(std::uint16_t v);
  std::uint16_t pop16();
  std::uint8_t fetch();
  std::uint16_t fetch16();
  void inc_r() { c_.r = static_cast<std::uint8_t>((c_.r & 0x80) | ((c_.r + 1) & 0x7F)); }
  std::uint16_t bc() const { return static_cast<std::uint16_t>((c_.R[0] << 8) | c_.R[1]); }
  std::uint16_t de() const { return static_cast<std::uint16_t>((c_.R[2] << 8) | c_.R[3]); }
  std::uint16_t hl() const { return static_cast<std::uint16_t>((c_.R[4] << 8) | c_.R[5]); }
  std::uint16_t af() const { return static_cast<std::uint16_t>((c_.R[7] << 8) | c_.f); }
  void set_bc(int v) { c_.R[0] = static_cast<std::uint8_t>(v >> 8); c_.R[1] = static_cast<std::uint8_t>(v); }
  void set_de(int v) { c_.R[2] = static_cast<std::uint8_t>(v >> 8); c_.R[3] = static_cast<std::uint8_t>(v); }
  void set_hl(int v) { c_.R[4] = static_cast<std::uint8_t>(v >> 8); c_.R[5] = static_cast<std::uint8_t>(v); }
  void set_af(int v) { c_.R[7] = static_cast<std::uint8_t>(v >> 8); c_.f = static_cast<std::uint8_t>(v); }
  std::uint16_t get_hl() const { return c_.idx == 0 ? hl() : c_.idx == 1 ? c_.ix : c_.iy; }
  void set_hl_idx(int v);
  std::uint16_t rp(int p) const;
  void set_rp(int p, int v);
  std::uint16_t rp2(int p) const;
  void set_rp2(int p, int v);
  std::uint8_t get8(int z) const;
  void set8(int z, int v);
  void alu(int op, int v);
  std::uint8_t inc8(int v);
  std::uint8_t dec8(int v);
  std::uint16_t add16(int a, int b);
  void adc16(int b);
  void sbc16(int b);
  void daa();
  std::uint8_t rot(int y, int v);
  bool cond(int y) const;

  // memória e portas
  std::uint8_t port_in(int p);
  void port_out(int p, int v);
  int page_of(int n) const { return n % static_cast<int>(pages_); }

  // VDP
  void vdp_reset();
  void vdp_update_irq();
  void vdp_set_pal(int i);
  std::uint8_t vdp_read_data();
  void vdp_write_data(int v);
  std::uint8_t vdp_read_status();
  void vdp_write_ctrl(int v);
  int vdp_vcounter() const;
  int vdp_hcounter() const;
  void vdp_start_line(int line);
  void vdp_render_line(int line);

  // PSG
  void psg_reset();
  void psg_write(int v);
  void psg_tick(int c);
  void psg_step();
  void psg_push(double s);

  bool has_sega_header() const;

  bool gg_;
  bool loaded_ = false;
  Z80Regs c_{};
  Vdp v_{};
  Psg p_{};
  double cps_ = 3579545.0 / 44100.0;   // ciclos do PSG por amostra
  double volume_ = 1.0;
  std::array<float, kAudioSize> abuf_{};
  std::array<std::uint32_t, kSmsWidth * kSmsHeight> frame_{};
  std::vector<std::uint32_t> out_;
  std::array<std::uint8_t, 0x2000> ram_{};
  std::array<std::uint8_t, 0x8000> cart_ram_{};
  std::vector<std::uint8_t> rom_;
  std::uint32_t pages_ = 1;
  std::uint8_t mapper_ = 0;            // 0 = Sega, 1 = Codemasters
  std::int32_t bank_[3] = {0, 1, 2};
  std::uint8_t ram_ctl_ = 0, ram_dirty_ = 0, io_ctl_ = 0xFF, mem_ctl_ = 0, nmi_prev_ = 0;
  std::uint16_t buttons_ = 0;
  std::int32_t cyc_ = 0, debt_ = 0;
  std::uint32_t rom_hash_ = 0;
  Header header_{};
  std::vector<RamCheat> cheats_;
};

}  // namespace emuhub
