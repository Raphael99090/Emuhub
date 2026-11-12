#include "snes_ppu.h"
#include <algorithm>
#include <cstring>
#include <vector>

namespace emuhub {
namespace {
const int kObjW[8][2] = {{8, 16}, {8, 32}, {8, 64}, {16, 32}, {16, 64}, {32, 64}, {16, 32}, {16, 32}};
const int kObjH[8][2] = {{8, 16}, {8, 32}, {8, 64}, {16, 32}, {16, 64}, {32, 64}, {32, 64}, {32, 32}};
constexpr int B(int l, int p) { return l * 4 + p; }
constexpr int O(int p) { return 4 * 4 + p; }
const int kOrd0[] = {O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), B(2, 1), B(3, 1), O(0), B(2, 0), B(3, 0)};
const int kOrd1[] = {O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), B(2, 1), O(0), B(2, 0)};
const int kOrd1p[] = {B(2, 1), O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), O(0), B(2, 0)};
const int kOrd2[] = {O(3), B(0, 1), O(2), B(1, 1), O(1), B(0, 0), O(0), B(1, 0)};
const int kOrd6[] = {O(3), B(0, 1), O(2), O(1), B(0, 0), O(0)};
const int kOrd7[] = {O(3), O(2), O(1), B(0, 0), O(0)};
const int kOrd7x[] = {O(3), O(2), B(1, 1), O(1), B(0, 0), O(0), B(1, 0)};
inline std::uint32_t px_of(int r, int g, int b) {
  return 0xFF000000u | (static_cast<std::uint32_t>((b << 3) | (b >> 2)) << 16) | (static_cast<std::uint32_t>((g << 3) | (g >> 2)) << 8) | static_cast<std::uint32_t>((r << 3) | (r >> 2));
}
}  // namespace

SnesPpu::SnesPpu() { reset(); }

void SnesPpu::reset() {
  vram_.fill(0); oam_.fill(0); cgram_.fill(0);
  inidisp_ = 0x80; obsel_ = 0; oam_addr_ = oam_int_ = oam_latch_ = 0; bgmode_ = mosaic_ = 0;
  for (int i = 0; i < 4; i++) { bgsc_[i] = bgnba_[i] = hofs_[i] = vofs_[i] = 0; }
  bg_latch_ = m7_latch_ = 0; vmain_ = vmaddr_ = vprefetch_ = 0; cgadd_ = cg_latch_ = cg_flip_ = 0;
  m7sel_ = 0; for (int& m : m7_) m = 0; m7x_ = m7y_ = m7hofs_ = m7vofs_ = mpy_ = 0;
  for (int& w : wsel_) w = 0; for (int& w : wh_) w = 0; wlog_[0] = wlog_[1] = 0;
  tm_ = ts_ = tmw_ = tsw_ = 0; cgwsel_ = cgadsub_ = fix_r_ = fix_g_ = fix_b_ = setini_ = 0;
  range_over_ = time_over_ = field_ = 0; no_limit_ = false;
  h_latch_ = v_latch_ = latch_flag_ = h_sel_ = v_sel_ = 0;
  std::memset(bgcol_, 0, sizeof bgcol_); std::memset(bgpri_, 0, sizeof bgpri_); std::memset(bgcol_s_, 0, sizeof bgcol_s_); std::memset(bgpri_s_, 0, sizeof bgpri_s_);
  std::memset(objcol_, 0, sizeof objcol_); std::memset(objpri_, 0, sizeof objpri_); std::memset(objmath_, 0, sizeof objmath_);
  std::memset(masks_, 0, sizeof masks_); std::memset(chr_px_, 0, sizeof chr_px_);
  fb_.fill(0xFF000000u); fb256_.fill(0xFF000000u); line_hires_.fill(0); out_w_ = 256; out_h_ = 224; frame_ = fb256_.data();
}

int SnesPpu::vram_addr() const {
  const int a = vmaddr_;
  switch ((vmain_ >> 2) & 3) {
    case 1: return (a & 0xFF00) | ((a & 0xE0) >> 5) | ((a & 0x1F) << 3);
    case 2: return (a & 0xFE00) | ((a & 0x1C0) >> 6) | ((a & 0x3F) << 2);
    case 3: return (a & 0xFC00) | ((a & 0x380) >> 7) | ((a & 0x7F) << 1);
    default: return a;
  }
}
void SnesPpu::vram_inc() { const int m = vmain_ & 3; vmaddr_ = (vmaddr_ + (m == 0 ? 1 : m == 1 ? 32 : 128)) & 0x7FFF; }
int SnesPpu::vram_word() const { const int a = (vram_addr() & 0x7FFF) << 1; return vram_[a] | (vram_[a + 1] << 8); }

