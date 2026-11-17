#include "neogeo_machine.h"
// Porte fiel de hub/src/cores/neogeo/{neogeo,core}.js (sem os chips de criptografia). Qualquer diferença de comportamento é bug.
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <ctime>

namespace emuhub {

namespace {
const int kFixOrd[4] = {16, 24, 0, 8};
std::string lower(std::string s) { for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return s; }
std::string base_of(const std::string& n) { const std::size_t i = n.find_last_of("/\\"); return lower(i == std::string::npos ? n : n.substr(i + 1)); }
std::string ext_of(const std::string& b) { const std::size_t i = b.find_last_of('.'); return i == std::string::npos ? b : b.substr(i + 1); }
int num_of(const std::string& e) { std::string d; for (char c : e) if (std::isdigit(static_cast<unsigned char>(c))) d += c; return d.empty() ? 0 : std::atoi(d.c_str()); }
bool has_sub(const std::string& s, const char* t) { return s.find(t) != std::string::npos; }
bool starts(const std::string& s, const char* t) { return s.rfind(t, 0) == 0; }
// ext = <letras><dígitos> (ex.: p1, c12, sp1)
bool ext_is(const std::string& e, char ch) {
  std::size_t i = 0;
  if (ch == 'p') { if (i < e.size() && e[i] == 's') i++; if (i >= e.size() || e[i] != 'p') return false; i++; }
  else { if (i >= e.size() || e[i] != ch) return false; i++; }
  if (i >= e.size()) return false;
  for (; i < e.size(); i++) if (!std::isdigit(static_cast<unsigned char>(e[i]))) return false;
  return true;
}
}  // namespace

NeoGeoMachine::NeoGeoMachine() : cpu_(this), z80_(this) {
  bios_.assign(0x20000, 0); sfix_.assign(0x20000, 0);
  p_.assign(0x100000, 0); m1_.assign(0x10000, 0); spr1_.assign(64, 0); spr2_.assign(64, 0);
  frame_.assign(kWidth * kHeight, 0);
  reset();
}

void NeoGeoMachine::reset() {
  Sys& k = k_;
  const Rtc blank{};
  k.vec_bios = 1; k.fix_bios = 1; k.pal_bank = 0; k.sram_locked = 1; k.pbank = 0;
  k.vaddr = 0; k.vmod = 0; k.mode = 0; k.tmr_reload = 0; k.tmr_cnt = 0; k.tmr_run = 0; k.irq_p = 4; k.anim = 0; k.anim_div = 0; k.frame_no = 0;
  k.cyc = 0; k.rtc = blank; k.rtc.tp = 64; k.latch = 0; k.reply = 0; k.nmi_on = 0; k.nmi_pend = 0;
  k.zb[0] = 0x1E; k.zb[1] = 0x0E; k.zb[2] = 0x06; k.zb[3] = 0x02;
  k.zc = 0; k.ym_acc = 0; k.line = 0; k.cyc_debt = 0; k.wdog = 0;
  wram_.fill(0); zram_.fill(0);
  cpu_.reset(); z80_.reset(); ym_.reset(); update_irq();
}

/* ---- carregamento ---- */
void NeoGeoMachine::set_bios(const Bios& b) {
  if (!b.bios.empty()) {
    bios_.assign(0x20000, 0);
    std::memcpy(bios_.data(), b.bios.data(), std::min<std::size_t>(0x20000, b.bios.size()));
    if (b.bios.size() < 0x20000) for (std::size_t o = b.bios.size(); o < 0x20000; o += b.bios.size()) std::memcpy(bios_.data() + o, b.bios.data(), std::min(b.bios.size(), 0x20000 - o));
    has_bios_ = true;
  }
  if (!b.sfix.empty()) sfix_ = b.sfix;
  if (!b.zoom.empty()) zoom_ = b.zoom;
  if (!b.sm1.empty()) sm1_ = b.sm1;
}

bool NeoGeoMachine::load_set(Set&& set, std::string* err) {
  if (!has_bios_) { if (err) *err = "Falta a BIOS do Neo Geo."; return false; }
  p_ = std::move(set.p); s_ = std::move(set.s);
  m1_ = !set.m1.empty() ? std::move(set.m1) : (!sm1_.empty() ? sm1_ : std::vector<std::uint8_t>(0x10000, 0));
  ym_.set_rom(std::move(set.v));
  spr1_ = !set.c1.empty() ? std::move(set.c1) : std::vector<std::uint8_t>(64, 0);
  spr2_ = !set.c2.empty() ? std::move(set.c2) : std::vector<std::uint8_t>(64, 0);
  n_tiles_ = static_cast<std::uint32_t>(std::max<std::size_t>(1, std::min(spr1_.size(), spr2_.size()) >> 6));
  if (p_.size() < 2) p_.resize(2, 0);
  std::uint32_t h = 0;
  for (std::size_t i = 0; i < std::min<std::size_t>(p_.size(), 65536); i++) h = h * 31 + p_[i];
  rom_hash_ = h;
  reset();
  loaded_ = true;
  return true;
}

bool NeoGeoMachine::parse_bios(const std::vector<File>& files, Bios& out, std::string* err) {
  auto nm = [](const File& f) { return base_of(f.name); };
  const File* bios = nullptr;
  static const char* names[] = {"neo-geo.rom", "sp-s2.sp1", "sp-s3.sp1", "sp-s.sp1", "sp-u2.sp1", "sp-e.sp1", "sp-45.sp1", "uni-bios_4_0.rom", "uni-bios_3_3.rom", "neo-epo.bin", "neo-po.bin", "japan-j3.bin", "vs-bios.rom"};
  for (const char* n : names) {
    for (const File& f : files) if (nm(f) == n && f.data.size() >= 0x20000) { bios = &f; break; }
    if (bios) break;
  }
  if (!bios) {
    for (const File& f : files) {
      const std::string n = nm(f);
      if (f.data.size() == 0x20000 && !has_sub(n, "sfix") && !has_sub(n, "sm1") && !has_sub(n, "lo.lo") && !has_sub(n, "zoom") && !has_sub(n, "ng-lo")) { bios = &f; break; }
    }
  }
  const File *sf = nullptr, *lo = nullptr, *sm = nullptr;
  for (const File& f : files) { const std::string n = nm(f); if (n == "sfix.sfix" || n == "sfix.sfx" || n == "ng-sfix.rom") { sf = &f; break; } }
  if (!sf) for (const File& f : files) { const std::string n = nm(f); if (starts(n, "sfix") || starts(n, "ng-sfix")) { sf = &f; break; } }
  for (const File& f : files) { const std::string n = nm(f); if (has_sub(n, "000-lo.lo") || has_sub(n, "lo.lo") || has_sub(n, "zoom") || n == "ng-lo.rom") { lo = &f; break; } }
  for (const File& f : files) { const std::string n = nm(f); if (starts(n, "sm1") || starts(n, "ng-sm1")) { sm = &f; break; } }
  if (!bios) { if (err) *err = "Não achei a BIOS do Neo Geo no arquivo (procurei sp-s2.sp1, uni-bios, neo-epo.bin...). Use o neogeo.zip."; return false; }
  std::vector<std::uint8_t> b = bios->data;
  auto vec = [](const std::vector<std::uint8_t>& x) { return (static_cast<std::uint32_t>(x[4]) << 24) | (x[5] << 16) | (x[6] << 8) | x[7]; };
  if ((vec(b) >> 20) != 0xC) {   // BIOS com bytes trocados (dump antigo)
    std::vector<std::uint8_t> t = b;
    for (std::size_t i = 0; i + 1 < t.size(); i += 2) { t[i] = b[i + 1]; t[i + 1] = b[i]; }
    if ((vec(t) >> 20) == 0xC) b = t;
  }
  out.bios = b;
  out.sfix = sf ? sf->data : std::vector<std::uint8_t>();
  out.zoom = lo ? lo->data : std::vector<std::uint8_t>();
  out.sm1 = sm ? sm->data : std::vector<std::uint8_t>();
  return true;
}

bool NeoGeoMachine::parse_mame(const std::vector<File>& files, Set& out, std::string* err) {
  auto grp = [&](char ch) {
    std::vector<const File*> v;
    for (const File& f : files) if (ext_is(ext_of(base_of(f.name)), ch)) v.push_back(&f);
    std::stable_sort(v.begin(), v.end(), [](const File* a, const File* b) { return num_of(ext_of(base_of(a->name))) < num_of(ext_of(base_of(b->name))); });
    return v;
  };
  auto cat = [](const std::vector<const File*>& l) { std::vector<std::uint8_t> o; for (auto* f : l) o.insert(o.end(), f->data.begin(), f->data.end()); return o; };
  const auto pl = grp('p'), cl = grp('c');
  for (const File& f : files) {
    const std::string b = base_of(f.name), e = ext_of(b);
    if (has_sub(b, "sma") && !(ext_is(e, 'p') || ext_is(e, 'c') || ext_is(e, 's') || ext_is(e, 'm') || ext_is(e, 'v'))) {
      if (err) *err = "Este jogo usa o chip SMA (ROM criptografada), ainda não suportado no núcleo nativo. Use um arquivo .neo.";
      return false;
    }
  }
  if (pl.empty()) { if (err) *err = "Este ZIP não tem a ROM de programa (.p1). Use um conjunto de ROM do Neo Geo no formato MAME."; return false; }
  if (cl.empty()) { if (err) *err = "Este ZIP não tem as ROMs de gráficos (.c1, .c2...)."; return false; }
  Set o;
  o.s = cat(grp('s')); o.m1 = cat(grp('m')); o.v = cat(grp('v'));
  for (std::size_t i = 0; i < cl.size(); i++) { auto& dst = (i & 1) ? o.c2 : o.c1; dst.insert(dst.end(), cl[i]->data.begin(), cl[i]->data.end()); }
  o.p = cat(pl);
  auto magic = [&](std::size_t at) { std::string m; for (int i = 0; i < 7; i++) m += at + i < o.p.size() ? static_cast<char>(o.p[at + i]) : '\0'; return m; };
  if (magic(0x100) != "NEO-GEO" && magic(0x100)[0] == 'E') for (std::size_t i = 0; i + 1 < o.p.size(); i += 2) std::swap(o.p[i], o.p[i + 1]);   // ROM com bytes trocados
  auto hdr_file = [&]() { for (int k = 0; k < 7; k++) { if (0x100 + (k ^ 1) >= static_cast<int>(o.p.size()) || o.p[0x100 + (k ^ 1)] != static_cast<std::uint8_t>("NEO-GEO"[k])) return false; } return true; };
  if (o.p.size() >= 0x800000 && magic(0x100) != "NEO-GEO" && !hdr_file()) {
    if (err) *err = "Esta ROM de programa é criptografada (chip PVC), ainda não suportada no núcleo nativo. Use um arquivo .neo.";
    return false;
  }
  if (o.p.size() == 0x600000 && magic(0x100) != "NEO-GEO") {
    if (err) *err = "Esta ROM de programa é criptografada (KOF 98), ainda não suportada no núcleo nativo. Use um arquivo .neo.";
    return false;
  }
  out = std::move(o);
  return true;
}

bool NeoGeoMachine::is_neo(const std::uint8_t* d, std::size_t n) { return n > 4096 && d[0] == 0x4E && d[1] == 0x45 && d[2] == 0x4F && d[3] == 1; }
bool NeoGeoMachine::parse_neo(const std::uint8_t* d, std::size_t n, Set& out, std::string* err) {
  if (!is_neo(d, n)) { if (err) *err = "Arquivo .neo inválido."; return false; }
  std::uint32_t sz[6];
  std::uint64_t total = 4096;
  for (int i = 0; i < 6; i++) { std::memcpy(&sz[i], d + 4 + i * 4, 4); total += sz[i]; }
  if (total > n) { if (err) *err = "Arquivo .neo truncado."; return false; }
  std::size_t o = 4096;
  auto take = [&](std::uint32_t len) { std::vector<std::uint8_t> r(d + o, d + o + len); o += len; return r; };
  Set s;
  const auto p0 = take(sz[0]);
  s.p.resize(p0.size());
  for (std::size_t i = 0; i + 1 < p0.size(); i += 2) { s.p[i] = p0[i + 1]; s.p[i + 1] = p0[i]; }
  s.s = take(sz[1]); s.m1 = take(sz[2]);
  s.v = take(sz[3]); { auto v2 = take(sz[4]); s.v.insert(s.v.end(), v2.begin(), v2.end()); }
  const auto c = take(sz[5]);
  s.c1.resize(c.size() >> 1); s.c2.resize(c.size() >> 1);
  for (std::size_t i = 0; i < s.c1.size(); i++) { s.c1[i] = c[i * 2]; s.c2[i] = c[i * 2 + 1]; }
  std::string name;
  for (int i = 38; i < 71 && d[i]; i++) name += static_cast<char>(d[i]);
  while (!name.empty() && std::isspace(static_cast<unsigned char>(name.back()))) name.pop_back();
  s.name = name;
  out = std::move(s);
  return true;
}

void NeoGeoMachine::sram_restore(const std::uint8_t* d, std::size_t n) { std::memcpy(sram_.data(), d, std::min(n, sram_.size())); }

bool NeoGeoMachine::parse_cheats(const std::string& text, std::vector<Cheat>& out, std::string* err) {
  auto fail = [&](const std::string& m) { if (err) *err = m; return false; };
  std::vector<Cheat> ops;
  std::string line;
  auto flush = [&]() -> bool {
    std::size_t b = 0, e = line.size();
    while (b < e && std::isspace(static_cast<unsigned char>(line[b]))) b++;
    while (e > b && std::isspace(static_cast<unsigned char>(line[e - 1]))) e--;
    const std::string s = line.substr(b, e - b);
    line.clear();
    if (s.empty()) return true;
    const std::size_t sep = s.find_first_of(" :=");
    auto hex = [](const std::string& x) { for (char c : x) if (!std::isxdigit(static_cast<unsigned char>(c))) return false; return !x.empty(); };
    if (sep == std::string::npos) return fail("Formato não reconhecido: \"" + s + "\". Use endereço:valor (ex.: 10A1C4:09).");
    const std::string a = s.substr(0, sep);
    std::size_t vb = sep + 1;
    while (vb < s.size() && (s[vb] == ' ' || s[vb] == ':' || s[vb] == '=')) vb++;
    const std::string v = s.substr(vb);
    if (a.size() != 6 || !hex(a) || !hex(v) || (v.size() != 2 && v.size() != 4)) return fail("Formato não reconhecido: \"" + s + "\". Use endereço:valor (ex.: 10A1C4:09).");
    const std::uint32_t addr = static_cast<std::uint32_t>(std::strtoul(a.c_str(), nullptr, 16));
    if (addr < 0x100000 || addr >= 0x110000) return fail("Só dá para alterar a RAM de trabalho (100000 a 10FFFF).");
    ops.push_back(Cheat{addr, static_cast<std::uint32_t>(std::strtoul(v.c_str(), nullptr, 16)), static_cast<std::uint8_t>(v.size() >> 1)});
    return true;
  };
  for (char ch : text) { if (ch == '\n' || ch == ',' || ch == ';') { if (!flush()) return false; } else line += ch; }
  if (!flush()) return false;
  if (ops.empty()) return fail("Digite um código.");
  out = ops;
  return true;
}

/* ---- 68000: leituras ---- */
std::uint32_t NeoGeoMachine::p16(std::uint32_t a) const {
  a %= static_cast<std::uint32_t>(std::max<std::size_t>(2, p_.size()));
  return (static_cast<std::uint32_t>(p_[a]) << 8) | p_[a + 1 < p_.size() ? a + 1 : 0];
}
std::uint32_t NeoGeoMachine::r8(std::uint32_t a) { return (r16(a & 0xFFFFFE) >> ((a & 1) ? 0 : 8)) & 255; }
std::uint32_t NeoGeoMachine::r16(std::uint32_t a) {
  a &= 0xFFFFFF;
  switch (a >> 20) {
    case 0:
      if (a < 0x80 && k_.vec_bios) return (static_cast<std::uint32_t>(bios_[a]) << 8) | bios_[a + 1];
      return p16(a);
    case 1: { const std::uint32_t o = a & 0xFFFE; return (static_cast<std::uint32_t>(wram_[o]) << 8) | wram_[o + 1]; }
    case 2: return p16(0x100000 + static_cast<std::uint32_t>(k_.pbank) * 0x100000 + (a & 0xFFFFF));
    case 3: return io_read(a);
    case 4: case 5: case 6: case 7: return pal_[k_.pal_bank][(a & 0x1FFE) >> 1];
    case 8: case 9: case 10: case 11: return 0xFFFF;
    case 12: { const std::uint32_t o = a & 0x1FFFE; return (static_cast<std::uint32_t>(bios_[o]) << 8) | bios_[o + 1]; }
    case 13: { const std::uint32_t o = a & 0xFFFE; return (static_cast<std::uint32_t>(sram_[o]) << 8) | sram_[o + 1]; }
    default: return 0xFFFF;
  }
}
std::uint32_t NeoGeoMachine::io_read(std::uint32_t a) {
  switch ((a >> 16) & 15) {
    case 0: if (a & 0x80) return 0xFF80 | 0x7F; return (joy(0) << 8) | 0xFF;
    case 2: return (static_cast<std::uint32_t>(k_.reply) << 8) | coin();
    case 4: return (joy(1) << 8) | 0xFF;
    case 8: return 0xFF00 | sys_in();
    case 12: return lspc_read((a >> 1) & 7);
    default: return 0xFFFF;
  }
}
std::uint32_t NeoGeoMachine::joy(int n) const {
  const std::uint32_t b = buttons_[n]; std::uint32_t r = 0xFF;
  if (b & 16) r &= ~1u;
  if (b & 32) r &= ~2u;
  if (b & 64) r &= ~4u;
  if (b & 128) r &= ~8u;
  if (b & 1) r &= ~16u;
  if (b & 2) r &= ~32u;
  if (b & 256) r &= ~64u;
  if (b & 512) r &= ~128u;
  return r;
}
std::uint32_t NeoGeoMachine::coin() {
  std::uint32_t r = 0x3F;
  if (buttons_[0] & 4) r &= ~1u;
  const Rtc& t = k_.rtc;
  const double q = std::floor(k_.cyc / (12000000.0 / (2 * t.tp)));
  if (static_cast<std::int64_t>(q) & 1) r |= 0x40;   // TP: onda quadrada na frequência escolhida
  if (t.reg_len && t.reg[0]) r |= 0x80;              // saída de dados do relógio
  return r;
}
/* uPD4990A (relógio): bits do porto 380051: 0 = dados, 1 = clock, 2 = strobe */
void NeoGeoMachine::rtc_ctl(std::uint32_t v) {
  Rtc& t = k_.rtc;
  const std::int32_t di = v & 1, clk = (v >> 1) & 1, stb = (v >> 2) & 1;
  if (clk && !t.clk) {   // borda de subida do clock
    t.cmd_shift = ((t.cmd_shift >> 1) | (di << 3)) & 15;
    if (t.mode == 1 && t.reg_len) { std::memmove(t.reg, t.reg + 1, 47); t.reg[47] = static_cast<std::uint8_t>(di); }
  }
  if (stb && !t.stb) {   // strobe: executa o comando
    const int c = t.cmd_shift;
    if (c == 0) t.mode = 0;
    else if (c == 1) t.mode = 1;
    else if (c == 3) { t.mode = 0; rtc_time(); }
    else if (c >= 4 && c <= 7) { static const double tp[4] = {64, 256, 2048, 4096}; t.tp = tp[c - 4]; }
    else if (c >= 8 && c <= 11) { static const double tp[4] = {1, 0.1, 1.0 / 30, 1.0 / 60}; t.tp = tp[c - 8] * (c == 8 ? 1 : 10); }
  }
  t.clk = clk; t.stb = stb;
}
void NeoGeoMachine::rtc_time() {   // 48 bits, menos significativo primeiro: seg, min, hora, dia (BCD), dia da semana e mês (4 bits), ano (BCD)
  std::time_t now = std::time(nullptr);
  std::tm d{};
#ifdef _WIN32
  localtime_s(&d, &now);
#else
  localtime_r(&now, &d);
#endif
  Rtc& t = k_.rtc;
  int n = 0;
  auto bcd = [](int x) { return ((x / 10) << 4) | (x % 10); };
  auto put = [&](int v, int bits) { for (int i = 0; i < bits; i++) t.reg[n++] = static_cast<std::uint8_t>((v >> i) & 1); };
  put(bcd(d.tm_sec), 8); put(bcd(d.tm_min), 8); put(bcd(d.tm_hour), 8); put(bcd(d.tm_mday), 8);
  put(d.tm_wday, 4); put(d.tm_mon + 1, 4); put(bcd((d.tm_year + 1900) % 100), 8);
  t.reg_len = 48;
}
std::uint32_t NeoGeoMachine::sys_in() const {
  const std::uint32_t b = buttons_[0], c = buttons_[1]; std::uint32_t r = 0xFF;
  if (b & 8) r &= ~1u;
  if (b & 4) r &= ~2u;
  if (c & 8) r &= ~4u;
  if (c & 4) r &= ~8u;
  return r;
}

/* ---- 68000: escritas ---- */
void NeoGeoMachine::w8(std::uint32_t a, std::uint32_t v) {
  a &= 0xFFFFFF;
  const std::uint32_t g = a >> 20;
  if (g == 1) { wram_[a & 0xFFFF] = static_cast<std::uint8_t>(v); return; }
  if (g == 13) { if (!k_.sram_locked) sram_[a & 0xFFFF] = static_cast<std::uint8_t>(v); return; }
  if (g == 2) { if (a >= 0x2FFFF0) k_.pbank = v & 0xFF; return; }
  if (g == 3) {
    const std::uint32_t r = (a >> 16) & 15;
    if (r == 2 && !(a & 1)) { k_.latch = static_cast<std::int32_t>(v); k_.nmi_pend = 1; if (k_.nmi_on) z80_.regs().nmi = 1; return; }   // comando de som
    if (r == 8 && (a & 1) && (a & 0xFFFF) == 0x51) { rtc_ctl(v); return; }
    if (r == 10 && (a & 1)) { sys_ctl(a & 0x1F); return; }
    if (r == 12) { lspc_write((a >> 1) & 7, (a & 1) ? v : v << 8); return; }
    return;
  }
  if (g >= 4 && g <= 7) {
    const std::uint32_t i = (a & 0x1FFE) >> 1, w = pal_[k_.pal_bank][i];
    set_pal(static_cast<int>(i), (a & 1) ? (w & 0xFF00) | v : (w & 0x00FF) | (v << 8));
  }
}
void NeoGeoMachine::w16(std::uint32_t a, std::uint32_t v) {
  a &= 0xFFFFFF;
  switch (a >> 20) {
    case 1: { const std::uint32_t o = a & 0xFFFE; wram_[o] = static_cast<std::uint8_t>(v >> 8); wram_[o + 1] = static_cast<std::uint8_t>(v); return; }
    case 2: if (a >= 0x2FFFF0) k_.pbank = v & 0xFF; return;   // troca de banco da ROM de programa
    case 3: {
      const std::uint32_t r = (a >> 16) & 15;
      if (r == 12) lspc_write((a >> 1) & 7, v);
      else if (r == 2) { k_.latch = static_cast<std::int32_t>(v >> 8); k_.nmi_pend = 1; if (k_.nmi_on) z80_.regs().nmi = 1; }
      else if (r == 10) sys_ctl((a & 0x1F) | 1);
      return;
    }
    case 4: case 5: case 6: case 7: set_pal(static_cast<int>((a & 0x1FFE) >> 1), v); return;
    case 13: if (!k_.sram_locked) { const std::uint32_t o = a & 0xFFFE; sram_[o] = static_cast<std::uint8_t>(v >> 8); sram_[o + 1] = static_cast<std::uint8_t>(v); } return;
    default: return;
  }
}
void NeoGeoMachine::sys_ctl(std::uint32_t r) {
  switch (r) {
    case 0x03: k_.vec_bios = 1; break; case 0x13: k_.vec_bios = 0; break;
    case 0x0B: k_.fix_bios = 1; break; case 0x1B: k_.fix_bios = 0; break;
    case 0x0D: k_.sram_locked = 1; break; case 0x1D: k_.sram_locked = 0; break;
    case 0x0F: k_.pal_bank = 1; break; case 0x1F: k_.pal_bank = 0; break;
    default: break;
  }
}
void NeoGeoMachine::set_pal(int i, std::uint32_t v) {
  const int bk = k_.pal_bank;
  pal_[bk][i] = static_cast<std::uint16_t>(v);
  const std::uint32_t dark = (v >> 15) & 1, r = (((v >> 8) & 15) << 1) | ((v >> 14) & 1), g = (((v >> 4) & 15) << 1) | ((v >> 13) & 1), b = ((v & 15) << 1) | ((v >> 12) & 1);
  auto c = [&](std::uint32_t x) { const std::uint32_t c6 = (x << 1) | (dark ? 0 : 1); return (c6 << 2) | (c6 >> 4); };
  pcache_[bk][i] = 0xFF000000u | (c(b) << 16) | (c(g) << 8) | c(r);
}

/* ---- LSPC ---- */
static inline std::uint32_t vidx(std::uint32_t a) { return a < 0x8000 ? a : 0x8000 | (a & 0x7FF); }
std::uint32_t NeoGeoMachine::lspc_read(int r) {
  switch (r) {
    case 0: case 1: return vram_[vidx(static_cast<std::uint32_t>(k_.vaddr))];
    case 2: return static_cast<std::uint32_t>(k_.vmod) & 0xFFFF;
    case 3: return (((static_cast<std::uint32_t>(k_.line + 0xF8) & 0x1FF) << 7) | (static_cast<std::uint32_t>(k_.anim) & 7)) & 0xFFFF;
    default: return 0xFFFF;
  }
}
void NeoGeoMachine::lspc_write(int r, std::uint32_t v) {
  v &= 0xFFFF;
  Sys& k = k_;
  switch (r) {
    case 0: k.vaddr = static_cast<std::int32_t>(v); break;
    case 1: vram_[vidx(static_cast<std::uint32_t>(k.vaddr))] = static_cast<std::uint16_t>(v);
      k.vaddr = static_cast<std::int32_t>((static_cast<std::uint32_t>(k.vaddr) & 0x8000) | ((static_cast<std::uint32_t>(k.vaddr) + static_cast<std::uint32_t>(k.vmod)) & 0x7FFF)); break;
    case 2: k.vmod = static_cast<std::int16_t>(v); break;
    case 3: k.mode = static_cast<std::int32_t>(v); break;
    case 4: k.tmr_reload = static_cast<std::int32_t>((static_cast<std::uint32_t>(k.tmr_reload) & 0xFFFF) | (v << 16)); break;
    case 5:
      k.tmr_reload = static_cast<std::int32_t>((static_cast<std::uint32_t>(k.tmr_reload) & 0xFFFF0000u) | v);
      if (k.mode & 0x40) { k.tmr_cnt = k.tmr_reload; k.tmr_run = 1; }
      break;
    case 6:
      if (v & 1) k.irq_p &= ~4;
      if (v & 2) k.irq_p &= ~2;
      if (v & 4) k.irq_p &= ~1;
      update_irq(); break;
    default: break;
  }
}
void NeoGeoMachine::update_irq() { cpu_.set_irq((k_.irq_p & 4) ? 3 : (k_.irq_p & 2) ? 2 : (k_.irq_p & 1) ? 1 : 0); }

/* ---- Z80 ---- */
std::uint8_t NeoGeoMachine::read(std::uint16_t a) {
  const std::size_t n = m1_.size();
  const Sys& k = k_;
  if (a < 0x8000) return m1_[a % n];
  if (a < 0xC000) return m1_[((static_cast<std::size_t>(k.zb[0]) << 14) + (a - 0x8000)) % n];
  if (a < 0xE000) return m1_[((static_cast<std::size_t>(k.zb[1]) << 13) + (a - 0xC000)) % n];
  if (a < 0xF000) return m1_[((static_cast<std::size_t>(k.zb[2]) << 12) + (a - 0xE000)) % n];
  if (a < 0xF800) return m1_[((static_cast<std::size_t>(k.zb[3]) << 11) + (a - 0xF000)) % n];
  return zram_[a & 0x7FF];
}
void NeoGeoMachine::write(std::uint16_t a, std::uint8_t v) { if (a >= 0xF800) zram_[a & 0x7FF] = v; }
std::uint8_t NeoGeoMachine::port_in(int p) {
  const int lo = p & 0xFF, hi = (p >> 8) & 0xFF;
  if (lo == 0) { k_.nmi_pend = 0; return static_cast<std::uint8_t>(k_.latch); }
  if (lo >= 4 && lo <= 7) return static_cast<std::uint8_t>(ym_.read(lo - 4));
  if (lo >= 8 && lo <= 11) { k_.zb[11 - lo] = hi; return 0; }   // 08: 2K em F000, 09: 4K em E000, 0A: 8K em C000, 0B: 16K em 8000
  return 0;
}
void NeoGeoMachine::port_out(int p, int v) {
  const int lo = p & 0xFF;
  if (lo == 0) { k_.nmi_pend = 0; z80_.regs().nmi = 0; }
  else if (lo >= 4 && lo <= 7) ym_.write(lo - 4, static_cast<std::uint32_t>(v));
  else if (lo == 0x08) { k_.nmi_on = 1; if (k_.nmi_pend) z80_.regs().nmi = 1; }
  else if (lo == 0x0C) k_.reply = v;
  else if (lo == 0x18) k_.nmi_on = 0;
}

/* ---- quadro ---- */
bool NeoGeoMachine::run_frame() {
  if (!loaded_) return false;
  Sys& k = k_;
  for (int ln = 0; ln < static_cast<int>(kLines); ln++) {
    k.line = ln;
    if (ln == 0 && (k.mode & 0x10)) { k.tmr_cnt = k.tmr_reload; k.tmr_run = 1; }
    if (ln == 240) {
      k.irq_p |= 1; update_irq(); k.frame_no++;
      if (++k.anim_div > (k.mode >> 8)) { k.anim_div = 0; if (!(k.mode & 8)) k.anim++; }
    }
    k.cyc_debt += kCpl;
    while (k.cyc_debt > 0) { const int c = cpu_.step(); k.cyc_debt -= c; k.cyc += c; }
    k.zc += kZpl;
    while (k.zc > 0) {
      z80_.regs().irq_line = ym_.irq() ? 1 : 0;
      const int c = z80_.step(); k.zc -= c; k.ym_acc += c;
      while (k.ym_acc >= 72) { k.ym_acc -= 72; ym_.sample(); }
    }
    if (k.tmr_run) {
      k.tmr_cnt -= 384;
      if (k.tmr_cnt <= 0) {
        if (k.mode & 0x80) { k.irq_p |= 2; update_irq(); }
        if (k.mode & 0x20) k.tmr_cnt += k.tmr_reload ? k.tmr_reload : 384; else k.tmr_run = 0;
      }
    }
    if (ln >= 16 && ln < 240) render_line(ln - 16);
  }
  for (const Cheat& o : cheats_) {
    const std::uint32_t a = o.addr & 0xFFFF;
    if (o.size == 1) wram_[a] = static_cast<std::uint8_t>(o.val);
    else { wram_[a] = static_cast<std::uint8_t>(o.val >> 8); wram_[(a + 1) & 0xFFFF] = static_cast<std::uint8_t>(o.val); }
  }
  return true;
}

/* ---- renderização de uma linha ---- */
void NeoGeoMachine::render_line(int y) {
  std::uint32_t* lb = line_buf_;
  const std::uint32_t* pc = pcache_[k_.pal_bank].data();
  const std::uint16_t* vr = vram_.data();
  for (int i = 0; i < 320; i++) lb[i] = pc[0xFFF];
  // sprites
  const std::uint8_t* spr1 = spr1_.data(); const std::uint8_t* spr2 = spr2_.data();
  const std::uint32_t nT = n_tiles_;
  const int L = y + 16, anim = k_.anim;
  const bool has_zoom = zoom_.size() >= 0x10000;
  int x = 0, top = 0, h = 0, wpx = 16, count = 0;
  for (int n = 0; n < 381; n++) {
    const int yc = vr[0x8200 + n], sh = vr[0x8000 + n];
    if (yc & 0x40) x = (x + wpx) & 0x1FF;
    else { top = (0x200 - (yc >> 7)) & 0x1FF; h = yc & 0x3F; if (h > 32) h = 32; x = vr[0x8400 + n] >> 7; }
    const int hs = (sh >> 8) & 15, vs = sh & 255;
    wpx = hs + 1;
    if (!h) continue;
    const int ry = (L - top) & 0x1FF;
    int src;
    if (vs == 255) { if (ry >= h * 16) continue; src = ry; }
    else {
      const int vis = (h * 16 * (vs + 1)) >> 8;
      if (ry >= vis) continue;
      if (has_zoom) src = zoom_[(vs << 8) | (ry & 255)]; else src = (ry * 256 / (vs + 1));
      if (src >= h * 16) continue;
    }
    if (++count > 96) break;
    const int ti = src >> 4, row = src & 15, base = n * 64 + ti * 2;
    const std::uint32_t tn = vr[base], at = vr[base + 1];
    std::uint32_t tile = tn | (((at >> 4) & 15) << 16);
    if (at & 8) tile = (tile & ~3u) | (static_cast<std::uint32_t>(anim) & 3); else if (at & 4) tile = (tile & ~7u) | (static_cast<std::uint32_t>(anim) & 7);
    tile %= nT;
    const bool vf = (at & 2) != 0, hf = (at & 1) != 0;
    const int pal = (at >> 8) * 16, r2 = vf ? 15 - row : row;
    const std::size_t o = static_cast<std::size_t>(tile) * 64;
    for (int half = 0; half < 2; half++) {
      const std::size_t ro = o + (half == 0 ? 0 : 32) + (r2 >= 8 ? 16 : 0) + (r2 & 7) * 2;
      const int b0 = spr1[ro], b1 = spr1[ro + 1], b2 = spr2[ro], b3 = spr2[ro + 1];
      for (int px = 0; px < 8; px++) {
        const int bit = 7 - px, c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        if (!c) continue;
        int sxp = half * 8 + px;
        if (!hf) sxp = 15 - sxp;
        int dx = hs == 15 ? sxp : ((sxp * (hs + 1)) >> 4);
        dx = (x + dx) & 0x1FF;
        if (dx < 320) lb[dx] = pc[pal + c];
      }
    }
  }
  // camada fixa
  const std::vector<std::uint8_t>& fx = k_.fix_bios ? sfix_ : (s_.empty() ? sfix_ : s_);
  const std::size_t nF = std::max<std::size_t>(1, fx.size() >> 5);
  const int ry = (y >> 3) + 2, fy = y & 7;
  for (int col = 0; col < 40; col++) {
    const std::uint32_t w = vr[0x7000 + col * 32 + ry], t = static_cast<std::uint32_t>(((w & 0xFFF)) % nF), pal = (w >> 12) * 16;
    const std::size_t o0 = static_cast<std::size_t>(t) * 32 + fy;
    for (int k = 0; k < 4; k++) {
      const std::size_t idx = o0 + kFixOrd[k];
      const int b = idx < fx.size() ? fx[idx] : 0, lo = b & 15, hi = b >> 4, xp = col * 8 + k * 2;
      if (lo) lb[xp] = pc[pal + lo];
      if (hi) lb[xp + 1] = pc[pal + hi];
    }
  }
  std::memcpy(&frame_[static_cast<std::size_t>(y) * 320], lb, 320 * sizeof(std::uint32_t));
}

void NeoGeoMachine::state(StateIO& s) {
  s.v(cpu_.st());
  Z80Cpu::Regs zr = z80_.regs(); s.v(zr); if (!s.saving()) z80_.regs() = zr;
  ym_.state(s);
  s.v(k_);
  s.v(wram_); s.v(sram_); s.v(zram_); s.v(vram_); s.v(pal_[0]); s.v(pal_[1]);
  if (!s.saving() && s.ok()) {
    const int was = k_.pal_bank;
    for (int b = 0; b < 2; b++) { k_.pal_bank = b; for (int i = 0; i < 0x1000; i++) set_pal(i, pal_[b][i]); }
    k_.pal_bank = was;
    update_irq();
  }
}

}  // namespace emuhub
