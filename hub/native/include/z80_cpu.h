#pragma once
// CPU Z80 independente (porte de hub/src/cores/sms/z80.js), com barramento por interface. Usada pelo Neo Geo.
#include <cstdint>

namespace emuhub {

struct Z80Bus {
  virtual ~Z80Bus() = default;
  virtual std::uint8_t read(std::uint16_t a) = 0;
  virtual void write(std::uint16_t a, std::uint8_t v) = 0;
  virtual std::uint8_t port_in(int p) = 0;
  virtual void port_out(int p, int v) = 0;
};

class Z80Cpu {
 public:
  struct Regs {
    std::uint8_t R[8], R2[8];   // B C D E H L (livre) A / sombra
    std::uint8_t f, f2;
    std::uint16_t ix, iy, sp, pc;
    std::uint8_t i, r, iff1, iff2, im, halted, ei_wait, nmi, irq_line, idx;
  };
  explicit Z80Cpu(Z80Bus* bus) : bus_(bus) { reset(); }
  void reset();
  int step();   // devolve ciclos
  Regs& regs() { return c_; }
  const Regs& regs() const { return c_; }

 private:
  int exec(int op);
  int cb();
  int ed();
  int block(int y, int z);
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

  Z80Bus* bus_;
  Regs c_{};
};

}  // namespace emuhub