std::uint8_t SnesPpu::read_reg(std::uint32_t r) {
  switch (r) {
    case 0x2134: return mpy_ & 0xFF; case 0x2135: return (mpy_ >> 8) & 0xFF; case 0x2136: return (mpy_ >> 16) & 0xFF;
    case 0x2137: h_latch_ = static_cast<int>((host_->host_cycles() >> 2) & 0x1FF); v_latch_ = host_->host_line(); latch_flag_ = 1; return static_cast<std::uint8_t>(host_->host_mdr());
    case 0x2138: { const int i = oam_int_, v = i >= 0x200 ? oam_[0x200 + (i & 0x1F)] : oam_[i]; oam_int_ = (i + 1) & 0x3FF; return v; }
    case 0x2139: { const int v = vprefetch_ & 0xFF; if (!(vmain_ & 0x80)) { vprefetch_ = vram_word(); vram_inc(); } return v; }
    case 0x213A: { const int v = vprefetch_ >> 8; if (vmain_ & 0x80) { vprefetch_ = vram_word(); vram_inc(); } return v; }
    case 0x213B: { const int c = cgram_[cgadd_]; if (!cg_flip_) { cg_flip_ = 1; return c & 0xFF; } cg_flip_ = 0; cgadd_ = (cgadd_ + 1) & 0xFF; return (c >> 8) & 0x7F; }
    case 0x213C: if (!h_sel_) { h_sel_ = 1; return h_latch_ & 0xFF; } h_sel_ = 0; return (h_latch_ >> 8) & 1;
    case 0x213D: if (!v_sel_) { v_sel_ = 1; return v_latch_ & 0xFF; } v_sel_ = 0; return (v_latch_ >> 8) & 1;
    case 0x213E: return 0x01 | (range_over_ ? 0x40 : 0) | (time_over_ ? 0x80 : 0);
    case 0x213F: h_sel_ = 0; v_sel_ = 0; latch_flag_ = 0; return 0x02 | (field_ ? 0x80 : 0);
  }
  return static_cast<std::uint8_t>(host_->host_mdr());
}

