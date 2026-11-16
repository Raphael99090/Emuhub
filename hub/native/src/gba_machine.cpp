// Sistema do GBA (porte de hub/src/cores/gba/sys.js + core.js): registradores de IO, interrupções, timers, DMA, teclas e
// relógio por scanline. Um quadro = 228 linhas x 1232 ciclos (960 de desenho + 272 de HBlank) = 280896 ciclos.
#include "gba_machine.h"
#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace emuhub {

namespace {
inline std::uint32_t ld32(const std::uint8_t* p) { std::uint32_t v; std::memcpy(&v, p, 4); return v; }
bool has_at(const std::uint8_t* d, const char* s) { for (int k = 0; s[k]; k++) if (d[k] != static_cast<std::uint8_t>(s[k])) return false; return true; }

int find_save_type(const std::uint8_t* d, std::size_t n) {
  static const struct { const char* s; int t; } pats[] = {{"EEPROM_V", 4}, {"SRAM_V", 1}, {"FLASH1M_V", 3}, {"FLASH512_V", 2}, {"FLASH_V", 2}};
  if (n < 10) return 0;
  const std::size_t len = n - 10;
  for (std::size_t i = 0; i < len; i++) {
    const std::uint8_t c = d[i];
    if (c != 0x45 && c != 0x53 && c != 0x46) continue;
    for (const auto& p : pats) if (static_cast<std::uint8_t>(p.s[0]) == c && has_at(d + i, p.s)) return p.t;
  }
  return 0;
}
}  // namespace

GbaMachine::GbaMachine() {
  frame_.assign(kWidth * kHeight, 0xFF000000u);
  rom_.assign(4, 0);
  install_bios();
  std::memset(ee_.data, 0xFF, sizeof(ee_.data));
  sram_.fill(0xFF);
  reset();
}

/* Vetor de IRQ da BIOS real: salva registradores, chama o handler do jogo em [0x03007FFC] e retorna. */
void GbaMachine::install_bios() {
  auto put = [&](std::uint32_t off, std::uint32_t v) { std::memcpy(bios_.data() + off, &v, 4); };
  put(0x18, 0xEA000042);    // b 0x128
  put(0x128, 0xE92D500F);   // stmfd sp!, {r0-r3, r12, lr}
  put(0x12C, 0xE3A00301);   // mov r0, #0x04000000
  put(0x130, 0xE28FE000);   // add lr, pc, #0
  put(0x134, 0xE510F004);   // ldr pc, [r0, #-4]
  put(0x138, 0xE8BD500F);   // ldmfd sp!, {r0-r3, r12, lr}
  put(0x13C, 0xE25EF004);   // subs pc, lr, #4
}

void GbaMachine::reset() {
  ewram_.fill(0); iwram_.fill(0); pal_.fill(0); vram_.fill(0); oam_.fill(0); io_.fill(0);
  set_io16(0, 0x80); set_io16(0x88, 0x200);
  for (std::uint32_t o : {0x20u, 0x26u, 0x30u, 0x36u}) set_io16(o, 0x100);   // PA/PD dos BGs afins começam em 1.0
  for (auto& t : timers_) t = Timer{0, 0, 0, 0, 0, 1, 0};
  for (auto& d : dma_on_) d = 0;
  timers_on_ = 0; t_acc_ = 0; t_next_ = 0x7FFFFFFF;
  apu_reset();
  fl_.state = 0; fl_.id = 0; fl_.erase = 0; fl_.prog = 0; fl_.bank_sw = 0;
  ee_.bits = 0; ee_.out_pos = 68;
  line_ = 0; hblank_ = 0; carry_ = 0; frame_done_ = 0; intr_waiting_ = 0; key_held_ = 0;
  cpu_reset(true);
  latch_ref(0); latch_ref(1);
}

void GbaMachine::soft_reset() {
  const std::uint8_t flag = iwram_[0x7FFA];
  std::memset(iwram_.data() + 0x7E00, 0, 0x200);
  cpu_reset(true);
  cpu_.r[15] = flag ? 0x02000000 : 0x08000000; cpu_.pc_written = 1;
}

