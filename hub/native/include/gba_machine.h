#pragma once
#include "state_io.h"
// Game Boy Advance em C++17: porte do núcleo JavaScript (hub/src/cores/gba: cpu, bus, ppu, apu, bios, sys, core).
// ARM7TDMI (ARM + Thumb), vídeo por scanline (modos 0-5, sprites, janelas, alpha), PSG + Direct Sound, timers, DMA,
// SRAM/Flash/EEPROM e BIOS simulada (HLE). Não precisa da BIOS real; ela é opcional.
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace emuhub {

enum class GbaError { Ok = 0, TooSmall = 1, BadHeader = 2 };

class GbaMachine {
 public:
  static constexpr unsigned kWidth = 240, kHeight = 160;
  static constexpr unsigned kAudioSize = 65536;
  static constexpr int kClock = 16777216;

  GbaMachine();

  /* Valida o cabeçalho (byte fixo 0x96), detecta o tipo de save e faz reset(). */
  GbaError load_rom(const std::uint8_t* data, std::size_t size);
  /* BIOS real opcional (exatamente 16 KB). Desliga a BIOS simulada. */
  bool load_bios(const std::uint8_t* data, std::size_t size);
  void reset();
  /* bits do hub: A=1 B=2 SEL=4 START=8 UP=16 DOWN=32 LEFT=64 RIGHT=128 R=0x800 L=0x400 */
  void set_buttons(std::uint16_t mask);
  bool run_frame();
  bool loaded() const { return loaded_; }
  void set_skip_video(bool on) { skip_video_ = on; }
  void set_turbo(bool on) { a_.fast = on ? 1 : 0; }

  unsigned width() const { return kWidth; }
  unsigned height() const { return kHeight; }
  /* 240x160 pixels no mesmo formato do JS (0xFFBBGGRR) */
  const std::vector<std::uint32_t>& framebuffer() const { return frame_; }

  // áudio mono (float)
  void set_audio_rate(unsigned rate);
  void set_audio_volume(float v) { volume_ = v; }
  std::size_t audio_buffered() const { return static_cast<std::size_t>(a_.wp - a_.rp); }
  void fill_audio(float* out, std::size_t n);

  /* Save de bateria (SRAM, Flash 64/128 KB ou EEPROM, conforme detectado na ROM). */
  std::uint8_t* sram_data();
  std::size_t sram_size() const;
  bool has_battery() const { return header_.save != 0; }
  void sram_restore(const std::uint8_t* data, std::size_t n);

  /* Cheats de RAM (02xxxxxx / 03xxxxxx), aplicados no fim de cada quadro. */
  struct Cheat { std::uint32_t addr; std::uint32_t val; std::uint8_t size; };
  void set_cheats(const std::vector<Cheat>& c) { cheats_ = c; }
  /* Aceita "03001234 000000FF" (AR tipos 0, 1, 2), "03001234:FF" e várias linhas separadas por \n , ; */
  static bool parse_cheats(const std::string& text, std::vector<Cheat>& out, std::string* err);

  struct Header {
    char title[13], code[5], maker[3];
    std::uint8_t version;
    bool checksum_ok, arm_entry;
    int save;   // 0 nenhum, 1 SRAM, 2 Flash 64 KB, 3 Flash 128 KB, 4 EEPROM
    std::uint32_t rom_bytes;
  };
  const Header& header() const { return header_; }
  std::uint32_t rom_hash() const { return rom_hash_; }

  void state(StateIO& s);

  // acesso de depuração/teste
  std::uint32_t reg(int i) const { return cpu_.r[i & 15]; }
  std::uint32_t cpsr() const { return get_cpsr(); }
  const std::uint8_t* ewram() const { return ewram_.data(); }
  const std::uint8_t* iwram() const { return iwram_.data(); }
  const std::uint8_t* io_regs() const { return io_.data(); }
  const std::uint8_t* vram() const { return vram_.data(); }
  const std::uint8_t* pal() const { return pal_.data(); }
  const std::uint8_t* oam() const { return oam_.data(); }
  std::uint8_t peek(std::uint32_t a);

 private:
  struct Cpu {
    std::uint32_t r[16], b13[6], b14[6], spsr[6], usr_hi[5], fiq_hi[5];
    std::uint32_t n, z, c, v, i, f, t, mode, sc, pc_written, irq_pending, halted;
  };
  struct Timer { std::int32_t counter, reload, on, cascade, irq, div, acc; };
  struct Dma { std::uint32_t src, dst; std::int32_t count; };
  struct Flash { std::int32_t state, id, erase, prog, bank_sw, bank; };
  struct Eeprom { std::int32_t size, bits, out_pos; std::uint8_t data[8192], buf[256], out[68]; };
  // PSG
  struct Env { std::int32_t on, dac, len, len_en, vol, init_vol, env_dir, env_per, env_t; };
  struct Pulse { Env e; std::int32_t has_sweep, duty, freq, sw_shift, sw_neg, sw_per, sw_t, sw_en, sw_shadow; double pos; };
  struct Wave { std::uint8_t ram[2][16]; std::int32_t on, dac, dual, bank, vol_code, force, freq, len, len_en; double pos; };
  struct Noise { Env e; std::int32_t div, width7, shift, lfsr; double acc; };
  struct Fifo { std::int8_t q[32]; std::int32_t head, n, cur, timer; };
  struct Apu {
    Pulse p1, p2; Wave wave; Noise noise; Fifo fifo[2];
    std::int32_t master, seq_step, fast;
    double acc, seq, last, px, py;
    std::uint64_t rp, wp;
  };

  // barramento
  std::uint32_t read32(std::uint32_t a);
  std::uint32_t read16(std::uint32_t a);
  std::uint32_t read8(std::uint32_t a);
  void write32(std::uint32_t a, std::uint32_t v);
  void write16(std::uint32_t a, std::uint32_t v);
  void write8(std::uint32_t a, std::uint32_t v);
  void put8(std::uint32_t a, std::uint32_t v);   // escrita "crua" de byte (usada pela BIOS)
  std::uint32_t rom_read16(std::uint32_t a) const;
  std::uint32_t rom_read32(std::uint32_t a) const;
  std::uint32_t rom_read8(std::uint32_t a) const;
  std::uint32_t save_read(std::uint32_t a) const;
  void save_write(std::uint32_t a, std::uint32_t v);
  bool ee_active(std::uint32_t a) const { return save_type_ == 3 && (rom_len_ <= 0x1000000 || (a & 0x1FFFFFF) >= 0x1FFFF00); }
  void ee_detect(int n);
  std::uint32_t ee_read();
  void ee_write(std::uint32_t v);
  std::uint16_t io16(std::uint32_t off) const { std::uint16_t v; std::memcpy(&v, io_.data() + off, 2); return v; }
  void set_io16(std::uint32_t off, std::uint32_t v) { std::uint16_t x = static_cast<std::uint16_t>(v); std::memcpy(io_.data() + off, &x, 2); }
  std::uint32_t io32(std::uint32_t off) const { std::uint32_t v; std::memcpy(&v, io_.data() + off, 4); return v; }

  // sistema
  void install_bios();
  void raise(std::uint32_t bit);
  void update_irq();
  std::uint32_t io_read(std::uint32_t off);
  void io_write(std::uint32_t off, std::uint32_t v);
  void io_write8(std::uint32_t off, std::uint32_t v);
  void timer_ctl(int i, std::uint32_t v);
  void timer_schedule();
  void timer_step(int c);
  void timer_flush();
  void timer_tick(int c);
  void timer_add(int i, std::int64_t inc);
  int dma_count(int ch) const;
  void dma_ctl(int ch, std::uint32_t v);
  void dma_run(int ch);
  void dma_fifo(int i);
  void dma_trigger(int timing);
  void run_segment(int n);
  void begin_hblank();
  void end_line();
  void soft_reset();

  // CPU
  void cpu_reset(bool skip_bios);
  std::uint32_t get_cpsr() const;
  void set_cpsr(std::uint32_t v);
  std::uint32_t get_spsr() const;
  void switch_mode(std::uint32_t nm);
  std::uint32_t get_user(int k) const;
  void set_user(int k, std::uint32_t v);
  void exception(std::uint32_t vec, std::uint32_t mode, std::uint32_t lr);
  int undef(std::uint32_t pc);
  int swi(std::uint32_t num, std::uint32_t pc);
  void set_pc(std::uint32_t v);
  void bx(std::uint32_t v);
  void set_nz(std::uint32_t v) { cpu_.n = v >> 31; cpu_.z = v == 0 ? 1 : 0; }
  bool cond(std::uint32_t c) const;
  std::uint32_t addc(std::uint32_t a, std::uint32_t b, std::uint32_t cin, bool s);
  std::uint32_t shift_op(int type, std::uint32_t v, std::uint32_t amt, bool imm);
  std::uint32_t ldr32(std::uint32_t a);
  std::uint32_t ldrh(std::uint32_t a);
  std::uint32_t ldrsb(std::uint32_t a);
  std::uint32_t ldrsh(std::uint32_t a);
  int cpu_step();
  int exec_arm(std::uint32_t i, std::uint32_t pc);
  int data_proc(std::uint32_t i, std::uint32_t pc);
  int psr(std::uint32_t i, std::uint32_t pc);
  int mul(std::uint32_t i);
  int mull(std::uint32_t i);
  int swp(std::uint32_t i);
  int halfword(std::uint32_t i);
  int single(std::uint32_t i);
  int ldmstm(int rn, std::uint32_t list, int L, int P, int U, int W, int S);
  int exec_thumb(std::uint32_t i, std::uint32_t pc);
  int thumb_alu(std::uint32_t i);

  // BIOS HLE
  bool bios_swi(std::uint32_t num, std::uint32_t pc);
  bool intr_wait(bool discard, std::uint32_t flags, std::uint32_t pc);
  void ram_reset(std::uint32_t f);
  void store_out(std::uint32_t dst, const std::vector<std::uint8_t>& d, bool halfwords);
  std::vector<std::uint8_t> lz77(std::uint32_t src);
  std::vector<std::uint8_t> rle(std::uint32_t src);
  std::vector<std::uint8_t> huff(std::uint32_t src);

  // PPU
  void latch_ref(int i);
  void advance_refs();
  void render_line(int y);
  int mos_y(int i, int y) const;
  void mos_h(int i);
  void text_bg(int i, int y);
  void affine_bg(int i, int y);
  void bitmap_bg(int mode, int y, std::uint32_t dc);
  void render_obj(int y, std::uint32_t dc);
  void compose(int y, std::uint32_t dc, int on);

  // APU
  void apu_reset();
  std::uint32_t apu_read(std::uint32_t off) const;
  void apu_write(std::uint32_t off, std::uint32_t v);
  void apu_timer_overflow(int t, int count);
  void apu_step_sequencer();
  void apu_run(int c);
  void apu_gen_sample();
  void apu_push(double s);
  void fifo_push(int i, int byte);

  // estado
  bool loaded_ = false, hle_ = true, skip_video_ = false;
  Cpu cpu_{};
  std::array<std::uint8_t, 0x4000> bios_{};
  std::array<std::uint8_t, 0x40000> ewram_{};
  std::array<std::uint8_t, 0x8000> iwram_{};
  std::array<std::uint8_t, 0x400> io_{}, pal_{}, oam_{};
  std::array<std::uint8_t, 0x18000> vram_{};
  std::array<std::uint8_t, 0x20000> sram_{};
  Flash fl_{};
  Eeprom ee_{};
  std::int32_t save_type_ = 0;   // 0 sram, 1 flash64, 2 flash128, 3 eeprom
  std::int32_t cycles_ = 0;
  std::vector<std::uint8_t> rom_;
  std::uint32_t rom_len_ = 0;
  Timer timers_[4]{};
  Dma dma_[4]{};
  std::int32_t dma_on_[4]{};
  std::int32_t timers_on_ = 0, line_ = 0, hblank_ = 0, carry_ = 0, frame_done_ = 0, intr_waiting_ = 0, key_held_ = 0;
  std::int64_t t_acc_ = 0, t_next_ = 0x7FFFFFFF;
  std::uint32_t keys_ = 0x3FF;
  std::int32_t ref_x_[2]{}, ref_y_[2]{};
  Apu a_{};
  double cps_ = static_cast<double>(kClock) / 44100.0;
  double volume_ = 1.0;
  std::array<float, kAudioSize> abuf_{};
  std::vector<std::uint32_t> frame_;
  // buffers de linha do PPU (não entram no estado)
  std::int32_t bg_[4][240]{}, obj_c_[240]{};
  std::uint8_t obj_p_[240]{}, obj_s_[240]{}, obj_w_[240]{};
  bool obj_any_ = false, obj_semi_ = false;
  Header header_{};
  std::uint32_t rom_hash_ = 0;
  std::vector<Cheat> cheats_;
};

}  // namespace emuhub