void SnesPpu::write_reg(std::uint32_t r, std::uint8_t v) {
  switch (r) {
    case 0x2100: inidisp_ = v; return;
    case 0x2101: obsel_ = v; return;
    case 0x2102: oam_addr_ = (oam_addr_ & 0x100) | v; oam_int_ = oam_addr_ << 1; return;
    case 0x2103: oam_addr_ = (oam_addr_ & 0xFF) | ((v & 1) << 8); oam_int_ = oam_addr_ << 1; return;
    case 0x2104: {
      const int i = oam_int_;
      if (i >= 0x200) oam_[0x200 + (i & 0x1F)] = v;
      else if (!(i & 1)) oam_latch_ = v;
      else { oam_[i - 1] = static_cast<std::uint8_t>(oam_latch_); oam_[i] = v; }
      oam_int_ = (i + 1) & 0x3FF; return;
    }
    case 0x2105: bgmode_ = v; return;
    case 0x2106: mosaic_ = v; return;
    case 0x2107: case 0x2108: case 0x2109: case 0x210A: bgsc_[r - 0x2107] = v; return;
    case 0x210B: bgnba_[0] = v & 15; bgnba_[1] = v >> 4; return;
    case 0x210C: bgnba_[2] = v & 15; bgnba_[3] = v >> 4; return;
    case 0x210D: m7hofs_ = sx13((v << 8) | m7_latch_); m7_latch_ = v; /* cai no BG1 */
    /* fallthrough */
    case 0x210F: case 0x2111: case 0x2113: {
      const int n = (r - 0x210D) >> 1; hofs_[n] = ((v << 8) | (bg_latch_ & ~7) | ((hofs_[n] >> 8) & 7)) & 0x3FF; bg_latch_ = v; return;
    }
    case 0x210E: m7vofs_ = sx13((v << 8) | m7_latch_); m7_latch_ = v;
    /* fallthrough */
    case 0x2110: case 0x2112: case 0x2114: {
      const int n = (r - 0x210E) >> 1; vofs_[n] = ((v << 8) | bg_latch_) & 0x3FF; bg_latch_ = v; return;
    }
    case 0x2115: vmain_ = v; return;
    case 0x2116: vmaddr_ = (vmaddr_ & 0x7F00) | v; vprefetch_ = vram_word(); return;
    case 0x2117: vmaddr_ = (vmaddr_ & 0xFF) | ((v & 0x7F) << 8); vprefetch_ = vram_word(); return;
    case 0x2118: { const int a = (vram_addr() & 0x7FFF) << 1; vram_[a] = v; if (!(vmain_ & 0x80)) vram_inc(); return; }
    case 0x2119: { const int a = (vram_addr() & 0x7FFF) << 1; vram_[a + 1] = v; if (vmain_ & 0x80) vram_inc(); return; }
    case 0x211A: m7sel_ = v; return;
    case 0x211B: case 0x211C: case 0x211D: case 0x211E: {
      m7_[r - 0x211B] = static_cast<std::int16_t>(static_cast<std::uint16_t>((v << 8) | m7_latch_)); m7_latch_ = v;
      if (r == 0x211B || r == 0x211C) mpy_ = static_cast<std::int32_t>(static_cast<std::int64_t>(m7_[0]) * static_cast<std::int8_t>((m7_[1] >> 8) & 0xFF));
      return;
    }
    case 0x211F: m7x_ = sx13((v << 8) | m7_latch_); m7_latch_ = v; return;
    case 0x2120: m7y_ = sx13((v << 8) | m7_latch_); m7_latch_ = v; return;
    case 0x2121: cgadd_ = v; cg_flip_ = 0; return;
    case 0x2122:
      if (!cg_flip_) { cg_latch_ = v; cg_flip_ = 1; }
      else { cgram_[cgadd_] = static_cast<std::uint16_t>(((v & 0x7F) << 8) | cg_latch_); cgadd_ = (cgadd_ + 1) & 0xFF; cg_flip_ = 0; }
      return;
    case 0x2123: wsel_[0] = v; return; case 0x2124: wsel_[1] = v; return; case 0x2125: wsel_[2] = v; return;
    case 0x2126: wh_[0] = v; return; case 0x2127: wh_[1] = v; return; case 0x2128: wh_[2] = v; return; case 0x2129: wh_[3] = v; return;
    case 0x212A: wlog_[0] = v; return; case 0x212B: wlog_[1] = v; return;
    case 0x212C: tm_ = v; return; case 0x212D: ts_ = v; return; case 0x212E: tmw_ = v; return; case 0x212F: tsw_ = v; return;
    case 0x2130: cgwsel_ = v; return; case 0x2131: cgadsub_ = v; return;
    case 0x2132:
      if (v & 0x20) fix_r_ = v & 31;
      if (v & 0x40) fix_g_ = v & 31;
      if (v & 0x80) fix_b_ = v & 31;
      return;
    case 0x2133: setini_ = v; return;
  }
}

int SnesPpu::bg3_entry(int c, int r) const {
  const int sc = bgsc_[2], wide = sc & 1, tall = sc & 2;
  int scr = 0; if (wide && (c & 32)) scr += 1; if (tall && (r & 32)) scr += wide ? 2 : 1;
  const int ea = ((((sc & 0xFC) << 8) + (scr << 10) + ((r & 31) << 5) + (c & 31)) & 0x7FFF) << 1;
  return vram_[ea] | (vram_[ea + 1] << 8);
}