GbaError GbaMachine::load_rom(const std::uint8_t* d, std::size_t n) {
  if (n < 0xC0) return GbaError::TooSmall;
  if (d[0xB2] != 0x96) return GbaError::BadHeader;
  std::uint32_t sum = 0;
  for (int i = 0xA0; i <= 0xBC; i++) sum += d[i];
  const std::uint8_t chk = static_cast<std::uint8_t>(-(static_cast<int>(sum) + 0x19));
  Header h{};
  auto str = [&](std::size_t a, int len, char* out) { int k = 0; for (; k < len && d[a + k]; k++) out[k] = static_cast<char>(d[a + k]); out[k] = 0; };
  str(0xA0, 12, h.title); str(0xAC, 4, h.code); str(0xB0, 2, h.maker);
  h.version = d[0xBC]; h.rom_bytes = static_cast<std::uint32_t>(n);
  h.checksum_ok = chk == d[0xBD]; h.arm_entry = d[3] == 0xEA; h.save = find_save_type(d, n);
  header_ = h;
  rom_len_ = static_cast<std::uint32_t>(n);
  rom_.assign((n + 3) & ~static_cast<std::size_t>(3), 0);
  std::memcpy(rom_.data(), d, n);
  std::uint32_t hs = 0;
  for (std::size_t i = 0; i < std::min<std::size_t>(n, 65536); i++) hs = hs * 31 + d[i];
  rom_hash_ = hs;
  sram_.fill(0xFF); std::memset(ee_.data, 0xFF, sizeof(ee_.data)); ee_.size = 0;
  switch (h.save) { case 2: save_type_ = 1; break; case 3: save_type_ = 2; break; case 4: save_type_ = 3; break; default: save_type_ = 0; }
  fl_.bank = 0;
  reset();
  loaded_ = true;
  return GbaError::Ok;
}

bool GbaMachine::load_bios(const std::uint8_t* d, std::size_t n) {
  if (n != 0x4000) return false;
  std::memcpy(bios_.data(), d, 0x4000);
  hle_ = false;
  reset();
  return true;
}

/* ---------- interrupções ---------- */
void GbaMachine::raise(std::uint32_t bit) { set_io16(0x202, io16(0x202) | bit); update_irq(); }
void GbaMachine::update_irq() {
  const std::uint32_t pend = io16(0x200) & io16(0x202) & 0x3FFF;
  cpu_.irq_pending = ((io16(0x208) & 1) != 0 && pend != 0) ? 1 : 0;
  if (pend && cpu_.halted) cpu_.halted = 0;
}

