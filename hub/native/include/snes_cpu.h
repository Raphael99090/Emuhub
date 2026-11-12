#pragma once
#include <cstdint>

namespace emuhub {

/* Barramento visto pela CPU 65C816. read/write recebem endereços de 24 bits e cobram os ciclos mestres
 * de cada acesso; idle() cobra ciclos internos. */
class SnesBus {
 public:
  virtual ~SnesBus() = default;
  virtual std::uint8_t read(std::uint32_t addr) = 0;
  virtual void write(std::uint32_t addr, std::uint8_t value) = 0;
  virtual void idle(int cycles) = 0;
  bool nmi_pending = false;
  bool irq_line = false;
  bool gsu_irq = false;
};

/* CPU 65C816 (Ricoh 5A22 do SNES): portada instrução a instrução do núcleo JavaScript. */
class Snes65816 {
 public:
  static constexpr int N = 0x80, V = 0x40, M = 0x20, X = 0x10, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;

  explicit Snes65816(SnesBus* bus) : bus_(bus) {}
  void reset();
  void step();

  int a = 0, x = 0, y = 0, s = 0x1FF, d = 0, db = 0, pb = 0, pc = 0, p = 0x34, e = 1;
  bool wai = false, stp = false;
  int bad_opcode = -1;  // opcode ainda não implementado (o JS lança erro; aqui só registramos)

 private:
  SnesBus* bus_;
  std::uint8_t rd8(std::uint32_t a) { return bus_->read(a); }
  int rd16(std::uint32_t a);
  int rd24(std::uint32_t a);
  void wr8(std::uint32_t a, int v) { bus_->write(a, static_cast<std::uint8_t>(v & 0xFF)); }
  void wr16(std::uint32_t a, int v);
  void wr16r(std::uint32_t a, int v);
  int fetch8();
  int fetch16();
  int fetch24();
  void idle(int n) { bus_->idle(n); }
  void push8(int v);
  void push16(int v);
  int pull8();
  int pull16();
  void nz8(int v);
  void nz16(int v);
  void set_p(int v);
  // modos de endereçamento
  std::uint32_t dp(), dp_x(), dp_y(), abs_(), abs_x(bool w), abs_y(bool w), long_(), long_x();
  std::uint32_t dp_ind(), dp_ind_x(), dp_ind_y(bool w), dp_ind_long(), dp_ind_long_y(), sr(), sr_ind_y();
  std::uint32_t imm_m(), imm_x();
  std::uint32_t alu_ea(int bbb, bool w);
  std::uint32_t alu3_ea(int bbb);
  void adc(int v);
  void sbc(int v);
  void cmp(int reg, int v, bool is8);
  int shift(int kind, int v, bool is8);
  void rmw(int kind, std::uint32_t ea);
  void rmw_a(int kind);
  void branch(bool cond);
  void interrupt(int kind);
  void alu_op(int kind, std::uint32_t ea);
  void ldx(std::uint32_t ea);
  void ldy(std::uint32_t ea);
  void st_idx(std::uint32_t ea, int v);
  void cmp_idx(int reg, std::uint32_t ea);
  void bit(std::uint32_t ea, bool imm);
  void tsb(std::uint32_t ea, bool reset);
  void block(int dir);
  void stz(std::uint32_t ea);
  void other(int op);
};

}  // namespace emuhub
