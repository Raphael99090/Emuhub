'use strict';
/* Vídeo do GBA, renderizado uma scanline por vez.
 * Modos 0-5, BGs de texto e afins, sprites (normais e rotacionados), janelas, alpha e brilho.
 * Mosaico só nos fundos (horizontal em todos, vertical nos de texto); sem mosaico de sprites. Cores internas em 15 bits (BGR555); -1 significa transparente. */

const GBA_RGB = new Uint32Array(32768);
for (let c = 0; c < 32768; c++) {
  let r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  r = (r << 3) | (r >> 2); g = (g << 3) | (g >> 2); b = (b << 3) | (b >> 2);
  GBA_RGB[c] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
}
// índice = forma * 4 + tamanho; forma 0 quadrado, 1 horizontal, 2 vertical
const GBA_OBJ_SIZES = [[8, 8], [16, 16], [32, 32], [64, 64], [16, 8], [32, 8], [32, 16], [64, 32], [8, 16], [8, 32], [16, 32], [32, 64]];
const gbaS16 = v => (v << 16) >> 16;

class GBAPPU {
  constructor(bus, frame) {
    this.bus = bus; this.frame = frame;
    this.bg = [0, 1, 2, 3].map(() => new Int32Array(240).fill(-1));
    this.objC = new Int32Array(240).fill(-1);
    this.objP = new Uint8Array(240); this.objS = new Uint8Array(240); this.objW = new Uint8Array(240);
    this.refX = new Int32Array(2); this.refY = new Int32Array(2);
    this.objAny = false; this.objSemi = false;
    this.bgList = [0, 1, 2, 3].map(() => new Int8Array(4)); this.bgCount = new Uint8Array(4);
  }

  /* pontos de referência dos BGs afins (BG2 e BG3), 28 bits com sinal */
  latchRef(i) {
    const u32 = this.bus.io.u32, o = i === 0 ? (0x28 >> 2) : (0x38 >> 2);
    this.refX[i] = (u32[o] << 4) >> 4; this.refY[i] = (u32[o + 1] << 4) >> 4;
  }
  advanceRefs() {
    const io = this.bus.io.u16;
    this.refX[0] += gbaS16(io[0x22 >> 1]); this.refY[0] += gbaS16(io[0x26 >> 1]);
    this.refX[1] += gbaS16(io[0x32 >> 1]); this.refY[1] += gbaS16(io[0x36 >> 1]);
  }

  renderLine(y) {
    const io = this.bus.io.u16, dc = io[0], out = this.frame, base = y * 240;
    if (dc & 0x80) { out.fill(0xFFFFFFFF, base, base + 240); return; } // forced blank = branco
    const mode = dc & 7, en = (dc >> 8) & 15;
    let on = 0;
    switch (mode) {
      case 0: on = en; for (let i = 0; i < 4; i++) if (en & (1 << i)) this.textBg(i, this.mosY(i, y)); break;
      case 1: on = en & 7; if (en & 1) this.textBg(0, this.mosY(0, y)); if (en & 2) this.textBg(1, this.mosY(1, y)); if (en & 4) this.affineBg(2, y); break;
      case 2: on = en & 12; if (en & 4) this.affineBg(2, y); if (en & 8) this.affineBg(3, y); break;
      case 3: case 4: case 5: on = en & 4; if (en & 4) this.bitmapBg(mode, y, dc); break;
      default: on = 0;
    }
    for (let i = 0; i < 4; i++) if ((on & (1 << i)) && (io[(0x08 >> 1) + i] & 0x40)) this.mosH(i);
    this.renderObj(y, dc);
    this.compose(y, dc, on);
  }

  mosY(i, y) { // mosaico vertical (fundos de texto): repete a primeira linha de cada bloco
    if (!(this.bus.io.u16[(0x08 >> 1) + i] & 0x40)) return y;
    const v = ((this.bus.io.u16[0x4C >> 1] >> 4) & 15) + 1;
    return y - (y % v);
  }
  mosH(i) { // mosaico horizontal: cada bloco repete o primeiro pixel
    const h = (this.bus.io.u16[0x4C >> 1] & 15) + 1;
    if (h === 1) return;
    const buf = this.bg[i];
    for (let x = 0; x < 240; x++) buf[x] = buf[x - (x % h)];
  }

