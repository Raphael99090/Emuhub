#pragma once
#include "snes_cpu.h"
#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace emuhub {

/* Vídeo e áudio do SNES ficam atrás de interfaces: o sistema (barramento, DMA/HDMA, temporização,
 * joypads) é independente deles e pode ser testado com dublês. */
class SnesPpuIface {
 public:
  virtual ~SnesPpuIface() = default;
  virtual void reset() = 0;
  virtual std::uint8_t read_reg(std::uint32_t addr) = 0;
  virtual void write_reg(std::uint32_t addr, std::uint8_t v) = 0;
  virtual void render_line(int y) = 0;
  virtual void begin_frame() = 0;
  virtual void finish_frame() = 0;
  virtual int setini() const = 0;
};
class SnesApuIface {
 public:
  virtual ~SnesApuIface() = default;
  virtual void reset() = 0;
  virtual std::uint8_t read_port(int port, long cyc) = 0;
  virtual void write_port(int port, std::uint8_t v, long cyc) = 0;
  virtual void sync_line(long cyc) = 0;  // fim de linha: cyc = ciclos mestres acumulados na linha
};

class SnesSystem : public SnesBus {
 public:
  static constexpr int kLine = 1364, kLines = 262, kHblank = 1096;

  SnesSystem(SnesPpuIface* ppu, SnesApuIface* apu);
  void load(const std::uint8_t* rom, std::size_t size, bool hirom, std::size_t sram_bytes);
  void reset();
  void run_frame();
  void run_line();
  void set_buttons(std::uint16_t hub_mask);
  Snes65816& cpu() { return cpu_; }
  std::vector<std::uint8_t>& sram() { return sram_; }
  std::vector<std::uint8_t>& wram() { return wram_; }
  long cycles() const { return cyc_; }
  int line() const { return line_; }
  int debug_rdnmi() const { return rdnmi_; }
  int debug_timeup() const { return timeup_; }
  int debug_nmitimen() const { return nmitimen_; }

  // SnesBus
  std::uint8_t read(std::uint32_t a) override;
  void write(std::uint32_t a, std::uint8_t v) override;
  void idle(int n) override { cyc_ += 6L * n * clk_; }

 private:
  struct Channel {
    int ctl = 0xFF, bbad = 0xFF, a1t = 0xFFFF, a1b = 0xFF, das = 0xFFFF, dasb = 0xFF, a2a = 0xFFFF, ntrl = 0xFF, unused = 0xFF;
    bool do_transfer = false, done = true;
  };
  int speed(std::uint32_t a) const;
  std::uint8_t raw_read(std::uint32_t a);
  void raw_write(std::uint32_t a, std::uint8_t v);
  std::uint8_t rom_at(int bank, int off) const;
  std::uint8_t reg_read(int a);
  void reg_write(int a, std::uint8_t v);
  std::uint8_t joy_read(int p);
  std::uint8_t read_b(int r);
  void write_b(int r, std::uint8_t v) { raw_write(0x2100 + r, v); }
  void run_dma();
  void hdma_init();
  void hdma_load(Channel& c);
  void hdma_run();
  int irq_target() const;

  SnesPpuIface* ppu_;
  SnesApuIface* apu_;
  Snes65816 cpu_;
  std::vector<std::uint8_t> rom_ = std::vector<std::uint8_t>(0x8000, 0);
  std::uint32_t rom_mask_ = 0x7FFF;
  bool hirom_ = false;
  std::vector<std::uint8_t> sram_;
  std::uint32_t sram_mask_ = 0;
  std::vector<std::uint8_t> wram_ = std::vector<std::uint8_t>(0x20000, 0);
  long cyc_ = 0;
  int line_ = 0, clk_ = 1;
  int mdr_ = 0, memsel_ = 0, nmitimen_ = 0, rdnmi_ = 0, timeup_ = 0, hvbjoy_ = 0;
  int htime_ = 0x1FF, vtime_ = 0x1FF;
  std::uint32_t wmadd_ = 0;
  int wrio_ = 0xFF, mul_a_ = 0xFF, mul_res_ = 0, div_q_ = 0, div_a_ = 0xFFFF;
  std::array<std::uint16_t, 4> joy_{}, joy_auto_{};
  std::array<std::uint16_t, 2> joy_shift_{};
  int joy_strobe_ = 0;
  int dma_en_ = 0, hdma_en_ = 0;
  std::array<Channel, 8> ch_;
};

}  // namespace emuhub
