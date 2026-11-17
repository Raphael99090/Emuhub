#pragma once
// CPU Motorola 68000 (Neo Geo): porte de hub/src/cores/neogeo/m68k.js. Conjunto completo de instruções,
// exceções e interrupções por nível. Tempo aproximado por instrução (base + custo do modo de endereçamento).
#include <cstdint>

namespace emuhub {

struct M68kBus {
  virtual ~M68kBus() = default;
  virtual std::uint32_t r8(std::uint32_t a) = 0;    // 0..255
  virtual std::uint32_t r16(std::uint32_t a) = 0;   // 0..65535
  virtual void w8(std::uint32_t a, std::uint32_t v) = 0;
  virtual void w16(std::uint32_t a, std::uint32_t v) = 0;
};

class M68k {
 public:
  struct State {
    std::int32_t d[8], a[8];
    std::int32_t pc, usp;
    std::uint32_t sr, x, n, z, v, c, stopped, irq;
  };
  explicit M68k(M68kBus* bus) : bus_(bus) { s_ = State{}; s_.sr = 0x2700; }
  void reset();
  int step();                  // devolve ciclos
  State& st() { return s_; }
  const State& st() const { return s_; }
  void set_irq(int lvl) { s_.irq = static_cast<std::uint32_t>(lvl); }

 private:
  struct Illegal {};
  std::int32_t rd(std::uint32_t a, int s);
  void wr(std::uint32_t a, int s, std::int32_t v);
  std::uint32_t r16(std::int32_t a) { return bus_->r16(static_cast<std::uint32_t>(a) & 0xFFFFFE); }
  std::uint32_t fetch();
  std::int32_t fetch_s();
  std::int32_t fetch32();
  void push16(std::int32_t v);
  void push32(std::int32_t v);
  std::int32_t pop16();
  std::int32_t pop32();
  std::uint32_t get_sr() const;
  void set_sr(std::uint32_t v);
  void set_ccr(std::uint32_t v);
  void exception(int vec, std::int32_t pc_save);
  bool cond(int c) const;
  void ea(int mode, int reg, int s);
  std::int32_t index();
  std::int32_t read_ea(int s);
  void write_ea(int s, std::int32_t v);
  std::int32_t add(std::int32_t S, std::int32_t D, int s, std::uint32_t cx, bool xz);
  std::int32_t sub(std::int32_t S, std::int32_t D, int s, std::uint32_t cx, bool xz, bool no_x = false);
  std::int32_t logic(std::int32_t r, int s);
  std::int32_t shift(int type, bool left, std::int32_t val, int cnt, int s);
  void exec(std::uint32_t op);
  void g0(std::uint32_t op, int rx, int ry, int mode, int sz);
  void g4(std::uint32_t op, int rx, int ry, int mode, int sz);
  void movem(std::uint32_t op, int ry, int mode);
  void g8c(std::uint32_t op, int rx, int ry, int mode, int sz);

  M68kBus* bus_;
  State s_;
  int cyc_ = 0, ea_t_ = 0;
  std::int32_t ea_a_ = 0, ea_v_ = 0;
};

}  // namespace emuhub