  textBg(i, y) {
    const bus = this.bus, io = bus.io.u16, vram32 = bus.vram.u32, vram16 = bus.vram.u16, pal = bus.pal.u16;
    const cnt = io[(0x08 >> 1) + i], hofs = io[(0x10 >> 1) + 2 * i] & 0x1FF, vofs = io[(0x12 >> 1) + 2 * i] & 0x1FF;
    const charBase = ((cnt >> 2) & 3) * 0x4000, scrBase = ((cnt >> 8) & 31) * 0x800, is8 = (cnt & 0x80) !== 0, size = cnt >> 14;
    const w = (size & 1) ? 512 : 256, h = (size & 2) ? 512 : 256, wt = w >> 3;
    const py = (y + vofs) & (h - 1), ty = py >> 3, iyBase = py & 7;
    const buf = this.bg[i], tx0 = hofs >> 3;
    // um bloco de 8 pixels por tile: busca o tile uma vez e decodifica a linha inteira
    for (let t = 0, x = -(hofs & 7); x < 240; t++, x += 8) {
      const tx = (tx0 + t) & (wt - 1);
      let sb = 0;
      if (size === 1) sb = tx >> 5; else if (size === 2) sb = ty >> 5; else if (size === 3) sb = (tx >> 5) + ((ty >> 5) << 1);
      const entry = vram16[((scrBase + sb * 0x800) >> 1) + ((ty & 31) << 5) + (tx & 31)];
      const hf = (entry & 0x400) !== 0, iy = (entry & 0x800) ? 7 - iyBase : iyBase;
      if (is8) {
        const a = (charBase + (entry & 0x3FF) * 64 + iy * 8) & 0xFFF8, w0 = vram32[a >> 2], w1 = vram32[(a >> 2) + 1];
        for (let k = 0; k < 8; k++) {
          const xx = x + k; if (xx < 0 || xx >= 240) continue;
          const ix = hf ? 7 - k : k, idx = ((ix < 4 ? w0 : w1) >>> ((ix & 3) << 3)) & 255;
          buf[xx] = idx ? pal[idx] & 0x7FFF : -1;
        }
      } else {
        const a = (charBase + (entry & 0x3FF) * 32 + iy * 4) & 0xFFFC, word = vram32[a >> 2], pb = (entry >> 8) & 0xF0;
        for (let k = 0; k < 8; k++) {
          const xx = x + k; if (xx < 0 || xx >= 240) continue;
          const n = (word >>> ((hf ? 7 - k : k) << 2)) & 15;
          buf[xx] = n ? pal[pb + n] & 0x7FFF : -1;
        }
      }
    }
  }

  affineBg(i, y) {
    const bus = this.bus, io = bus.io.u16, vram = bus.vram.u8, pal = bus.pal.u16;
    const cnt = io[(0x08 >> 1) + i], charBase = ((cnt >> 2) & 3) * 0x4000, scrBase = ((cnt >> 8) & 31) * 0x800;
    const dim = 128 << (cnt >> 14), wrap = (cnt & 0x2000) !== 0, tiles = dim >> 3;
    const po = i === 2 ? 0x20 : 0x30, pa = gbaS16(io[po >> 1]), pc = gbaS16(io[(po + 4) >> 1]);
    let rx = this.refX[i - 2], ry = this.refY[i - 2];
    const buf = this.bg[i];
    for (let x = 0; x < 240; x++, rx += pa, ry += pc) {
      let u = rx >> 8, v = ry >> 8;
      if (wrap) { u &= dim - 1; v &= dim - 1; }
      else if (u < 0 || v < 0 || u >= dim || v >= dim) { buf[x] = -1; continue; }
      const tile = vram[(scrBase + (v >> 3) * tiles + (u >> 3)) & 0xFFFF];
      const idx = vram[(charBase + tile * 64 + (v & 7) * 8 + (u & 7)) & 0xFFFF];
      buf[x] = idx ? (pal[idx] & 0x7FFF) : -1;
    }
  }

  bitmapBg(mode, y, dc) {
    const bus = this.bus, io = bus.io.u16, vram = bus.vram.u8, vram16 = bus.vram.u16, pal = bus.pal.u16;
    const pa = gbaS16(io[0x20 >> 1]), pc = gbaS16(io[0x24 >> 1]);
    let rx = this.refX[0], ry = this.refY[0];
    const w = mode === 5 ? 160 : 240, h = mode === 5 ? 128 : 160;
    const page = (dc & 0x10) && mode !== 3 ? 0xA000 : 0;
    const buf = this.bg[2];
    for (let x = 0; x < 240; x++, rx += pa, ry += pc) {
      const u = rx >> 8, v = ry >> 8;
      if (u < 0 || v < 0 || u >= w || v >= h) { buf[x] = -1; continue; }
      if (mode === 3) buf[x] = vram16[v * 240 + u] & 0x7FFF;
      else if (mode === 4) { const idx = vram[page + v * 240 + u]; buf[x] = idx ? (pal[idx] & 0x7FFF) : -1; }
      else buf[x] = vram16[(page >> 1) + v * 160 + u] & 0x7FFF;
    }
  }