/* ---------- registradores ---------- */
std::uint32_t GbaMachine::io_read(std::uint32_t off) {
  switch (off) {
    case 0x004: {
      std::uint32_t v = io16(4) & 0xFF38;
      const std::int32_t vc = line_;
      if (vc >= 160 && vc != 227) v |= 1;
      if (hblank_) v |= 2;
      if (vc == static_cast<std::int32_t>(v >> 8)) v |= 4;
      return v;
    }
    case 0x006: return static_cast<std::uint32_t>(line_);
    case 0x100: case 0x104: case 0x108: case 0x10C:
      if (t_acc_) timer_flush();
      return static_cast<std::uint32_t>(timers_[(off - 0x100) >> 2].counter);
    case 0x130: return keys_;
    case 0x84: return apu_read(0x84);
    default:
      if (off >= 0x90 && off < 0xA0) return apu_read(off);
      return io16(off);
  }
}
void GbaMachine::io_write8(std::uint32_t off, std::uint32_t v) {
  if (off >= 0xA0 && off < 0xA8) { fifo_push((off >> 2) & 1, static_cast<std::int8_t>(v & 255)); return; }
  if (off == 0x301) { cpu_.halted = 1; return; }
  if (off == 0x202 || off == 0x203) { io_write(0x202, v << ((off & 1) << 3)); return; }
  const std::uint32_t a = off & ~1u, cur = io16(a);
  io_write(a, (off & 1) ? ((cur & 0xFF) | (v << 8)) : ((cur & 0xFF00) | v));
}
void GbaMachine::io_write(std::uint32_t off, std::uint32_t v) {
  if (off >= 0xB0 && off < 0xE0) {
    set_io16(off, v);
    const std::uint32_t rel = off - 0xB0;
    if (rel % 12 == 10) dma_ctl(static_cast<int>(rel / 12), v);
    return;
  }
  if (off >= 0x100 && off < 0x110) {
    set_io16(off, v);
    const int i = static_cast<int>((off - 0x100) >> 2);
    if (off & 2) timer_ctl(i, v); else timers_[i].reload = static_cast<std::int32_t>(v);
    return;
  }
  if (off >= 0x28 && off <= 0x2E) { set_io16(off, v); latch_ref(0); return; }
  if (off >= 0x38 && off <= 0x3E) { set_io16(off, v); latch_ref(1); return; }
  if (off >= 0x60 && off < 0xA8) {
    if (off >= 0xA0) { const int f = (off >> 2) & 1; fifo_push(f, static_cast<std::int8_t>(v & 255)); fifo_push(f, static_cast<std::int8_t>((v >> 8) & 255)); return; }
    std::uint32_t st = v;
    if (off == 0x64 || off == 0x6C || off == 0x74) st = v & 0x47FF;
    else if (off == 0x7C) st = v & 0x40FF;
    else if (off == 0x82) st = v & 0x770F;
    else if (off == 0x84) st = v & 0x80;
    set_io16(off, st);
    apu_write(off, v);
    return;
  }
  switch (off) {
    case 0x004: set_io16(4, v & 0xFF38); return;
    case 0x006: return;
    case 0x200: set_io16(0x200, v); update_irq(); return;
    case 0x202: set_io16(0x202, io16(0x202) & ~v); update_irq(); return;
    case 0x208: set_io16(0x208, v & 1); update_irq(); return;
    case 0x300: cpu_.halted = 1; return;
    default: set_io16(off, v);
  }
}

/* ---------- teclas ---------- */
void GbaMachine::set_buttons(std::uint16_t m) {
  const std::uint32_t pressed = (m & 1u) | ((m >> 1) & 1u) << 1 | ((m >> 2) & 1u) << 2 | ((m >> 3) & 1u) << 3 |
      ((m >> 7) & 1u) << 4 | ((m >> 6) & 1u) << 5 | ((m >> 4) & 1u) << 6 | ((m >> 5) & 1u) << 7 |
      ((m >> 11) & 1u) << 8 | ((m >> 10) & 1u) << 9;
  keys_ = (~pressed) & 0x3FF;
  const std::uint32_t kc = io16(0x132);
  if (kc & 0x4000) {
    const std::uint32_t mask = kc & 0x3FF;
    const bool cond = mask && ((kc & 0x8000) ? (pressed & mask) == mask : (pressed & mask) != 0);
    if (cond && !key_held_) raise(0x1000);
    key_held_ = cond ? 1 : 0;
  }
}