void SnesPpu::render_bg(int n, int y, int bpp, int pal_base, std::uint8_t* col, std::uint8_t* pri) {
  const int sc = bgsc_[n], big = (bgmode_ >> (4 + n)) & 1;
  const int map_base = (sc & 0xFC) << 8, size = sc & 3, chr_base = bgnba_[n] << 12;
  const int mode = bgmode_ & 7; const bool opt = (mode == 2 || mode == 4 || mode == 6) && n < 2;
  int py0 = (y + vofs_[n]) & 0xFFFF;
  if ((mosaic_ >> n) & 1) { const int m = (mosaic_ >> 4) + 1; if (m > 1) py0 = (py0 - (y % m)) & 0xFFFF; }
  const int wide = size & 1, tall = size & 2, shift = big ? 4 : 3, tile_words = bpp * 4;
  const int hofs = hofs_[n], mask = n == 0 ? 0x2000 : 0x4000;
  int x = 0, ti = 0;
  const int planes = bpp >> 1;
  while (x < 256) {
    int wx = hofs + x, py = py0;
    if (opt && ti > 0) {
      const int c3 = ((hofs_[2] & ~7) >> 3) + ti - 1, r3 = vofs_[2] >> 3;
      if (mode == 4) {
        const int e = bg3_entry(c3, r3);
        if (e & mask) { if (e & 0x8000) py = (y + (e & 0x3FF)) & 0xFFFF; else wx = ((e & 0x3F8) | (hofs & 7)) + x; }
      } else {
        const int eh = bg3_entry(c3, r3), ev = bg3_entry(c3, r3 + 1);
        if (eh & mask) wx = ((eh & 0x3F8) | (hofs & 7)) + x;
        if (ev & mask) py = (y + (ev & 0x3FF)) & 0xFFFF;
      }
    }
    const int row = py >> 3, fine = py & 7, ty = py >> shift;
    const int col_n = wx >> 3, tcol = big ? col_n >> 1 : col_n, trow = big ? ty : row;
    int scr = 0; if (wide && (tcol & 32)) scr += 1; if (tall && (trow & 32)) scr += wide ? 2 : 1;
    const int ea = ((map_base + (scr << 10) + ((trow & 31) << 5) + (tcol & 31)) & 0x7FFF) << 1;
    const int ent = vram_[ea] | (vram_[ea + 1] << 8);
    int ch = ent & 0x3FF, f = fine;
    const int hf = ent & 0x4000, vf = ent & 0x8000;
    if (big) {
      int xs = col_n & 1, ys = row & 1;
      if (hf) xs ^= 1;
      if (vf) ys ^= 1;
      ch = (ch + xs + (ys << 4)) & 0x3FF;
    }
    if (vf) f = 7 - f;
    const int pal = (ent >> 10) & 7, pr = (ent >> 13) & 1;
    const int wa = (chr_base + ch * tile_words + f) & 0x7FFF;
    int b0 = vram_[wa << 1], b1 = vram_[(wa << 1) + 1], b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, b7 = 0;
    if (planes > 1) { const int w2 = (wa + 8) & 0x7FFF; b2 = vram_[w2 << 1]; b3 = vram_[(w2 << 1) + 1]; }
    if (planes > 2) { const int w3 = (wa + 16) & 0x7FFF, w4 = (wa + 24) & 0x7FFF; b4 = vram_[w3 << 1]; b5 = vram_[(w3 << 1) + 1]; b6 = vram_[w4 << 1]; b7 = vram_[(w4 << 1) + 1]; }
    const int px0 = wx & 7;
    const int base = bpp == 2 ? pal_base + pal * 4 : bpp == 4 ? pal * 16 : 0;
    for (int px = px0; px < 8 && x < 256; px++, x++) {
      const int bit = hf ? px : 7 - px;
      int v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
      if (planes > 1) v |= (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
      if (planes > 2) v |= (((b4 >> bit) & 1) << 4) | (((b5 >> bit) & 1) << 5) | (((b6 >> bit) & 1) << 6) | (((b7 >> bit) & 1) << 7);
      col[x] = static_cast<std::uint8_t>(v ? (bpp == 8 ? v : base + v) : 0); pri[x] = static_cast<std::uint8_t>(pr);
    }
    ti++;
  }
  if ((mosaic_ >> n) & 1) { const int m = (mosaic_ >> 4) + 1; if (m > 1) for (int i = 0; i < 256; i++) { const int s = i - (i % m); if (s != i) { col[i] = col[s]; pri[i] = pri[s]; } } }
}

void SnesPpu::decode_chr(int ch, int f, int bpp, int chr_base, bool hf, std::uint8_t* out) const {
  const int planes = bpp >> 1, tile_words = bpp * 4, wa = (chr_base + ch * tile_words + f) & 0x7FFF;
  const int b0 = vram_[wa << 1], b1 = vram_[(wa << 1) + 1];
  int b2 = 0, b3 = 0;
  if (planes > 1) { const int w2 = (wa + 8) & 0x7FFF; b2 = vram_[w2 << 1]; b3 = vram_[(w2 << 1) + 1]; }
  for (int px = 0; px < 8; px++) {
    const int bit = hf ? px : 7 - px;
    int v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
    if (planes > 1) v |= (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
    out[px] = static_cast<std::uint8_t>(v);
  }
}

void SnesPpu::render_bg_hires(int n, int y, int bpp, std::uint8_t* col, std::uint8_t* pri, std::uint8_t* col_s, std::uint8_t* pri_s) {
  const int sc = bgsc_[n], big = (bgmode_ >> (4 + n)) & 1;
  const int map_base = (sc & 0xFC) << 8, size = sc & 3, chr_base = bgnba_[n] << 12;
  const int wide = size & 1, tall = size & 2, mode = bgmode_ & 7; const bool opt = mode == 6 && n == 0;
  const bool il = (setini_ & 1) != 0;
  int yy = y;
  if ((mosaic_ >> n) & 1) { const int m = (mosaic_ >> 4) + 1; if (m > 1) yy = y - (y % m); }
  if (il) yy = (yy << 1) + field_;
  const int py0 = (yy + vofs_[n]) & 0xFFFF;
  const int hofs2 = (hofs_[n] << 1) & 0x7FF; std::uint8_t* px = chr_px_; const int mask = 0x2000;
  int i = 0, ti = 0;
  while (i < 512) {
    int bx = i + hofs2, py = py0;
    if (opt && ti > 0) {
      const int c3 = ((hofs_[2] & ~7) >> 3) + ti - 1, r3 = vofs_[2] >> 3, e = bg3_entry(c3, r3);
      if (e & mask) { if (e & 0x8000) py = (yy + (e & 0x3FF)) & 0xFFFF; else bx = (((e & 0x3F8) << 1) | (hofs2 & 15)) + i; }
    }
    const int tcol = (bx >> 4) & 63, trow = big ? py >> 4 : py >> 3;
    int scr = 0; if (wide && (tcol & 32)) scr += 1; if (tall && (trow & 32)) scr += wide ? 2 : 1;
    const int ea = ((map_base + (scr << 10) + ((trow & 31) << 5) + (tcol & 31)) & 0x7FFF) << 1;
    const int ent = vram_[ea] | (vram_[ea + 1] << 8);
    int ch = ent & 0x3FF, f = py & 7; const int hf = ent & 0x4000, vf = ent & 0x8000, pr = (ent >> 13) & 1, pal = (ent >> 10) & 7;
    if (big) { int ys = (py >> 3) & 1; if (vf) ys ^= 1; ch = (ch + (ys << 4)) & 0x3FF; }
    if (vf) f = 7 - f;
    const int pal_base = bpp == 2 ? pal * 4 : pal * 16;
    const int p16 = bx & 15;
    int half = -1;
    for (int k = p16; k < 16 && i < 512; k++, i++) {
      const int h = k >> 3;
      if (h != half) { half = h; decode_chr((ch + (hf ? 1 - h : h)) & 0x3FF, f, bpp, chr_base, hf != 0, px); }
      const int v = px[k & 7], c = v ? pal_base + v : 0;
      if (i & 1) { col[i >> 1] = static_cast<std::uint8_t>(c); pri[i >> 1] = static_cast<std::uint8_t>(pr); }
      else { col_s[i >> 1] = static_cast<std::uint8_t>(c); pri_s[i >> 1] = static_cast<std::uint8_t>(pr); }
    }
    ti++;
  }
  if ((mosaic_ >> n) & 1) {
    const int m = (mosaic_ >> 4) + 1;
    if (m > 1) for (int x = 0; x < 256; x++) { const int s0 = x - (x % m); if (s0 != x) { col[x] = col[s0]; pri[x] = pri[s0]; col_s[x] = col_s[s0]; pri_s[x] = pri_s[s0]; } }
  }
}

void SnesPpu::render_mode7(int y, std::uint8_t* col, std::uint8_t* pri) {
  const int a = m7_[0], b = m7_[1], c = m7_[2], d = m7_[3];
  auto clip = [](int n) { return (n & 0x2000) ? (n | ~1023) : (n & 1023); };
  const int cx = m7x_, cy = m7y_, ox = clip(m7hofs_ - cx), oy = clip(m7vofs_ - cy);
  const int yy = (m7sel_ & 2) ? 255 - y : y;
  const int x0 = ((a * ox) & ~63) + ((b * oy) & ~63) + ((b * yy) & ~63) + (cx << 8);
  const int y0 = ((c * ox) & ~63) + ((d * oy) & ~63) + ((d * yy) & ~63) + (cy << 8);
  const int flip_x = m7sel_ & 1, mode = m7sel_ >> 6;
  for (int x = 0; x < 256; x++) {
    const int xx = flip_x ? 255 - x : x;
    const int px = (x0 + a * xx) >> 8, py = (y0 + c * xx) >> 8;
    int v;
    auto tile_px = [&](int tile) { return vram_[(((tile * 64) + ((py & 7) * 8 + (px & 7))) << 1) + 1]; };
    if ((px | py) & ~1023) {
      if (mode == 2) { col[x] = 0; pri[x] = 0; continue; }
      if (mode == 3) v = vram_[(((0) * 64 + ((py & 7) * 8 + (px & 7))) << 1) + 1];
      else v = tile_px(vram_[((((py >> 3) & 127) << 7) + ((px >> 3) & 127)) << 1]);
    } else v = tile_px(vram_[((((py >> 3) & 127) << 7) + ((px >> 3) & 127)) << 1]);
    col[x] = static_cast<std::uint8_t>(v); pri[x] = 0;
  }
}

void SnesPpu::render_objs(int y) {
  std::uint8_t* oc = objcol_; std::uint8_t* op = objpri_; std::uint8_t* om = objmath_;
  std::memset(oc, 0, 256); std::memset(op, 255, 256);
  const int sel = obsel_ >> 5, small = kObjW[sel][0], large = kObjW[sel][1];
  const int base_w = (obsel_ & 7) << 13, gap_w = (((obsel_ >> 3) & 3) + 1) << 12;
  std::vector<int> list;
  for (int i = 0; i < 128; i++) {
    const int hi = (oam_[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2;
    const int w = big ? large : small, h = kObjH[sel][big ? 1 : 0];
    const int sy = oam_[i * 4 + 1], dy = (y - sy - 1) & 0xFF;
    if (dy >= h) continue;
    int x = oam_[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
    if (x + w <= 0 || x >= 256) continue;
    if (list.size() >= 32) { range_over_ = 1; if (!no_limit_) break; }
    list.push_back(i);
  }
  int tiles = 0;
  std::vector<std::pair<int, int>> draw;
  for (std::size_t li = 0; li < list.size(); li++) {
    const int i = list[li], hi = (oam_[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2, w = big ? large : small;
    int x = oam_[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
    const int nt = w >> 3; int cnt = 0;
    for (int t = 0; t < nt; t++) { const int tx = x + t * 8; if (tx > -8 && tx < 256) cnt++; }
    if (!no_limit_ && tiles + cnt > 34) { time_over_ = 1; const int keep = 34 - tiles; draw.push_back({i, keep}); tiles = 34; break; }
    tiles += cnt; draw.push_back({i, 99});
  }
  for (int di = static_cast<int>(draw.size()) - 1; di >= 0; di--) {
    const int i = draw[di].first, keep = draw[di].second, hi = (oam_[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2;
    const int w = big ? large : small, h = kObjH[sel][big ? 1 : 0];
    const int attr = oam_[i * 4 + 3], tile = oam_[i * 4 + 2], pal = (attr >> 1) & 7, pr = (attr >> 4) & 3, hf = attr & 0x40, vf = attr & 0x80, name_sel = attr & 1;
    int x = oam_[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
    int dy = (y - oam_[i * 4 + 1] - 1) & 0xFF; if (vf) dy = h - 1 - dy;
    const int trow = dy >> 3, r = dy & 7, nt = w >> 3;
    int used = 0;
    for (int t = 0; t < nt; t++) {
      const int tx = x + t * 8; if (tx <= -8 || tx >= 256) continue;
      if (++used > keep) break;
      const int tcol = hf ? nt - 1 - t : t;
      const int ch = (((tile & 0xF0) + (trow << 4)) & 0xF0) | (((tile & 0x0F) + tcol) & 0x0F);
      const int wa = (base_w + (name_sel ? gap_w : 0) + (ch << 4) + r) & 0x7FFF;
      const int b0 = vram_[wa << 1], b1 = vram_[(wa << 1) + 1], w2 = (wa + 8) & 0x7FFF, b2 = vram_[w2 << 1], b3 = vram_[(w2 << 1) + 1];
      for (int px = 0; px < 8; px++) {
        const int sx = tx + px; if (sx < 0 || sx >= 256) continue;
        const int bit = hf ? px : 7 - px;
        const int v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        if (v) { oc[sx] = static_cast<std::uint8_t>(128 + pal * 16 + v); op[sx] = static_cast<std::uint8_t>(pr); om[sx] = pal >= 4 ? 1 : 0; }
      }
    }
  }
}

void SnesPpu::window_mask(int layer, std::uint8_t* out) const {
  const int ws = layer < 2 ? wsel_[0] >> (layer * 4) : layer < 4 ? wsel_[1] >> ((layer - 2) * 4) : layer == 4 ? wsel_[2] : wsel_[2] >> 4;
  const int lg = layer < 4 ? (wlog_[0] >> (layer * 2)) & 3 : layer == 4 ? wlog_[1] & 3 : (wlog_[1] >> 2) & 3;
  const int w1 = ws & 2, w2 = ws & 8; const bool i1 = (ws & 1) != 0, i2 = (ws & 4) != 0;
  const int l1 = wh_[0], r1 = wh_[1], l2 = wh_[2], r2 = wh_[3];
  for (int x = 0; x < 256; x++) {
    bool a = false, b = false, r;
    if (w1) a = (x >= l1 && x <= r1) != i1;
    if (w2) b = (x >= l2 && x <= r2) != i2;
    if (w1 && w2) r = lg == 0 ? (a || b) : lg == 1 ? (a && b) : lg == 2 ? (a != b) : (a == b);
    else if (w1) r = a; else if (w2) r = b; else r = false;
    out[x] = r ? 1 : 0;
  }
}

int SnesPpu::pick(int x, int en, int enw, const int* order, int order_n, std::uint8_t (*colors)[272], std::uint8_t (*pris)[272]) const {
  for (int k = 0; k < order_n; k++) {
    const int e = order[k], L = e >> 2, p = e & 3;
    if (!((en >> L) & 1)) continue;
    if (L == 4) { if (objpri_[x] != p) continue; if (((enw >> 4) & 1) && masks_[4][x]) continue; return ((objmath_[x] ? 4 : 6) << 16) | objcol_[x]; }
    if (!colors[L][x] || pris[L][x] != p) continue;
    if (((enw >> L) & 1) && masks_[L][x]) continue;
    return (L << 16) | colors[L][x];
  }
  return 5 << 16;
}

void SnesPpu::render_line(int y) {
  if (skip_) return;
  const bool interlace = (setini_ & 1) != 0; const int field = field_;
  const int mode = bgmode_ & 7; const bool hi_mode = mode == 5 || mode == 6, hires = hi_mode || (setini_ & 8) != 0;
  const int row = interlace ? (y << 1) + field : y, o = row * kStride;
  std::uint32_t* out = fb_.data();
  const int bright = inidisp_ & 15;
  line_hires_[row] = hires ? 1 : 0;
  if (inidisp_ & 0x80) {
    std::fill(out + o, out + o + 512, 0xFF000000u);
    if (interlace && !hires) { const int o2 = o + (field ? -512 : 512); std::fill(out + o2, out + o2 + 512, 0xFF000000u); line_hires_[row + (field ? -1 : 1)] = 0; }
    return;
  }
  const int tm = tm_, ts = ts_, need = tm | ts;
  static const int kBpps[8][4] = {{2, 2, 2, 2}, {4, 4, 2, 0}, {4, 4, 0, 0}, {8, 4, 0, 0}, {8, 2, 0, 0}, {4, 2, 0, 0}, {4, 0, 0, 0}, {0, 0, 0, 0}};
  const int* bpps = kBpps[mode];
  const bool ext = mode == 7 && (setini_ & 0x40) != 0;
  if (mode == 7) {
    if (need & (ext ? 3 : 1)) {
      std::uint8_t* c0 = bgcol_[0];
      render_mode7(y, c0, bgpri_[0]);
      if (ext && (need & 2)) { std::uint8_t* c1 = bgcol_[1]; std::uint8_t* p1 = bgpri_[1]; for (int i = 0; i < 256; i++) { const int v = c0[i]; c1[i] = static_cast<std::uint8_t>(v & 0x7F); p1[i] = static_cast<std::uint8_t>(v >> 7); } }
    }
  } else {
    for (int n = 0; n < 4; n++) {
      if (!bpps[n] || !((need >> n) & 1)) continue;
      if (hi_mode) render_bg_hires(n, y, bpps[n], bgcol_[n], bgpri_[n], bgcol_s_[n], bgpri_s_[n]);
      else render_bg(n, y, bpps[n], mode == 0 ? n * 32 : 0, bgcol_[n], bgpri_[n]);
    }
  }
  if (need & 0x10) render_objs(y);
  const int use_win = (tmw_ | tsw_) & 0x1F;
  for (int l = 0; l < 5; l++) if ((use_win >> l) & 1) window_mask(l, masks_[l]);
  const int cgw = cgwsel_, math_on = cgadsub_ & 0x3F;
  const bool need_color_win = (cgw & 0xF0) != 0;
  if (need_color_win) window_mask(5, masks_[5]);
  const int* order; int order_n;
  if (ext) { order = kOrd7x; order_n = 7; }
  else switch (mode) {
    case 0: order = kOrd0; order_n = 12; break;
    case 1: if (bgmode_ & 8) { order = kOrd1p; order_n = 10; } else { order = kOrd1; order_n = 10; } break;
    case 6: order = kOrd6; order_n = 6; break;
    case 7: order = kOrd7; order_n = 5; break;
    default: order = kOrd2; order_n = 8; break;
  }
  const std::uint16_t* cg = cgram_.data(); const int fixed = (fix_b_ << 10) | (fix_g_ << 5) | fix_r_;
  const bool add_sub = (cgw & 2) != 0, sub = (cgadsub_ & 0x80) != 0, half = (cgadsub_ & 0x40) != 0;
  std::uint8_t (*colors)[272] = bgcol_; std::uint8_t (*pris)[272] = bgpri_;
  std::uint8_t (*colors_s)[272] = hi_mode ? bgcol_s_ : bgcol_; std::uint8_t (*pris_s)[272] = hi_mode ? bgpri_s_ : bgpri_;
  const int tmw = tmw_, tsw = tsw_, cadd = cgadsub_;
  const int f = bright + 1; const bool bri = bright != 15;
  for (int x = 0; x < 256; x++) {
    const int mp = pick(x, tm, tmw, order, order_n, colors, pris), layer = mp >> 16;
    int c15 = cg[mp & 0xFF];
    int sp = -1;
    if (hires || (math_on && add_sub)) sp = pick(x, ts, tsw, order, order_n, colors_s, pris_s);
    if (math_on) {
      bool in_math = true, clip = false;
      if (need_color_win) {
        const int w = masks_[5][x], pm = (cgw >> 4) & 3, cm = (cgw >> 6) & 3;
        if (pm == 3 || (pm == 1 && !w) || (pm == 2 && w)) in_math = false;
        if (cm == 3 || (cm == 1 && !w) || (cm == 2 && w)) clip = true;
      }
      if (clip) c15 = 0;
      const int lbit = layer == 5 ? 5 : layer == 6 ? -1 : layer;
      if (in_math && lbit >= 0 && ((cadd >> lbit) & 1)) {
        int s15 = fixed; bool sub_layer = false;
        if (add_sub) { const int sl = sp >> 16; if (sl != 5) { s15 = cg[sp & 0xFF]; sub_layer = true; } }
        const bool h = half && (!add_sub || sub_layer);
        int mr = c15 & 31, mg = (c15 >> 5) & 31, mb = (c15 >> 10) & 31;
        const int sr = s15 & 31, sg = (s15 >> 5) & 31, sb = (s15 >> 10) & 31;
        if (sub) { mr -= sr; mg -= sg; mb -= sb; if (mr < 0) mr = 0; if (mg < 0) mg = 0; if (mb < 0) mb = 0; }
        else { mr += sr; mg += sg; mb += sb; }
        if (h) { mr >>= 1; mg >>= 1; mb >>= 1; }
        if (mr > 31) mr = 31; if (mg > 31) mg = 31; if (mb > 31) mb = 31;
        c15 = mr | (mg << 5) | (mb << 10);
      }
    }
    int R = c15 & 31, G = (c15 >> 5) & 31, Bl = (c15 >> 10) & 31;
    if (bri) { R = (R * f) >> 4; G = (G * f) >> 4; Bl = (Bl * f) >> 4; }
    const std::uint32_t px = px_of(R, G, Bl);
    if (hires) {
      const int s15 = (sp >> 16) != 5 ? cg[sp & 0xFF] : hi_mode ? cg[0] : fixed;
      int r2 = s15 & 31, g2 = (s15 >> 5) & 31, b2 = (s15 >> 10) & 31;
      if (bri) { r2 = (r2 * f) >> 4; g2 = (g2 * f) >> 4; b2 = (b2 * f) >> 4; }
      out[o + 2 * x] = px_of(r2, g2, b2);
      out[o + 2 * x + 1] = px;
    } else out[o + x] = px;
  }
  if (interlace && !hires) {
    const int o2 = o + (field ? -512 : 512);
    std::copy(out + o, out + o + 256, out + o2);  // regiões não se sobrepõem (linhas distintas)
    line_hires_[row + (field ? -1 : 1)] = 0;
  }
}

void SnesPpu::finish_frame() {
  const int lines = (setini_ & 4) ? 239 : 224; const bool il = (setini_ & 1) != 0; const int out_h = lines * (il ? 2 : 1);
  std::uint32_t* fb = fb_.data(); bool any = false;
  for (int r = 0; r < out_h; r++) if (line_hires_[r]) { any = true; break; }
  if (any) {
    for (int r = 0; r < out_h; r++) if (!line_hires_[r]) { const int o = r * 512; for (int x = 255; x >= 0; x--) { const std::uint32_t c = fb[o + x]; fb[o + 2 * x] = c; fb[o + 2 * x + 1] = c; } }
    frame_ = fb; out_w_ = 512;
  } else {
    std::uint32_t* f2 = fb256_.data();
    for (int r = 0; r < out_h; r++) std::copy(fb + r * 512, fb + r * 512 + 256, f2 + r * 256);
    frame_ = f2; out_w_ = 256;
  }
  out_h_ = out_h;
  if (il) field_ ^= 1; else field_ = 0;
}

}  // namespace emuhub