  renderObj(y, dc) {
    const objC = this.objC, objP = this.objP, objS = this.objS, objW = this.objW;
    objC.fill(-1); objS.fill(0); objW.fill(0); this.objAny = false; this.objSemi = false;
    if (!(dc & 0x1000)) return;
    const bus = this.bus, oam = bus.oam.u16, vram = bus.vram.u8, pal = bus.pal.u16, oneD = (dc & 0x40) !== 0;
    for (let n = 0; n < 128; n++) {
      const a0 = oam[n * 4], a1 = oam[n * 4 + 1], a2 = oam[n * 4 + 2];
      const rot = (a0 & 0x100) !== 0;
      if (!rot && (a0 & 0x200)) continue; // desativado
      const omode = (a0 >> 10) & 3; if (omode === 3) continue;
      const shape = a0 >> 14; if (shape === 3) continue;
      const dims = GBA_OBJ_SIZES[shape * 4 + (a1 >> 14)], w = dims[0], h = dims[1];
      const dbl = rot && (a0 & 0x200) ? 1 : 0, bw = w << dbl, bh = h << dbl;
      const ty = (y - (a0 & 0xFF)) & 0xFF; if (ty >= bh) continue;
      let sx = a1 & 0x1FF; if (sx >= 256) sx -= 512;
      if (sx + bw <= 0 || sx >= 240) continue;
      const prio = (a2 >> 10) & 3, is8 = (a0 & 0x2000) !== 0, tile = a2 & 0x3FF, pbank = (a2 >> 12) & 15;
      let pa = 0, pb = 0, pc = 0, pd = 0;
      if (rot) { const g = ((a1 >> 9) & 31) * 16; pa = gbaS16(oam[g + 3]); pb = gbaS16(oam[g + 7]); pc = gbaS16(oam[g + 11]); pd = gbaS16(oam[g + 15]); }
      const hf = !rot && (a1 & 0x1000), vf = !rot && (a1 & 0x2000);
      for (let px = 0; px < bw; px++) {
        const x = sx + px; if (x < 0 || x >= 240) continue;
        let u, v;
        if (rot) {
          const dx = px - (bw >> 1), dy = ty - (bh >> 1);
          u = ((pa * dx + pb * dy) >> 8) + (w >> 1); v = ((pc * dx + pd * dy) >> 8) + (h >> 1);
          if (u < 0 || u >= w || v < 0 || v >= h) continue;
        } else { u = hf ? w - 1 - px : px; v = vf ? h - 1 - ty : ty; }
        const tx8 = u >> 3, ty8 = v >> 3;
        let idx;
        if (is8) {
          const ti = tile + (oneD ? ty8 * (w >> 3) * 2 + tx8 * 2 : ty8 * 32 + tx8 * 2);
          idx = vram[0x10000 + ((ti * 32 + (v & 7) * 8 + (u & 7)) & 0x7FFF)];
        } else {
          const ti = tile + (oneD ? ty8 * (w >> 3) + tx8 : ty8 * 32 + tx8);
          const b = vram[0x10000 + ((ti * 32 + (v & 7) * 4 + ((u & 7) >> 1)) & 0x7FFF)];
          idx = (u & 1) ? b >> 4 : b & 15;
        }
        if (!idx) continue;
        if (omode === 2) { objW[x] = 1; continue; }
        if (objC[x] >= 0 && objP[x] <= prio) continue; // o sprite de menor índice vence o empate
        objC[x] = pal[256 + (is8 ? idx : (pbank << 4) + idx)] & 0x7FFF; objP[x] = prio; objS[x] = omode === 1 ? 1 : 0;
        this.objAny = true; if (omode === 1) this.objSemi = true;
      }
    }
  }