/* ---------- timers ---------- */
void GbaMachine::timer_ctl(int i, std::uint32_t v) {
  if (t_acc_) timer_flush();   // aplica o tempo pendente com a configuração antiga
  Timer& t = timers_[i];
  const std::int32_t was = t.on;
  static const int divs[4] = {1, 64, 256, 1024};
  t.on = (v & 0x80) != 0; t.cascade = ((v & 4) != 0 && i > 0) ? 1 : 0; t.irq = (v & 0x40) != 0; t.div = divs[v & 3];
  if (!was && t.on) { t.counter = t.reload; t.acc = 0; }
  timers_on_ = (timers_[0].on || timers_[1].on || timers_[2].on || timers_[3].on) ? 1 : 0;
  timer_schedule();
}
/* Os timers só são avançados quando algo pode mudar: estouro, leitura ou escrita dos registradores. */
void GbaMachine::timer_schedule() {
  std::int64_t n = 0x7FFFFFFF;
  for (int i = 0; i < 4; i++) {
    const Timer& t = timers_[i];
    if (t.on && !t.cascade) { const std::int64_t need = static_cast<std::int64_t>(0x10000 - t.counter) * t.div - t.acc; if (need < n) n = need; }
  }
  t_next_ = n;
}
void GbaMachine::timer_step(int c) { t_acc_ += c; if (t_acc_ >= t_next_) timer_flush(); }
void GbaMachine::timer_flush() { const int c = static_cast<int>(t_acc_); t_acc_ = 0; if (c) timer_tick(c); timer_schedule(); }
void GbaMachine::timer_tick(int c) {
  for (int i = 0; i < 4; i++) {
    Timer& t = timers_[i];
    if (!t.on || t.cascade) continue;
    t.acc += c;
    if (t.acc >= t.div) { const std::int32_t inc = t.acc / t.div; t.acc -= inc * t.div; timer_add(i, inc); }
  }
}
void GbaMachine::timer_add(int i, std::int64_t inc) {
  Timer& t = timers_[i];
  std::int64_t cn = t.counter + inc;
  std::int32_t ov = 0;
  while (cn > 0xFFFF) { ov++; cn = cn - 0x10000 + t.reload; }
  t.counter = static_cast<std::int32_t>(cn);
  if (ov) {
    if (i < 2) apu_timer_overflow(i, ov);
    if (t.irq) raise(1u << (3 + i));
    if (i < 3) { Timer& nx = timers_[i + 1]; if (nx.on && nx.cascade) timer_add(i + 1, ov); }
  }
}

/* ---------- DMA ---------- */
int GbaMachine::dma_count(int ch) const {
  std::uint32_t n = io16(0xB8 + ch * 12);
  if (ch != 3) n &= 0x3FFF;
  return n == 0 ? (ch == 3 ? 0x10000 : 0x4000) : static_cast<int>(n);
}
void GbaMachine::dma_ctl(int ch, std::uint32_t v) {
  const std::int32_t was = dma_on_[ch];
  const bool on = (v & 0x8000) != 0;
  dma_on_[ch] = on ? 1 : 0;
  if (!on || was) return;
  const std::uint32_t base = 0xB0 + ch * 12;
  Dma& d = dma_[ch];
  d.src = io32(base) & (ch == 0 ? 0x07FFFFFFu : 0x0FFFFFFFu);
  d.dst = io32(base + 4) & (ch == 3 ? 0x0FFFFFFFu : 0x07FFFFFFu);
  d.count = dma_count(ch);
  if (ch == 3 && (d.dst >> 24) == 13) ee_detect(d.count);
  if (((v >> 12) & 3) == 0) dma_run(ch);
}
void GbaMachine::dma_run(int ch) {
  Dma& d = dma_[ch];
  const std::uint32_t ci = 0xBA + ch * 12, ctl = io16(ci);
  const bool word = (ctl & 0x400) != 0;
  const std::int32_t step = word ? 4 : 2, sc = (ctl >> 7) & 3, dc = (ctl >> 5) & 3;
  const std::int32_t si = sc == 1 ? -step : sc == 2 ? 0 : step, di = dc == 1 ? -step : dc == 2 ? 0 : step;
  std::uint32_t src = d.src, dst = d.dst;
  if (word) {
    src &= ~3u; dst &= ~3u;
    for (std::int32_t i = d.count; i > 0; i--) { write32(dst, read32(src)); src += si; dst += di; }
  } else {
    src &= ~1u; dst &= ~1u;
    for (std::int32_t i = d.count; i > 0; i--) { write16(dst, read16(src)); src += si; dst += di; }
  }
  d.src = src; d.dst = dst;
  const std::uint32_t timing = (ctl >> 12) & 3;
  if ((ctl & 0x200) && timing != 0) {
    d.count = dma_count(ch);
    if (dc == 3) d.dst = io32(0xB0 + ch * 12 + 4) & (ch == 3 ? 0x0FFFFFFFu : 0x07FFFFFFu);
  } else { set_io16(ci, ctl & ~0x8000u); dma_on_[ch] = 0; }
  if (ctl & 0x4000) raise(0x100u << ch);
}
void GbaMachine::dma_fifo(int i) {
  const std::uint32_t dst_addr = 0x040000A0 + i * 4;
  for (int ch = 1; ch <= 2; ch++) {
    Dma& d = dma_[ch];
    const std::uint32_t ctl = io16(0xBA + ch * 12);
    if (!dma_on_[ch] || ((ctl >> 12) & 3) != 3 || d.dst != dst_addr) continue;
    const std::uint32_t sc = (ctl >> 7) & 3;
    const std::int32_t si = sc == 1 ? -4 : sc == 2 ? 0 : 4;
    std::uint32_t src = d.src & ~3u;
    for (int k = 0; k < 4; k++) { write32(dst_addr, read32(src)); src += si; }
    d.src = src;
    if (ctl & 0x4000) raise(0x100u << ch);
    return;
  }
}
void GbaMachine::dma_trigger(int timing) {
  bool any = false;
  for (int ch = 0; ch < 4; ch++) {
    if (dma_on_[ch] && static_cast<int>((io16(0xBA + ch * 12) >> 12) & 3) == timing) {
      if (!any) { cycles_ = 0; any = true; }
      dma_run(ch);
    }
  }
  if (any) { apu_run(cycles_); if (timers_on_) timer_step(cycles_); }
}

