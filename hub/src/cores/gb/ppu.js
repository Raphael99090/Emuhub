'use strict';
/* PPU do Game Boy / Game Boy Color: temporização por modos (2/3/0/1), renderização por linha,
 * janela, sprites 8x8/8x16, paletas DMG e paletas/bancos/atributos do CGB. */
const GB_DMG_COLORS = new Uint32Array([0xFFD0F8E0, 0xFF70C088, 0xFF566834, 0xFF201808]); // ABGR: claro -> escuro (verde suave)

function gbRgb555(c) { // conversão com mistura de canais, parecida com a tela do GBC
  const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
  const R = Math.min(255, (r * 13 + g * 2 + b) >> 1), G = Math.min(255, (g * 3 + b) << 1), B = Math.min(255, (r * 3 + g * 2 + b * 11) >> 1);
  return 0xFF000000 | (B << 16) | (G << 8) | R;
}
const GB_RGB_LUT = new Uint32Array(32768);
for (let i = 0; i < 32768; i++) GB_RGB_LUT[i] = gbRgb555(i);

class GBPPU {
  constructor(gb) {
    this.gb = gb;
    this.frame = new Uint32Array(160 * 144);
    this.vram = new Uint8Array(0x4000);
    this.oam = new Uint8Array(0xA0);
    this.bgPal = new Uint8Array(64); this.obPal = new Uint8Array(64);
    this.bgCol = new Uint32Array(32); this.obCol = new Uint32Array(32);
    this.lineIdx = new Uint8Array(160); this.linePri = new Uint8Array(160);
    this.spr = new Int16Array(40); this.sprX = new Int16Array(40); this.noLimit = false;
    this.reset();
  }
  reset() {
    this.lcdc = 0x91; this.stat = 0; this.scy = 0; this.scx = 0; this.ly = 0; this.lyc = 0;
    this.bgp = 0xFC; this.obp0 = 0xFF; this.obp1 = 0xFF; this.wy = 0; this.wx = 0;
    this.bcps = 0; this.ocps = 0; this.vbk = 0;
    this.mode = 1; this.cyc = 0; this.winLine = 0; this.statLine = false; this.frameDone = false; this.lycFlag = false;
    this.mode = 2; this.ly = 0; this.cyc = 0;
    for (let i = 0; i < 32; i++) { this.bgCol[i] = GB_RGB_LUT[0x7FFF]; this.obCol[i] = GB_RGB_LUT[0x7FFF]; }
  }
  /* ---- registradores ---- */
  readReg(a) {
    switch (a) {
      case 0xFF40: return this.lcdc;
      case 0xFF41: return 0x80 | (this.stat & 0x78) | (this.lycFlag ? 4 : 0) | ((this.lcdc & 0x80) ? this.mode : 0);
      case 0xFF42: return this.scy; case 0xFF43: return this.scx;
      case 0xFF44: return this.ly; case 0xFF45: return this.lyc;
      case 0xFF47: return this.bgp; case 0xFF48: return this.obp0; case 0xFF49: return this.obp1;
      case 0xFF4A: return this.wy; case 0xFF4B: return this.wx;
      case 0xFF4F: return this.gb.cgb ? 0xFE | this.vbk : 0xFF;
      case 0xFF68: return this.gb.cgb ? this.bcps | 0x40 : 0xFF;
      case 0xFF69: return this.gb.cgb ? this.bgPal[this.bcps & 63] : 0xFF;
      case 0xFF6A: return this.gb.cgb ? this.ocps | 0x40 : 0xFF;
      case 0xFF6B: return this.gb.cgb ? this.obPal[this.ocps & 63] : 0xFF;
    }
    return 0xFF;
  }
  writeReg(a, v) {
    switch (a) {
      case 0xFF40: {
        const was = this.lcdc & 0x80;
        this.lcdc = v;
        if (was && !(v & 0x80)) { this.ly = 0; this.mode = 0; this.cyc = 0; this.winLine = 0; this.statLine = false; this.lycFlag = false; }
        else if (!was && (v & 0x80)) { this.ly = 0; this.mode = 2; this.cyc = 0; this.winLine = 0; this.checkLyc(); this.updateStat(); }
        return;
      }
      case 0xFF41: this.stat = v & 0x78; this.updateStat(); return;
      case 0xFF42: this.scy = v; return; case 0xFF43: this.scx = v; return;
      case 0xFF45: this.lyc = v; if (this.lcdc & 0x80) { this.checkLyc(); this.updateStat(); } return;
      case 0xFF47: this.bgp = v; return; case 0xFF48: this.obp0 = v; return; case 0xFF49: this.obp1 = v; return;
      case 0xFF4A: this.wy = v; return; case 0xFF4B: this.wx = v; return;
      case 0xFF4F: if (this.gb.cgb) this.vbk = v & 1; return;
      case 0xFF68: this.bcps = v & 0xBF; return;
      case 0xFF69: if (this.gb.cgb) this.palWrite(this.bgPal, this.bgCol, this.bcps & 63, v); if (this.bcps & 0x80) this.bcps = 0x80 | ((this.bcps + 1) & 63); return;
      case 0xFF6A: this.ocps = v & 0xBF; return;
      case 0xFF6B: if (this.gb.cgb) this.palWrite(this.obPal, this.obCol, this.ocps & 63, v); if (this.ocps & 0x80) this.ocps = 0x80 | ((this.ocps + 1) & 63); return;
    }
  }
  palWrite(pal, col, i, v) { pal[i] = v; const k = i >> 1; col[k] = GB_RGB_LUT[(pal[k * 2] | (pal[k * 2 + 1] << 8)) & 0x7FFF]; }
  checkLyc() { this.lycFlag = this.ly === this.lyc; }
  updateStat() {
    const s = this.stat, m = this.mode;
    const line = (this.lycFlag && (s & 0x40)) || (m === 0 && (s & 8)) || (m === 1 && (s & 0x10)) || (m === 2 && (s & 0x20));
    if (line && !this.statLine && (this.lcdc & 0x80)) this.gb.ifl |= 2;
    this.statLine = !!line;
  }
  /* ---- tempo ---- */
  tick(c) {
    if (!(this.lcdc & 0x80)) return;
    this.cyc += c;
    for (;;) {
      if (this.mode === 2) {
        if (this.cyc < 80) return;
        this.cyc -= 80; this.mode = 3; this.updateStat();
      } else if (this.mode === 3) {
        if (this.cyc < 172) return;
        this.cyc -= 172; this.mode = 0;
        this.renderLine();
        if (this.gb.hdmaActive) this.gb.hdmaStep();
        this.updateStat();
      } else if (this.mode === 0) {
        if (this.cyc < 204) return;
        this.cyc -= 204; this.ly++;
        if (this.ly === 144) {
          this.mode = 1; this.gb.ifl |= 1; this.frameDone = true;
        } else this.mode = 2;
        this.checkLyc(); this.updateStat();
      } else {
        if (this.cyc < 456) return;
        this.cyc -= 456; this.ly++;
        if (this.ly > 153) { this.ly = 0; this.mode = 2; this.winLine = 0; }
        this.checkLyc(); this.updateStat();
      }
    }
  }
  /* ---- renderização ---- */
  renderLine() {
    const gb = this.gb, cgb = gb.cgb, ly = this.ly, lcdc = this.lcdc, vram = this.vram, out = this.frame, o = ly * 160;
    const idx = this.lineIdx, pri = this.linePri;
    const bgOn = cgb || (lcdc & 1);
    idx.fill(0); pri.fill(0);
    const dmg = GB_DMG_COLORS;
    // cores finais por pixel de fundo
    if (bgOn || cgb) {
      const mapBase = (lcdc & 8) ? 0x1C00 : 0x1800, signed = !(lcdc & 0x10);
      const py = (ly + this.scy) & 255;
      for (let x = 0; x < 160; x++) {
        const px = (x + this.scx) & 255;
        this.bgPixel(x, px, py, mapBase, signed, idx, pri, out, o);
      }
      if ((lcdc & 0x20) && ly >= this.wy && this.wx <= 166 && (bgOn)) {
        const wmap = (lcdc & 0x40) ? 0x1C00 : 0x1800, wx0 = this.wx - 7;
        if (wx0 < 160) {
          const py2 = this.winLine;
          for (let x = Math.max(0, wx0); x < 160; x++) this.bgPixel(x, x - wx0, py2, wmap, signed, idx, pri, out, o);
          this.winLine++;
        }
      }
    } else for (let x = 0; x < 160; x++) out[o + x] = dmg[0];
    if (lcdc & 2) this.renderSprites(ly, idx, pri, out, o);
  }
  bgPixel(x, px, py, mapBase, signed, idx, pri, out, o) {
    const gb = this.gb, vram = this.vram;
    const mi = mapBase + ((py >> 3) << 5) + (px >> 3);
    const tile = vram[mi];
    const attr = gb.cgb ? vram[0x2000 + mi] : 0;
    let row = py & 7; if (attr & 0x40) row = 7 - row;
    const base = (signed ? 0x1000 + ((tile << 24) >> 24) * 16 : tile * 16) + row * 2 + ((attr & 8) ? 0x2000 : 0);
    const b0 = vram[base], b1 = vram[base + 1];
    const bit = (attr & 0x20) ? (px & 7) : 7 - (px & 7);
    const v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
    idx[x] = v; pri[x] = (attr & 0x80) ? 1 : 0;
    if (gb.cgb) out[o + x] = this.bgCol[(attr & 7) * 4 + v];
    else out[o + x] = GB_DMG_COLORS[(this.bgp >> (v * 2)) & 3];
  }
  renderSprites(ly, idx, pri, out, o) {
    const gb = this.gb, cgb = gb.cgb, oam = this.oam, vram = this.vram, tall = (this.lcdc & 4) !== 0, h = tall ? 16 : 8;
    let n = 0; const list = this.spr, xs = this.sprX;
    const lim = this.noLimit ? 40 : 10;
    for (let i = 0; i < 40 && n < lim; i++) {
      const y = oam[i * 4] - 16;
      if (ly >= y && ly < y + h) { list[n] = i; xs[n] = oam[i * 4 + 1] - 8; n++; }
    }
    if (!n) return;
    // prioridade: no DMG vence o menor X (empate: menor índice); no CGB vence o menor índice. Desenha do menos prioritário ao mais.
    const order = [];
    for (let k = 0; k < n; k++) order.push(k);
    if (cgb) order.sort((a, b) => list[b] - list[a]);
    else order.sort((a, b) => (xs[b] - xs[a]) || (list[b] - list[a]));
    const masterPri = cgb && (this.lcdc & 1);
    for (const k of order) {
      const i = list[k], sx = xs[k], y = oam[i * 4] - 16;
      let tile = oam[i * 4 + 2]; const attr = oam[i * 4 + 3];
      let row = ly - y; if (attr & 0x40) row = h - 1 - row;
      if (tall) tile = (tile & 0xFE) | (row >> 3);
      const base = tile * 16 + (row & 7) * 2 + ((cgb && (attr & 8)) ? 0x2000 : 0);
      const b0 = vram[base], b1 = vram[base + 1];
      for (let px = 0; px < 8; px++) {
        const x = sx + px; if (x < 0 || x >= 160) continue;
        const bit = (attr & 0x20) ? px : 7 - px;
        const v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
        if (!v) continue;
        if (idx[x] !== 0) {
          if (masterPri && pri[x]) continue;
          if (attr & 0x80) continue;
        }
        if (cgb) out[o + x] = this.obCol[(attr & 7) * 4 + v];
        else out[o + x] = GB_DMG_COLORS[((attr & 0x10 ? this.obp1 : this.obp0) >> (v * 2)) & 3];
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GBPPU, GB_DMG_COLORS };