  compose(y, dc, on) {
    const bus = this.bus, io = bus.io.u16, out = this.frame, base = y * 240, bg = this.bg;
    const objC = this.objC, objP = this.objP, objS = this.objS, objW = this.objW, objOn = (dc & 0x1000) !== 0;
    const bgList = this.bgList, bgCount = this.bgCount; bgCount.fill(0);
    for (let i = 0; i < 4; i++) if (on & (1 << i)) { const p = io[(0x08 >> 1) + i] & 3; bgList[p][bgCount[p]++] = i; }
    const backdrop = bus.pal.u16[0] & 0x7FFF;
    const bld = io[0x50 >> 1], bmode = (bld >> 6) & 3, t1 = bld & 0x3F, t2 = (bld >> 8) & 0x3F;
    const ba = io[0x52 >> 1], eva = Math.min(16, ba & 31), evb = Math.min(16, (ba >> 8) & 31), evy = Math.min(16, io[0x54 >> 1] & 31);

    const w0 = (dc & 0x2000) !== 0, w1 = (dc & 0x4000) !== 0, wo = (dc & 0x8000) !== 0, winOn = w0 || w1 || wo;
    let w0y = false, w1y = false, w0x1 = 0, w0x2 = 0, w1x1 = 0, w1x2 = 0;
    const winin = io[0x48 >> 1], winout = io[0x4A >> 1];
    if (w0) {
      const h = io[0x40 >> 1], v = io[0x44 >> 1]; w0x1 = h >> 8; w0x2 = h & 255; if (w0x2 > 240 || w0x1 > w0x2) w0x2 = 240;
      let y1 = v >> 8, y2 = v & 255; if (y2 > 160 || y1 > y2) y2 = 160; w0y = y >= y1 && y < y2;
    }
    if (w1) {
      const h = io[0x42 >> 1], v = io[0x46 >> 1]; w1x1 = h >> 8; w1x2 = h & 255; if (w1x2 > 240 || w1x1 > w1x2) w1x2 = 240;
      let y1 = v >> 8, y2 = v & 255; if (y2 > 160 || y1 > y2) y2 = 160; w1y = y >= y1 && y < y2;
    }

    if (!winOn && bmode === 0 && !this.objSemi) {
      // caminho rápido: sem janelas, sem mistura, sem sprites semitransparentes => só a camada do topo
      const anyObj = objOn && this.objAny;
      for (let x = 0; x < 240; x++) {
        let c = -1;
        outer: for (let p = 0; p < 4; p++) {
          if (anyObj && objC[x] >= 0 && objP[x] === p) { c = objC[x]; break; }
          const cn = bgCount[p], lst = bgList[p];
          for (let k = 0; k < cn; k++) { const v = bg[lst[k]][x]; if (v >= 0) { c = v; break outer; } }
        }
        out[base + x] = GBA_RGB[c < 0 ? backdrop : c];
      }
      return;
    }
    for (let x = 0; x < 240; x++) {
      let wm = 63;
      if (winOn) {
        if (w0y && x >= w0x1 && x < w0x2) wm = winin & 63;
        else if (w1y && x >= w1x1 && x < w1x2) wm = (winin >> 8) & 63;
        else if (wo && objW[x]) wm = (winout >> 8) & 63;
        else wm = winout & 63;
      }
      // camada do topo
      let c1 = -1, l1 = 5;
      top: for (let p = 0; p < 4; p++) {
        if (objOn && (wm & 16) && objC[x] >= 0 && objP[x] === p) { c1 = objC[x]; l1 = 4; break; }
        const cnt = bgCount[p], lst = bgList[p];
        for (let k = 0; k < cnt; k++) { const b = lst[k], c = bg[b][x]; if (c >= 0 && (wm & (1 << b))) { c1 = c; l1 = b; break top; } }
      }
      if (c1 < 0) c1 = backdrop;
      let color = c1;
      if (wm & 32) {
        const semi = l1 === 4 && objS[x] !== 0; let blended = false;
        if (semi || (bmode === 1 && (t1 & (1 << l1)))) {
          // a segunda camada só é procurada quando a mistura realmente acontece
          let c2 = -1, l2 = 5, seen = false;
          sec: for (let p = 0; p < 4; p++) {
            if (objOn && (wm & 16) && objC[x] >= 0 && objP[x] === p) { if (l1 === 4) seen = true; else { c2 = objC[x]; l2 = 4; break; } }
            const cnt = bgCount[p], lst = bgList[p];
            for (let k = 0; k < cnt; k++) {
              const b = lst[k], c = bg[b][x];
              if (c >= 0 && (wm & (1 << b))) { if (b === l1) continue; c2 = c; l2 = b; break sec; }
            }
          }
          if (c2 < 0) c2 = backdrop;
          if (t2 & (1 << l2)) { color = GBAPPU.alpha(c1, c2, eva, evb); blended = true; }
        }
        if (!blended) {
          if (bmode === 2 && (t1 & (1 << l1))) color = GBAPPU.fade(c1, evy, true);
          else if (bmode === 3 && (t1 & (1 << l1))) color = GBAPPU.fade(c1, evy, false);
        }
      }
      out[base + x] = GBA_RGB[color];
    }
  }

  static alpha(a, b, eva, evb) {
    const r = Math.min(31, (((a & 31) * eva) + ((b & 31) * evb)) >> 4);
    const g = Math.min(31, ((((a >> 5) & 31) * eva) + (((b >> 5) & 31) * evb)) >> 4);
    const bl = Math.min(31, ((((a >> 10) & 31) * eva) + (((b >> 10) & 31) * evb)) >> 4);
    return r | (g << 5) | (bl << 10);
  }
  static fade(c, evy, up) {
    let r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    if (up) { r += ((31 - r) * evy) >> 4; g += ((31 - g) * evy) >> 4; b += ((31 - b) * evy) >> 4; }
    else { r -= (r * evy) >> 4; g -= (g * evy) >> 4; b -= (b * evy) >> 4; }
    return r | (g << 5) | (b << 10);
  }
}

if (typeof module !== 'undefined') module.exports = { GBAPPU, GBA_RGB };