/* ---------- relógio ---------- */
void GbaMachine::run_segment(int n) {
  std::int32_t left = n - carry_; carry_ = 0;
  const std::int32_t start = left;
  while (left > 0) {
    if (cpu_.halted) {
      const int c = left < 16 ? left : 16;
      if (timers_on_) timer_step(c);
      left -= c; update_irq();
      continue;
    }
    const int c = cpu_step();
    if (timers_on_) timer_step(c);
    left -= c;
  }
  apu_run(start - left);   // som em lote por segmento (até 1232 ciclos), não por instrução
  carry_ = -left;
}
bool GbaMachine::run_frame() {
  if (!loaded_) return false;
  frame_done_ = 0;
  while (!frame_done_) {
    run_segment(960);
    begin_hblank();
    run_segment(272);
    end_line();
  }
  if (!cheats_.empty()) {
    const int c = cycles_;
    for (const Cheat& o : cheats_) {
      if (o.size == 1) write8(o.addr, o.val); else if (o.size == 2) write16(o.addr & ~1u, o.val); else write32(o.addr & ~3u, o.val);
    }
    cycles_ = c;
  }
  return true;
}
void GbaMachine::begin_hblank() {
  const int line = line_;
  if (line < 160 && !skip_video_) { render_line(line); advance_refs(); }
  hblank_ = 1;
  if (io16(4) & 0x10) raise(2);
  if (line < 160) dma_trigger(2);
}
void GbaMachine::end_line() {
  hblank_ = 0;
  line_ = line_ == 227 ? 0 : line_ + 1;
  if (line_ == 0) { latch_ref(0); latch_ref(1); }
  const std::uint32_t ds = io16(4);
  if (line_ == static_cast<std::int32_t>((ds >> 8) & 0xFF) && (ds & 0x20)) raise(4);
  if (line_ == 160) {
    if (ds & 8) raise(1);
    dma_trigger(1);
    frame_done_ = 1;
  }
}

/* ---------- saves ---------- */
std::uint8_t* GbaMachine::sram_data() { return save_type_ == 3 ? ee_.data : sram_.data(); }
std::size_t GbaMachine::sram_size() const {
  switch (save_type_) {
    case 1: return 0x10000;
    case 2: return 0x20000;
    case 3: return ee_.size ? static_cast<std::size_t>(ee_.size) : 512;
    default: return 0x8000;
  }
}
void GbaMachine::sram_restore(const std::uint8_t* u, std::size_t n) {
  const std::size_t sz = sram_size();
  std::memcpy(sram_data(), u, std::min(n, sz));
  if (save_type_ == 3) {
    if (n >= 8192) { std::memcpy(ee_.data, u, 8192); ee_.size = 8192; }
    else std::memcpy(ee_.data, u, std::min<std::size_t>(n, 512));
  }
}

