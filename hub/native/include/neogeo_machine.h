#pragma once
#include "m68k.h"
#include "state_io.h"
#include "ym2610.h"
#include "z80_cpu.h"
// Neo Geo (MVS/AES) em C++17: porte de hub/src/cores/neogeo (neogeo.js, core.js, m68k.js, ym2610.js).
// 68000 a 12 MHz + Z80 a 4 MHz + YM2610 + LSPC (vídeo 320x224, 264 linhas por quadro).
// Precisa da BIOS do sistema (o usuário fornece). Jogos: arquivo .neo ou conjunto estilo MAME (P, S, M, V, C) SEM criptografia.
// Fora do escopo (o núcleo JS também os trata em outro lugar): chips CMC/SMA/PVC e KOF98 (ROMs criptografadas).
#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace emuhub {

class NeoGeoMachine : private M68kBus, private Z80Bus {
 public:
  static constexpr unsigned kWidth = 320, kHeight = 224, kLines = 264, kCpl = 768, kZpl = 256;

  struct File { std::string name; std::vector<std::uint8_t> data; };
  struct Bios { std::vector<std::uint8_t> bios, sfix, zoom, sm1; };
  struct Set { std::vector<std::uint8_t> p, s, m1, v, c1, c2; std::string name; };

  NeoGeoMachine();

  /* ---- carregamento ---- */
  static bool parse_bios(const std::vector<File>& files, Bios& out, std::string* err);
  static bool parse_mame(const std::vector<File>& files, Set& out, std::string* err);
  static bool is_neo(const std::uint8_t* d, std::size_t n);
  static bool parse_neo(const std::uint8_t* d, std::size_t n, Set& out, std::string* err);
  void set_bios(const Bios& b);
  bool has_bios() const { return has_bios_; }
  bool load_set(Set&& set, std::string* err);   // exige BIOS; faz reset()
  void reset();
  bool loaded() const { return loaded_; }

  /* botões do hub: A=1 B=2 SEL=4 (moeda) START=8 direcionais 16..128, X=256 (C) Y=512 (D), L=1024 = START do jogador 2 */
  void set_buttons(std::uint16_t b) { buttons_[0] = b; buttons_[1] = (b & 1024) ? 8 : 0; }
  bool run_frame();

  unsigned width() const { return kWidth; }
  unsigned height() const { return kHeight; }
  const std::vector<std::uint32_t>& framebuffer() const { return frame_; }

  void set_audio_rate(unsigned r) { ym_.set_sample_rate(r); }
  void set_audio_volume(float v) { ym_.set_volume(v); }
  std::size_t audio_buffered() const { return ym_.buffered(); }
  void fill_audio(float* out, std::size_t n) { ym_.fill(out, n); }

  /* save de bateria (memory card interno de 64 KB) */
  std::uint8_t* sram_data() { return sram_.data(); }
  std::size_t sram_size() const { return sram_.size(); }
  bool has_battery() const { return loaded_; }
  void sram_restore(const std::uint8_t* d, std::size_t n);
  std::uint32_t rom_hash() const { return rom_hash_; }

  /* cheats: ENDEREÇO:VALOR na RAM de trabalho (100000-10FFFF), 1 ou 2 bytes */
  struct Cheat { std::uint32_t addr; std::uint32_t val; std::uint8_t size; };
  void set_cheats(const std::vector<Cheat>& c) { cheats_ = c; }
  static bool parse_cheats(const std::string& text, std::vector<Cheat>& out, std::string* err);

  void state(StateIO& s);

  // depuração/teste
  std::uint8_t peek(std::uint32_t a) const { a &= 0xFFFFFF; return a >= 0x100000 && a < 0x110000 ? wram_[a & 0xFFFF] : 0; }
  const M68k& cpu() const { return cpu_; }
  const Z80Cpu& z80() const { return z80_; }
  const std::uint8_t* wram() const { return wram_.data(); }
  const std::uint16_t* vram() const { return vram_.data(); }

 private:
  // M68kBus
  std::uint32_t r8(std::uint32_t a) override;
  std::uint32_t r16(std::uint32_t a) override;
  void w8(std::uint32_t a, std::uint32_t v) override;
  void w16(std::uint32_t a, std::uint32_t v) override;
  // Z80Bus
  std::uint8_t read(std::uint16_t a) override;
  void write(std::uint16_t a, std::uint8_t v) override;
  std::uint8_t port_in(int p) override;
  void port_out(int p, int v) override;

  std::uint32_t p16(std::uint32_t a) const;
  std::uint32_t io_read(std::uint32_t a);
  std::uint32_t joy(int n) const;
  std::uint32_t coin();
  std::uint32_t sys_in() const;
  void rtc_ctl(std::uint32_t v);
  void rtc_time();
  void sys_ctl(std::uint32_t r);
  void set_pal(int i, std::uint32_t v);
  std::uint32_t lspc_read(int r);
  void lspc_write(int r, std::uint32_t v);
  void update_irq();
  void render_line(int y);

  M68k cpu_;
  Z80Cpu z80_;
  Ym2610 ym_;
  bool has_bios_ = false, loaded_ = false;
  std::vector<std::uint8_t> bios_, sfix_, zoom_, sm1_, p_, s_, m1_, spr1_, spr2_;
  std::uint32_t n_tiles_ = 1, rom_hash_ = 0;
  std::array<std::uint8_t, 0x10000> wram_{}, sram_{};
  std::array<std::uint8_t, 0x800> zram_{};
  std::array<std::uint16_t, 0x8800> vram_{};
  std::array<std::uint16_t, 0x1000> pal_[2]{};
  std::array<std::uint32_t, 0x1000> pcache_[2]{};
  std::vector<std::uint32_t> frame_;
  std::uint32_t line_buf_[320]{};
  std::uint16_t buttons_[2]{};
  struct Rtc { std::int32_t cmd, cmd_shift, mode, reg_len, clk, stb; double tp; std::uint8_t reg[48]; };
  struct Sys {
    std::int32_t vec_bios, fix_bios, pal_bank, sram_locked, pbank;
    std::int32_t vaddr, vmod, mode, tmr_reload, anim, anim_div, frame_no, irq_p;
    std::int64_t tmr_cnt;
    std::int32_t tmr_run, latch, reply, nmi_on, nmi_pend, zc, ym_acc, line, wdog;
    std::int32_t zb[4];
    std::int64_t cyc_debt, z_dummy;
    double cyc;
    Rtc rtc;
  } k_{};
  std::vector<Cheat> cheats_;
};

}  // namespace emuhub
