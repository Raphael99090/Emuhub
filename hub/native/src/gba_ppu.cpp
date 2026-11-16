// Vídeo do GBA, uma scanline por vez (porte de hub/src/cores/gba/ppu.js).
// Modos 0-5, BGs de texto e afins, sprites (normais e rotacionados), janelas, alpha e brilho.
// Cores internas em 15 bits (BGR555); -1 significa transparente.
#include "gba_machine.h"
#include <algorithm>

namespace emuhub {

namespace {
const std::uint32_t* rgb_table() {
  static std::uint32_t t[32768];
  static bool init = false;
  if (!init) {
    for (std::uint32_t c = 0; c < 32768; c++) {
      std::uint32_t r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
      r = (r << 3) | (r >> 2); g = (g << 3) | (g >> 2); b = (b << 3) | (b >> 2);
      t[c] = 0xFF000000u | (b << 16) | (g << 8) | r;
    }
    init = true;
  }
  return t;
}
// índice = forma * 4 + tamanho; forma 0 quadrado, 1 horizontal, 2 vertical
const int kObjSizes[12][2] = {{8, 8}, {16, 16}, {32, 32}, {64, 64}, {16, 8}, {32, 8}, {32, 16}, {64, 32}, {8, 16}, {8, 32}, {16, 32}, {32, 64}};
inline std::int32_t s16(std::uint32_t v) { return static_cast<std::int16_t>(static_cast<std::uint16_t>(v)); }
inline std::uint32_t l16(const std::uint8_t* b, std::uint32_t byte_off) { std::uint16_t v; std::memcpy(&v, b + byte_off, 2); return v; }
inline std::uint32_t l32(const std::uint8_t* b, std::uint32_t byte_off) { std::uint32_t v; std::memcpy(&v, b + byte_off, 4); return v; }

std::uint32_t alpha(std::uint32_t a, std::uint32_t b, int eva, int evb) {
  const int r = std::min(31, static_cast<int>((((a & 31) * eva) + ((b & 31) * evb)) >> 4));
  const int g = std::min(31, static_cast<int>(((((a >> 5) & 31) * eva) + (((b >> 5) & 31) * evb)) >> 4));
  const int bl = std::min(31, static_cast<int>(((((a >> 10) & 31) * eva) + (((b >> 10) & 31) * evb)) >> 4));
  return static_cast<std::uint32_t>(r | (g << 5) | (bl << 10));
}
std::uint32_t fade(std::uint32_t c, int evy, bool up) {
  int r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  if (up) { r += ((31 - r) * evy) >> 4; g += ((31 - g) * evy) >> 4; b += ((31 - b) * evy) >> 4; }
  else { r -= (r * evy) >> 4; g -= (g * evy) >> 4; b -= (b * evy) >> 4; }
  return static_cast<std::uint32_t>(r | (g << 5) | (b << 10));
}
}  // namespace

/* pontos de referência dos BGs afins (BG2 e BG3), 28 bits com sinal */
void GbaMachine::latch_ref(int i) {
  const std::uint32_t o = i == 0 ? 0x28 : 0x38;
  ref_x_[i] = static_cast<std::int32_t>(io32(o) << 4) >> 4;
  ref_y_[i] = static_cast<std::int32_t>(io32(o + 4) << 4) >> 4;
}
void GbaMachine::advance_refs() {
  ref_x_[0] = static_cast<std::int32_t>(static_cast<std::uint32_t>(ref_x_[0]) + static_cast<std::uint32_t>(s16(io16(0x22))));
  ref_y_[0] = static_cast<std::int32_t>(static_cast<std::uint32_t>(ref_y_[0]) + static_cast<std::uint32_t>(s16(io16(0x26))));
  ref_x_[1] = static_cast<std::int32_t>(static_cast<std::uint32_t>(ref_x_[1]) + static_cast<std::uint32_t>(s16(io16(0x32))));
  ref_y_[1] = static_cast<std::int32_t>(static_cast<std::uint32_t>(ref_y_[1]) + static_cast<std::uint32_t>(s16(io16(0x36))));
}

void GbaMachine::render_line(int y) {
  const std::uint32_t dc = io16(0);
  std::uint32_t* out = frame_.data() + y * 240;
  if (dc & 0x80) { for (int x = 0; x < 240; x++) out[x] = 0xFFFFFFFFu; return; }   // forced blank = branco
  const int mode = dc & 7, en = (dc >> 8) & 15;
  int on = 0;
  switch (mode) {
    case 0: on = en; for (int i = 0; i < 4; i++) if (en & (1 << i)) text_bg(i, mos_y(i, y)); break;
    case 1: on = en & 7; if (en & 1) text_bg(0, mos_y(0, y)); if (en & 2) text_bg(1, mos_y(1, y)); if (en & 4) affine_bg(2, y); break;
    case 2: on = en & 12; if (en & 4) affine_bg(2, y); if (en & 8) affine_bg(3, y); break;
    case 3: case 4: case 5: on = en & 4; if (en & 4) bitmap_bg(mode, y, dc); break;
    default: on = 0;
  }
  for (int i = 0; i < 4; i++) if ((on & (1 << i)) && (io16(0x08 + i * 2) & 0x40)) mos_h(i);
  render_obj(y, dc);
  compose(y, dc, on);
}

int GbaMachine::mos_y(int i, int y) const {   // mosaico vertical (fundos de texto): repete a primeira linha de cada bloco
  if (!(io16(0x08 + i * 2) & 0x40)) return y;
  const int v = ((io16(0x4C) >> 4) & 15) + 1;
  return y - (y % v);
}
void GbaMachine::mos_h(int i) {   // mosaico horizontal: cada bloco repete o primeiro pixel
  const int h = (io16(0x4C) & 15) + 1;
  if (h == 1) return;
  std::int32_t* buf = bg_[i];
  for (int x = 0; x < 240; x++) buf[x] = buf[x - (x % h)];
}

void GbaMachine::text_bg(int i, int y) {
  const std::uint8_t* vram = vram_.data();
  const std::uint8_t* pal = pal_.data();
  const std::uint32_t cnt = io16(0x08 + i * 2), hofs = io16(0x10 + 4 * i) & 0x1FF, vofs = io16(0x12 + 4 * i) & 0x1FF;
  const std::uint32_t char_base = ((cnt >> 2) & 3) * 0x4000, scr_base = ((cnt >> 8) & 31) * 0x800, size = cnt >> 14;
  const bool is8 = (cnt & 0x80) != 0;
  const std::uint32_t w = (size & 1) ? 512 : 256, h = (size & 2) ? 512 : 256, wt = w >> 3;
  const std::uint32_t py = (y + vofs) & (h - 1), ty = py >> 3, iy_base = py & 7;
  std::int32_t* buf = bg_[i];
  const std::uint32_t tx0 = hofs >> 3;
  // um bloco de 8 pixels por tile: busca o tile uma vez e decodifica a linha inteira
  for (int t = 0, x = -static_cast<int>(hofs & 7); x < 240; t++, x += 8) {
    const std::uint32_t tx = (tx0 + t) & (wt - 1);
    std::uint32_t sb = 0;
    if (size == 1) sb = tx >> 5; else if (size == 2) sb = ty >> 5; else if (size == 3) sb = (tx >> 5) + ((ty >> 5) << 1);
    const std::uint32_t entry = l16(vram, (((scr_base + sb * 0x800) >> 1) + ((ty & 31) << 5) + (tx & 31)) * 2);
    const bool hf = (entry & 0x400) != 0;
    const std::uint32_t iy = (entry & 0x800) ? 7 - iy_base : iy_base;
    if (is8) {
      const std::uint32_t a = (char_base + (entry & 0x3FF) * 64 + iy * 8) & 0xFFF8;
      const std::uint32_t w0 = l32(vram, a), w1 = l32(vram, a + 4);
      for (int k = 0; k < 8; k++) {
        const int xx = x + k; if (xx < 0 || xx >= 240) continue;
        const int ix = hf ? 7 - k : k;
        const std::uint32_t idx = ((ix < 4 ? w0 : w1) >> ((ix & 3) << 3)) & 255;
        buf[xx] = idx ? static_cast<std::int32_t>(l16(pal, idx * 2) & 0x7FFF) : -1;
      }
    } else {
      const std::uint32_t a = (char_base + (entry & 0x3FF) * 32 + iy * 4) & 0xFFFC;
      const std::uint32_t word = l32(vram, a), pb = (entry >> 8) & 0xF0;
      for (int k = 0; k < 8; k++) {
        const int xx = x + k; if (xx < 0 || xx >= 240) continue;
        const std::uint32_t n = (word >> ((hf ? 7 - k : k) << 2)) & 15;
        buf[xx] = n ? static_cast<std::int32_t>(l16(pal, (pb + n) * 2) & 0x7FFF) : -1;
      }
    }
  }
}

void GbaMachine::affine_bg(int i, int /*y*/) {
  const std::uint8_t* vram = vram_.data();
  const std::uint8_t* pal = pal_.data();
  const std::uint32_t cnt = io16(0x08 + i * 2), char_base = ((cnt >> 2) & 3) * 0x4000, scr_base = ((cnt >> 8) & 31) * 0x800;
  const std::int32_t dim = 128 << (cnt >> 14), tiles = dim >> 3;
  const bool wrap = (cnt & 0x2000) != 0;
  const std::uint32_t po = i == 2 ? 0x20 : 0x30;
  const std::int32_t pa = s16(io16(po)), pc = s16(io16(po + 4));
  std::int32_t rx = ref_x_[i - 2], ry = ref_y_[i - 2];
  std::int32_t* buf = bg_[i];
  for (int x = 0; x < 240; x++, rx = static_cast<std::int32_t>(static_cast<std::uint32_t>(rx) + static_cast<std::uint32_t>(pa)), ry = static_cast<std::int32_t>(static_cast<std::uint32_t>(ry) + static_cast<std::uint32_t>(pc))) {
    std::int32_t u = rx >> 8, v = ry >> 8;
    if (wrap) { u &= dim - 1; v &= dim - 1; }
    else if (u < 0 || v < 0 || u >= dim || v >= dim) { buf[x] = -1; continue; }
    const std::uint32_t tile = vram[(scr_base + static_cast<std::uint32_t>((v >> 3) * tiles + (u >> 3))) & 0xFFFF];
    const std::uint32_t idx = vram[(char_base + tile * 64 + static_cast<std::uint32_t>((v & 7) * 8 + (u & 7))) & 0xFFFF];
    buf[x] = idx ? static_cast<std::int32_t>(l16(pal, idx * 2) & 0x7FFF) : -1;
  }
}

void GbaMachine::bitmap_bg(int mode, int /*y*/, std::uint32_t dc) {
  const std::uint8_t* vram = vram_.data();
  const std::uint8_t* pal = pal_.data();
  const std::int32_t pa = s16(io16(0x20)), pc = s16(io16(0x24));
  std::int32_t rx = ref_x_[0], ry = ref_y_[0];
  const std::int32_t w = mode == 5 ? 160 : 240, h = mode == 5 ? 128 : 160;
  const std::uint32_t page = ((dc & 0x10) && mode != 3) ? 0xA000 : 0;
  std::int32_t* buf = bg_[2];
  for (int x = 0; x < 240; x++, rx = static_cast<std::int32_t>(static_cast<std::uint32_t>(rx) + static_cast<std::uint32_t>(pa)), ry = static_cast<std::int32_t>(static_cast<std::uint32_t>(ry) + static_cast<std::uint32_t>(pc))) {
    const std::int32_t u = rx >> 8, v = ry >> 8;
    if (u < 0 || v < 0 || u >= w || v >= h) { buf[x] = -1; continue; }
    if (mode == 3) buf[x] = static_cast<std::int32_t>(l16(vram, (v * 240 + u) * 2) & 0x7FFF);
    else if (mode == 4) { const std::uint32_t idx = vram[page + v * 240 + u]; buf[x] = idx ? static_cast<std::int32_t>(l16(pal, idx * 2) & 0x7FFF) : -1; }
    else buf[x] = static_cast<std::int32_t>(l16(vram, page + (v * 160 + u) * 2) & 0x7FFF);
  }
}

void GbaMachine::render_obj(int y, std::uint32_t dc) {
  for (int x = 0; x < 240; x++) { obj_c_[x] = -1; obj_s_[x] = 0; obj_w_[x] = 0; }
  obj_any_ = false; obj_semi_ = false;
  if (!(dc & 0x1000)) return;
  const std::uint8_t* oam = oam_.data();
  const std::uint8_t* vram = vram_.data();
  const std::uint8_t* pal = pal_.data();
  const bool one_d = (dc & 0x40) != 0;
  for (int n = 0; n < 128; n++) {
    const std::uint32_t a0 = l16(oam, n * 8), a1 = l16(oam, n * 8 + 2), a2 = l16(oam, n * 8 + 4);
    const bool rot = (a0 & 0x100) != 0;
    if (!rot && (a0 & 0x200)) continue;   // desativado
    const std::uint32_t omode = (a0 >> 10) & 3; if (omode == 3) continue;
    const std::uint32_t shape = a0 >> 14; if (shape == 3) continue;
    const int w = kObjSizes[shape * 4 + (a1 >> 14)][0], h = kObjSizes[shape * 4 + (a1 >> 14)][1];
    const int dbl = (rot && (a0 & 0x200)) ? 1 : 0, bw = w << dbl, bh = h << dbl;
    const int ty = (y - static_cast<int>(a0 & 0xFF)) & 0xFF; if (ty >= bh) continue;
    int sx = a1 & 0x1FF; if (sx >= 256) sx -= 512;
    if (sx + bw <= 0 || sx >= 240) continue;
    const std::uint32_t prio = (a2 >> 10) & 3, tile = a2 & 0x3FF, pbank = (a2 >> 12) & 15;
    const bool is8 = (a0 & 0x2000) != 0;
    std::int32_t pa = 0, pb = 0, pc = 0, pd = 0;
    if (rot) {
      const int g = static_cast<int>(((a1 >> 9) & 31) * 16);
      pa = s16(l16(oam, (g + 3) * 2)); pb = s16(l16(oam, (g + 7) * 2)); pc = s16(l16(oam, (g + 11) * 2)); pd = s16(l16(oam, (g + 15) * 2));
    }
    const bool hf = !rot && (a1 & 0x1000), vf = !rot && (a1 & 0x2000);
    for (int px = 0; px < bw; px++) {
      const int x = sx + px; if (x < 0 || x >= 240) continue;
      int u, v;
      if (rot) {
        const int dx = px - (bw >> 1), dy = ty - (bh >> 1);
        u = ((pa * dx + pb * dy) >> 8) + (w >> 1); v = ((pc * dx + pd * dy) >> 8) + (h >> 1);
        if (u < 0 || u >= w || v < 0 || v >= h) continue;
      } else { u = hf ? w - 1 - px : px; v = vf ? h - 1 - ty : ty; }
      const int tx8 = u >> 3, ty8 = v >> 3;
      std::uint32_t idx;
      if (is8) {
        const std::uint32_t ti = tile + (one_d ? ty8 * (w >> 3) * 2 + tx8 * 2 : ty8 * 32 + tx8 * 2);
        idx = vram[0x10000 + ((ti * 32 + (v & 7) * 8 + (u & 7)) & 0x7FFF)];
      } else {
        const std::uint32_t ti = tile + (one_d ? ty8 * (w >> 3) + tx8 : ty8 * 32 + tx8);
        const std::uint32_t b = vram[0x10000 + ((ti * 32 + (v & 7) * 4 + ((u & 7) >> 1)) & 0x7FFF)];
        idx = (u & 1) ? b >> 4 : b & 15;
      }
      if (!idx) continue;
      if (omode == 2) { obj_w_[x] = 1; continue; }
      if (obj_c_[x] >= 0 && obj_p_[x] <= prio) continue;   // o sprite de menor índice vence o empate
      obj_c_[x] = static_cast<std::int32_t>(l16(pal, (256 + (is8 ? idx : (pbank << 4) + idx)) * 2) & 0x7FFF);
      obj_p_[x] = static_cast<std::uint8_t>(prio); obj_s_[x] = omode == 1 ? 1 : 0;
      obj_any_ = true; if (omode == 1) obj_semi_ = true;
    }
  }
}

void GbaMachine::compose(int y, std::uint32_t dc, int on) {
  std::uint32_t* out = frame_.data() + y * 240;
  const std::uint32_t* RGB = rgb_table();
  const bool obj_on = (dc & 0x1000) != 0;
  std::int8_t bg_list[4][4];
  std::uint8_t bg_count[4] = {0, 0, 0, 0};
  for (int i = 0; i < 4; i++) if (on & (1 << i)) { const int p = io16(0x08 + i * 2) & 3; bg_list[p][bg_count[p]++] = static_cast<std::int8_t>(i); }
  const std::int32_t backdrop = static_cast<std::int32_t>(l16(pal_.data(), 0) & 0x7FFF);
  const std::uint32_t bld = io16(0x50), t1 = bld & 0x3F, t2 = (bld >> 8) & 0x3F;
  const int bmode = (bld >> 6) & 3;
  const std::uint32_t ba = io16(0x52);
  const int eva = std::min<int>(16, ba & 31), evb = std::min<int>(16, (ba >> 8) & 31), evy = std::min<int>(16, io16(0x54) & 31);

  const bool w0 = (dc & 0x2000) != 0, w1 = (dc & 0x4000) != 0, wo = (dc & 0x8000) != 0, win_on = w0 || w1 || wo;
  bool w0y = false, w1y = false;
  int w0x1 = 0, w0x2 = 0, w1x1 = 0, w1x2 = 0;
  const std::uint32_t winin = io16(0x48), winout = io16(0x4A);
  if (w0) {
    const std::uint32_t h = io16(0x40), v = io16(0x44); w0x1 = h >> 8; w0x2 = h & 255; if (w0x2 > 240 || w0x1 > w0x2) w0x2 = 240;
    int y1 = v >> 8, y2 = v & 255; if (y2 > 160 || y1 > y2) y2 = 160; w0y = y >= y1 && y < y2;
  }
  if (w1) {
    const std::uint32_t h = io16(0x42), v = io16(0x46); w1x1 = h >> 8; w1x2 = h & 255; if (w1x2 > 240 || w1x1 > w1x2) w1x2 = 240;
    int y1 = v >> 8, y2 = v & 255; if (y2 > 160 || y1 > y2) y2 = 160; w1y = y >= y1 && y < y2;
  }

  if (!win_on && bmode == 0 && !obj_semi_) {
    // caminho rápido: sem janelas, sem mistura, sem sprites semitransparentes => só a camada do topo
    const bool any_obj = obj_on && obj_any_;
    for (int x = 0; x < 240; x++) {
      std::int32_t c = -1;
      for (int p = 0; p < 4 && c < 0; p++) {
        if (any_obj && obj_c_[x] >= 0 && obj_p_[x] == p) { c = obj_c_[x]; break; }
        const int cn = bg_count[p];
        for (int k = 0; k < cn; k++) { const std::int32_t v = bg_[bg_list[p][k]][x]; if (v >= 0) { c = v; break; } }
      }
      out[x] = RGB[c < 0 ? backdrop : c];
    }
    return;
  }
  for (int x = 0; x < 240; x++) {
    std::uint32_t wm = 63;
    if (win_on) {
      if (w0y && x >= w0x1 && x < w0x2) wm = winin & 63;
      else if (w1y && x >= w1x1 && x < w1x2) wm = (winin >> 8) & 63;
      else if (wo && obj_w_[x]) wm = (winout >> 8) & 63;
      else wm = winout & 63;
    }
    // camada do topo
    std::int32_t c1 = -1; int l1 = 5;
    for (int p = 0; p < 4; p++) {
      if (obj_on && (wm & 16) && obj_c_[x] >= 0 && obj_p_[x] == p) { c1 = obj_c_[x]; l1 = 4; break; }
      const int cnt = bg_count[p];
      bool found = false;
      for (int k = 0; k < cnt; k++) { const int b = bg_list[p][k]; const std::int32_t c = bg_[b][x]; if (c >= 0 && (wm & (1u << b))) { c1 = c; l1 = b; found = true; break; } }
      if (found) break;
    }
    if (c1 < 0) c1 = backdrop;
    std::uint32_t color = static_cast<std::uint32_t>(c1);
    if (wm & 32) {
      const bool semi = l1 == 4 && obj_s_[x] != 0;
      bool blended = false;
      if (semi || (bmode == 1 && (t1 & (1u << l1)))) {
        // a segunda camada só é procurada quando a mistura realmente acontece
        std::int32_t c2 = -1; int l2 = 5;
        for (int p = 0; p < 4; p++) {
          if (obj_on && (wm & 16) && obj_c_[x] >= 0 && obj_p_[x] == p) { if (l1 != 4) { c2 = obj_c_[x]; l2 = 4; break; } }
          const int cnt = bg_count[p];
          bool found = false;
          for (int k = 0; k < cnt; k++) {
            const int b = bg_list[p][k]; const std::int32_t c = bg_[b][x];
            if (c >= 0 && (wm & (1u << b))) { if (b == l1) continue; c2 = c; l2 = b; found = true; break; }
          }
          if (found) break;
        }
        if (c2 < 0) c2 = backdrop;
        if (t2 & (1u << l2)) { color = alpha(static_cast<std::uint32_t>(c1), static_cast<std::uint32_t>(c2), eva, evb); blended = true; }
      }
      if (!blended) {
        if (bmode == 2 && (t1 & (1u << l1))) color = fade(static_cast<std::uint32_t>(c1), evy, true);
        else if (bmode == 3 && (t1 & (1u << l1))) color = fade(static_cast<std::uint32_t>(c1), evy, false);
      }
    }
    out[x] = RGB[color];
  }
}

}  // namespace emuhub