/* ---------- cheats: AR/GameShark v3 sem criptografia (tipos 0, 1, 2) e "ENDERECO:VALOR" ---------- */
bool GbaMachine::parse_cheats(const std::string& text, std::vector<Cheat>& out, std::string* err) {
  auto fail = [&](const std::string& m) { if (err) *err = m; return false; };
  auto hex = [](const std::string& s) { for (char c : s) if (!std::isxdigit(static_cast<unsigned char>(c))) return false; return !s.empty(); };
  std::vector<Cheat> ops;
  std::string line;
  auto flush = [&]() -> bool {
    std::string s;
    for (char c : line) if (c != '\r') s += c;
    line.clear();
    std::size_t b = 0, e = s.size();
    while (b < e && std::isspace(static_cast<unsigned char>(s[b]))) b++;
    while (e > b && std::isspace(static_cast<unsigned char>(s[e - 1]))) e--;
    s = s.substr(b, e - b);
    if (s.empty()) return true;
    std::size_t sep = s.find_first_of(" :=");
    if (sep == std::string::npos) return fail("Formato não reconhecido: \"" + s + "\".");
    std::string a = s.substr(0, sep);
    std::size_t vb = sep + 1;
    while (vb < s.size() && (s[vb] == ' ' || s[vb] == ':' || s[vb] == '=')) vb++;
    std::string v = s.substr(vb);
    if (!hex(a) || !hex(v)) return fail("Formato não reconhecido: \"" + s + "\".");
    Cheat c{};
    if (a.size() == 8 && v.size() == 8) {
      const std::uint32_t hi = static_cast<std::uint32_t>(std::strtoul(a.c_str(), nullptr, 16)), t = hi >> 28;
      if (t > 2) return fail("Código tipo " + std::to_string(t) + " não suportado (aceito: 0, 1 e 2).");
      c.addr = hi & 0x0FFFFFFF; c.val = static_cast<std::uint32_t>(std::strtoul(v.c_str(), nullptr, 16)); c.size = static_cast<std::uint8_t>(1u << t);
    } else if (a.size() >= 6 && a.size() <= 8 && (v.size() == 2 || v.size() == 4 || v.size() == 8)) {
      c.addr = static_cast<std::uint32_t>(std::strtoul(a.c_str(), nullptr, 16)); c.val = static_cast<std::uint32_t>(std::strtoul(v.c_str(), nullptr, 16)); c.size = static_cast<std::uint8_t>(v.size() >> 1);
    } else return fail("Formato não reconhecido: \"" + s + "\".");
    const std::uint32_t reg = c.addr >> 24;
    if (reg != 2 && reg != 3) return fail("Endereço fora da RAM (02xxxxxx ou 03xxxxxx).");
    ops.push_back(c);
    return true;
  };
  for (char ch : text) {
    if (ch == '\n' || ch == ',' || ch == ';') { if (!flush()) return false; }
    else line += ch;
  }
  if (!flush()) return false;
  if (ops.empty()) return fail("Digite um código.");
  out = ops;
  return true;
}

/* ---------- estado ---------- */
void GbaMachine::state(StateIO& s) {
  s.v(cpu_);
  s.v(ewram_); s.v(iwram_); s.v(io_); s.v(pal_); s.v(oam_); s.v(vram_); s.v(sram_);
  s.v(fl_); s.v(ee_);
  s.v(timers_); s.v(dma_); s.v(dma_on_);
  s.v(timers_on_); s.v(line_); s.v(hblank_); s.v(carry_); s.v(frame_done_); s.v(intr_waiting_); s.v(key_held_);
  s.v(t_acc_); s.v(t_next_); s.v(keys_); s.v(ref_x_); s.v(ref_y_);
  const std::uint64_t rp = a_.rp, wp = a_.wp;
  s.v(a_);
  if (!s.saving()) { a_.rp = a_.wp = wp; (void)rp; }   // descarta o áudio pendente ao carregar
}

}  // namespace emuhub
