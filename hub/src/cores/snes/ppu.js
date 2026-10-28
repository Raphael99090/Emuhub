'use strict';
/* PPU do SNES (S-PPU1/2): renderização por linha. Modos 0 a 4 e 7, sprites com limites reais de linha,
 * janelas, mosaico, matemática de cores (somar/subtrair/metade) com subtela. Modos de alta resolução
 * (5 e 6) e entrelaçamento são aproximados em baixa resolução. */
const SNES_OBJ_SIZES = [[8, 16], [8, 32], [8, 64], [16, 32], [16, 64], [32, 64], [16, 32], [16, 32]]; // larguras (pequeno, grande)
const SNES_OBJ_H = [[8, 16], [8, 32], [8, 64], [16, 32], [16, 64], [32, 64], [32, 64], [32, 32]]; // alturas
// ordem de prioridade (frente -> trás): camada*4 + prioridade (camada 4 = sprites)
const SNES_ORDER = (() => {
  const B = (l, p) => l * 4 + p, O = p => 4 * 4 + p;
  return {
    0: [O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), B(2, 1), B(3, 1), O(0), B(2, 0), B(3, 0)],
    1: [O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), B(2, 1), O(0), B(2, 0)],
    '1p': [B(2, 1), O(3), B(0, 1), B(1, 1), O(2), B(0, 0), B(1, 0), O(1), O(0), B(2, 0)],
    2: [O(3), B(0, 1), O(2), B(1, 1), O(1), B(0, 0), O(0), B(1, 0)],
    6: [O(3), B(0, 1), O(2), O(1), B(0, 0), O(0)],
    7: [O(3), O(2), O(1), B(0, 0), O(0)],
    '7x': [O(3), O(2), B(1, 1), O(1), B(0, 0), O(0), B(1, 0)]
  };
})();

class SNESPPU {
  constructor(sys) {
    this.sys = sys;
    this.frame = new Uint32Array(256 * 224);
    this.vram = new Uint8Array(65536);
    this.oam = new Uint8Array(544);
    this.cgram = new Uint16Array(256);
    this.bgcol = [new Uint8Array(272), new Uint8Array(272), new Uint8Array(272), new Uint8Array(272)];
    this.bgpri = [new Uint8Array(272), new Uint8Array(272), new Uint8Array(272), new Uint8Array(272)];
    this.objcol = new Uint8Array(272); this.objpri = new Uint8Array(272); this.objmath = new Uint8Array(272);
    this.masks = []; for (let i = 0; i < 12; i++) this.masks.push(new Uint8Array(256));
    this.ones = new Uint8Array(256).fill(1);
    this.rowTmp = new Uint8Array(272);
    this.reset();
  }
  reset() {
    this.vram.fill(0); this.oam.fill(0); this.cgram.fill(0);
    this.inidisp = 0x80; this.obsel = 0; this.oamAddr = 0; this.oamInt = 0; this.oamLatch = 0;
    this.bgmode = 0; this.mosaic = 0;
    this.bgsc = [0, 0, 0, 0]; this.bgnba = [0, 0, 0, 0];
    this.hofs = [0, 0, 0, 0]; this.vofs = [0, 0, 0, 0]; this.bgLatch = 0; this.m7Latch = 0;
    this.vmain = 0; this.vmaddr = 0; this.vprefetch = 0;
    this.cgadd = 0; this.cgLatch = 0; this.cgFlip = 0;
    this.m7sel = 0; this.m7 = [0, 0, 0, 0]; this.m7x = 0; this.m7y = 0; this.m7hofs = 0; this.m7vofs = 0; this.mpy = 0;
    this.wsel = [0, 0, 0]; this.wh = [0, 0, 0, 0]; this.wlog = [0, 0];
    this.tm = 0; this.ts = 0; this.tmw = 0; this.tsw = 0;
    this.cgwsel = 0; this.cgadsub = 0; this.fixR = 0; this.fixG = 0; this.fixB = 0; this.setini = 0;
    this.rangeOver = 0; this.timeOver = 0; this.field = 0; this.noLimit = false;
    this.frame.fill(0xFF000000);
  }
  beginFrame() { this.rangeOver = 0; this.timeOver = 0; }
  /* ---------- registradores ---------- */
  vramAddr() {
    const a = this.vmaddr;
    switch ((this.vmain >> 2) & 3) {
      case 1: return (a & 0xFF00) | ((a & 0xE0) >> 5) | ((a & 0x1F) << 3);
      case 2: return (a & 0xFE00) | ((a & 0x1C0) >> 6) | ((a & 0x3F) << 2);
      case 3: return (a & 0xFC00) | ((a & 0x380) >> 7) | ((a & 0x7F) << 1);
      default: return a;
    }
  }
  vramInc() { const m = this.vmain & 3; this.vmaddr = (this.vmaddr + (m === 0 ? 1 : m === 1 ? 32 : 128)) & 0x7FFF; }
  readReg(r) {
    switch (r) {
      case 0x2134: return this.mpy & 0xFF; case 0x2135: return (this.mpy >> 8) & 0xFF; case 0x2136: return (this.mpy >> 16) & 0xFF;
      case 0x2137: { const s = this.sys; this.sys.hLatch = (s.cyc >> 2) & 0x1FF; this.sys.vLatch = s.line; this.sys.latchFlag = 1; return s.mdr; }
      case 0x2138: {
        const i = this.oamInt, v = i >= 0x200 ? this.oam[0x200 + (i & 0x1F)] : this.oam[i]; this.oamInt = (i + 1) & 0x3FF; return v;
      }
      case 0x2139: { const v = this.vprefetch & 0xFF; if (!(this.vmain & 0x80)) { this.vprefetch = this.vramWord(); this.vramInc(); } return v; }
      case 0x213A: { const v = this.vprefetch >> 8; if (this.vmain & 0x80) { this.vprefetch = this.vramWord(); this.vramInc(); } return v; }
      case 0x213B: { const c = this.cgram[this.cgadd]; if (!this.cgFlip) { this.cgFlip = 1; return c & 0xFF; } this.cgFlip = 0; this.cgadd = (this.cgadd + 1) & 0xFF; return (c >> 8) & 0x7F; }
      case 0x213C: { const s = this.sys; if (!s.hSel) { s.hSel = 1; return s.hLatch & 0xFF; } s.hSel = 0; return (s.hLatch >> 8) & 1; }
      case 0x213D: { const s = this.sys; if (!s.vSel) { s.vSel = 1; return s.vLatch & 0xFF; } s.vSel = 0; return (s.vLatch >> 8) & 1; }
      case 0x213E: return 0x01 | (this.rangeOver ? 0x40 : 0) | (this.timeOver ? 0x80 : 0);
      case 0x213F: { const s = this.sys; s.hSel = 0; s.vSel = 0; s.latchFlag = 0; return 0x02 | (this.field ? 0x80 : 0); }
    }
    return this.sys.mdr;
  }
  vramWord() { const a = (this.vramAddr() & 0x7FFF) << 1; return this.vram[a] | (this.vram[a + 1] << 8); }
  writeReg(r, v) {
    switch (r) {
      case 0x2100: this.inidisp = v; return;
      case 0x2101: this.obsel = v; return;
      case 0x2102: this.oamAddr = (this.oamAddr & 0x100) | v; this.oamInt = this.oamAddr << 1; return;
      case 0x2103: this.oamAddr = (this.oamAddr & 0xFF) | ((v & 1) << 8); this.oamInt = this.oamAddr << 1; return;
      case 0x2104: {
        const i = this.oamInt;
        if (i >= 0x200) this.oam[0x200 + (i & 0x1F)] = v;
        else if (!(i & 1)) this.oamLatch = v;
        else { this.oam[i - 1] = this.oamLatch; this.oam[i] = v; }
        this.oamInt = (i + 1) & 0x3FF; return;
      }
      case 0x2105: this.bgmode = v; return;
      case 0x2106: this.mosaic = v; return;
      case 0x2107: case 0x2108: case 0x2109: case 0x210A: this.bgsc[r - 0x2107] = v; return;
      case 0x210B: this.bgnba[0] = v & 15; this.bgnba[1] = v >> 4; return;
      case 0x210C: this.bgnba[2] = v & 15; this.bgnba[3] = v >> 4; return;
      case 0x210D: this.m7hofs = this.sx13((v << 8) | this.m7Latch); this.m7Latch = v; // cai no caso comum de BG
      // eslint-disable-next-line no-fallthrough
      case 0x210F: case 0x2111: case 0x2113: {
        const n = (r - 0x210D) >> 1; this.hofs[n] = ((v << 8) | (this.bgLatch & ~7) | ((this.hofs[n] >> 8) & 7)) & 0x3FF; this.bgLatch = v; return;
      }
      case 0x210E: this.m7vofs = this.sx13((v << 8) | this.m7Latch); this.m7Latch = v;
      // eslint-disable-next-line no-fallthrough
      case 0x2110: case 0x2112: case 0x2114: {
        const n = (r - 0x210E) >> 1; this.vofs[n] = ((v << 8) | this.bgLatch) & 0x3FF; this.bgLatch = v; return;
      }
      case 0x2115: this.vmain = v; return;
      case 0x2116: this.vmaddr = (this.vmaddr & 0x7F00) | v; this.vprefetch = this.vramWord(); return;
      case 0x2117: this.vmaddr = (this.vmaddr & 0xFF) | ((v & 0x7F) << 8); this.vprefetch = this.vramWord(); return;
      case 0x2118: { const a = (this.vramAddr() & 0x7FFF) << 1; this.vram[a] = v; if (!(this.vmain & 0x80)) this.vramInc(); return; }
      case 0x2119: { const a = (this.vramAddr() & 0x7FFF) << 1; this.vram[a + 1] = v; if (this.vmain & 0x80) this.vramInc(); return; }
      case 0x211A: this.m7sel = v; return;
      case 0x211B: case 0x211C: case 0x211D: case 0x211E: {
        this.m7[r - 0x211B] = ((v << 8) | this.m7Latch) << 16 >> 16; this.m7Latch = v;
        if (r === 0x211B || r === 0x211C) this.mpy = this.m7[0] * (this.m7[1] >> 8 << 24 >> 24) | 0; // A x B(8 bits altos)
        return;
      }
      case 0x211F: this.m7x = this.sx13((v << 8) | this.m7Latch); this.m7Latch = v; return;
      case 0x2120: this.m7y = this.sx13((v << 8) | this.m7Latch); this.m7Latch = v; return;
      case 0x2121: this.cgadd = v; this.cgFlip = 0; return;
      case 0x2122:
        if (!this.cgFlip) { this.cgLatch = v; this.cgFlip = 1; } else { this.cgram[this.cgadd] = ((v & 0x7F) << 8) | this.cgLatch; this.cgadd = (this.cgadd + 1) & 0xFF; this.cgFlip = 0; }
        return;
      case 0x2123: this.wsel[0] = v; return; case 0x2124: this.wsel[1] = v; return; case 0x2125: this.wsel[2] = v; return;
      case 0x2126: this.wh[0] = v; return; case 0x2127: this.wh[1] = v; return; case 0x2128: this.wh[2] = v; return; case 0x2129: this.wh[3] = v; return;
      case 0x212A: this.wlog[0] = v; return; case 0x212B: this.wlog[1] = v; return;
      case 0x212C: this.tm = v; return; case 0x212D: this.ts = v; return; case 0x212E: this.tmw = v; return; case 0x212F: this.tsw = v; return;
      case 0x2130: this.cgwsel = v; return; case 0x2131: this.cgadsub = v; return;
      case 0x2132:
        if (v & 0x20) this.fixR = v & 31; if (v & 0x40) this.fixG = v & 31; if (v & 0x80) this.fixB = v & 31; return;
      case 0x2133: this.setini = v; return;
    }
  }
  sx13(v) { return (v & 0x1FFF) << 19 >> 19; }
  /* ---------- BGs ---------- */
  // bpp: 2, 4 ou 8; devolve índices de cgram em col (0 = transparente) e prioridade do tile em pri
  bg3Entry(c, r) { // entrada do mapa do BG3 (tiles de 8x8), usada pelo offset-per-tile
    const sc = this.bgsc[2], wide = sc & 1, tall = sc & 2;
    let scr = 0; if (wide && (c & 32)) scr += 1; if (tall && (r & 32)) scr += wide ? 2 : 1;
    const ea = ((((sc & 0xFC) << 8) + (scr << 10) + ((r & 31) << 5) + (c & 31)) & 0x7FFF) << 1;
    return this.vram[ea] | (this.vram[ea + 1] << 8);
  }
  renderBg(n, y, bpp, palBase, col, pri) {
    const vram = this.vram, sc = this.bgsc[n], big = (this.bgmode >> (4 + n)) & 1;
    const mapBase = (sc & 0xFC) << 8, size = sc & 3, chrBase = this.bgnba[n] << 12; // em palavras
    const mode = this.bgmode & 7, opt = (mode === 2 || mode === 4 || mode === 6) && n < 2;
    let py0 = (y + this.vofs[n]) & 0xFFFF;
    if ((this.mosaic >> n) & 1) { const m = (this.mosaic >> 4) + 1; if (m > 1) py0 = (py0 - (y % m)) & 0xFFFF; }
    const wide = size & 1, tall = size & 2, shift = big ? 4 : 3, tileWords = bpp * 4;
    const hofs = this.hofs[n], mask = n === 0 ? 0x2000 : 0x4000;
    let x = 0, ti = 0;
    const planes = bpp >> 1;
    while (x < 256) {
      let wx = hofs + x, py = py0;
      if (opt && ti > 0) {
        const c3 = ((this.hofs[2] & ~7) >> 3) + ti - 1, r3 = (this.vofs[2] >> 3);
        if (mode === 4) {
          const e = this.bg3Entry(c3, r3);
          if (e & mask) { if (e & 0x8000) py = (y + (e & 0x3FF)) & 0xFFFF; else wx = ((e & 0x3F8) | (hofs & 7)) + x; }
        } else {
          const eh = this.bg3Entry(c3, r3), ev = this.bg3Entry(c3, r3 + 1);
          if (eh & mask) wx = ((eh & 0x3F8) | (hofs & 7)) + x;
          if (ev & mask) py = (y + (ev & 0x3FF)) & 0xFFFF;
        }
      }
      const row = py >> 3, fine = py & 7, ty = py >> shift;
      const colN = wx >> 3, tcol = big ? colN >> 1 : colN, trow = big ? ty : row;
      let scr = 0; if (wide && (tcol & 32)) scr += 1; if (tall && (trow & 32)) scr += wide ? 2 : 1;
      const ea = ((mapBase + (scr << 10) + ((trow & 31) << 5) + (tcol & 31)) & 0x7FFF) << 1;
      const ent = vram[ea] | (vram[ea + 1] << 8);
      let ch = ent & 0x3FF, f = fine;
      const hf = ent & 0x4000, vf = ent & 0x8000;
      if (big) {
        let xs = colN & 1, ys = row & 1;
        if (hf) xs ^= 1; if (vf) ys ^= 1;
        ch = (ch + xs + (ys << 4)) & 0x3FF;
      }
      if (vf) f = 7 - f;
      const pal = (ent >> 10) & 7, pr = (ent >> 13) & 1;
      const wa = (chrBase + ch * tileWords + f) & 0x7FFF;
      let b0 = vram[wa << 1], b1 = vram[(wa << 1) + 1], b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, b7 = 0;
      if (planes > 1) { const w2 = (wa + 8) & 0x7FFF; b2 = vram[w2 << 1]; b3 = vram[(w2 << 1) + 1]; }
      if (planes > 2) { const w3 = (wa + 16) & 0x7FFF, w4 = (wa + 24) & 0x7FFF; b4 = vram[w3 << 1]; b5 = vram[(w3 << 1) + 1]; b6 = vram[w4 << 1]; b7 = vram[(w4 << 1) + 1]; }
      const px0 = wx & 7;
      const base = bpp === 2 ? palBase + pal * 4 : bpp === 4 ? pal * 16 : 0;
      for (let px = px0; px < 8 && x < 256; px++, x++) {
        const bit = hf ? px : 7 - px;
        let v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1);
        if (planes > 1) v |= (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        if (planes > 2) v |= (((b4 >> bit) & 1) << 4) | (((b5 >> bit) & 1) << 5) | (((b6 >> bit) & 1) << 6) | (((b7 >> bit) & 1) << 7);
        col[x] = v ? (bpp === 8 ? v : base + v) : 0; pri[x] = pr;
      }
      ti++;
    }
    if ((this.mosaic >> n) & 1) { const m = (this.mosaic >> 4) + 1; if (m > 1) for (let i = 0; i < 256; i++) { const s = i - (i % m); if (s !== i) { col[i] = col[s]; pri[i] = pri[s]; } } }
  }
  renderMode7(y, col, pri) {
    const vram = this.vram, a = this.m7[0], b = this.m7[1], c = this.m7[2], d = this.m7[3];
    const clip = n => (n & 0x2000) ? (n | ~1023) : (n & 1023);
    const cx = this.m7x, cy = this.m7y, ox = clip(this.m7hofs - cx), oy = clip(this.m7vofs - cy);
    const yy = (this.m7sel & 2) ? 255 - y : y;
    const X0 = ((a * ox) & ~63) + ((b * oy) & ~63) + ((b * yy) & ~63) + (cx << 8);
    const Y0 = ((c * ox) & ~63) + ((d * oy) & ~63) + ((d * yy) & ~63) + (cy << 8);
    const flipX = this.m7sel & 1, mode = this.m7sel >> 6;
    for (let x = 0; x < 256; x++) {
      const xx = flipX ? 255 - x : x;
      const px = (X0 + a * xx) >> 8, py = (Y0 + c * xx) >> 8;
      let v;
      if ((px | py) & ~1023) {
        if (mode === 2) { col[x] = 0; pri[x] = 0; continue; }
        if (mode === 3) v = vram[(((0) * 64 + ((py & 7) * 8 + (px & 7))) << 1) + 1];
        else v = vram[((((vram[((((py >> 3) & 127) << 7) + ((px >> 3) & 127)) << 1]) * 64) + ((py & 7) * 8 + (px & 7))) << 1) + 1];
      } else v = vram[((((vram[((((py >> 3) & 127) << 7) + ((px >> 3) & 127)) << 1]) * 64) + ((py & 7) * 8 + (px & 7))) << 1) + 1];
      col[x] = v; pri[x] = 0;
    }
  }
  /* ---------- sprites ---------- */
  renderObjs(y) {
    const oc = this.objcol, op = this.objpri, om = this.objmath, oam = this.oam, vram = this.vram;
    oc.fill(0, 0, 256); op.fill(255, 0, 256);
    const sel = this.obsel >> 5, sz = SNES_OBJ_SIZES[sel], small = sz[0], large = sz[1];
    const baseW = (this.obsel & 7) << 13, gapW = (((this.obsel >> 3) & 3) + 1) << 12;
    const list = [];
    for (let i = 0; i < 128; i++) {
      const hi = (oam[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2;
      const w = big ? large : small, h = SNES_OBJ_H[sel][big ? 1 : 0];
      const sy = oam[i * 4 + 1], dy = (y - sy - 1) & 0xFF;
      if (dy >= h) continue;
      let x = oam[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
      if (x + w <= 0 || x >= 256) continue;
      if (list.length >= 32) { this.rangeOver = 1; if (!this.noLimit) break; }
      list.push(i);
    }
    let tiles = 0;
    // limite de 34 fatias por linha: conta na ordem normal e corta o excesso
    const draw = [];
    for (let li = 0; li < list.length; li++) {
      const i = list[li], hi = (oam[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2, w = big ? large : small;
      let x = oam[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
      const nt = w >> 3; let cnt = 0;
      for (let t = 0; t < nt; t++) { const tx = x + t * 8; if (tx > -8 && tx < 256) cnt++; }
      if (!this.noLimit && tiles + cnt > 34) { this.timeOver = 1; const keep = 34 - tiles; draw.push([i, keep]); tiles = 34; break; }
      tiles += cnt; draw.push([i, 99]);
    }
    for (let di = draw.length - 1; di >= 0; di--) {
      const [i, keep] = draw[di], hi = (oam[0x200 + (i >> 2)] >> ((i & 3) * 2)) & 3, big = hi & 2;
      const w = big ? large : small, h = SNES_OBJ_H[sel][big ? 1 : 0];
      const attr = oam[i * 4 + 3], tile = oam[i * 4 + 2], pal = (attr >> 1) & 7, pr = (attr >> 4) & 3, hf = attr & 0x40, vf = attr & 0x80, nameSel = attr & 1;
      let x = oam[i * 4] | ((hi & 1) << 8); if (x >= 256) x -= 512;
      let dy = (y - oam[i * 4 + 1] - 1) & 0xFF; if (vf) dy = h - 1 - dy;
      const trow = dy >> 3, r = dy & 7, nt = w >> 3;
      let used = 0;
      for (let t = 0; t < nt; t++) {
        const tx = x + t * 8; if (tx <= -8 || tx >= 256) continue;
        if (++used > keep) break;
        const tcol = hf ? nt - 1 - t : t;
        const ch = (((tile & 0xF0) + (trow << 4)) & 0xF0) | (((tile & 0x0F) + tcol) & 0x0F);
        const wa = (baseW + (nameSel ? gapW : 0) + (ch << 4) + r) & 0x7FFF;
        const b0 = vram[wa << 1], b1 = vram[(wa << 1) + 1], w2 = (wa + 8) & 0x7FFF, b2 = vram[w2 << 1], b3 = vram[(w2 << 1) + 1];
        for (let px = 0; px < 8; px++) {
          const sx = tx + px; if (sx < 0 || sx >= 256) continue;
          const bit = hf ? px : 7 - px;
          const v = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
          if (v) { oc[sx] = 128 + pal * 16 + v; op[sx] = pr; om[sx] = pal >= 4 ? 1 : 0; }
        }
      }
    }
  }
  /* ---------- janelas ---------- */
  windowMask(layer, out) {
    // layer 0-3 BG, 4 OBJ, 5 janela de cor; out[x] = 1 dentro da janela
    const ws = layer < 2 ? this.wsel[0] >> (layer * 4) : layer < 4 ? this.wsel[1] >> ((layer - 2) * 4) : layer === 4 ? this.wsel[2] : this.wsel[2] >> 4;
    const lg = layer < 4 ? (this.wlog[0] >> (layer * 2)) & 3 : layer === 4 ? this.wlog[1] & 3 : (this.wlog[1] >> 2) & 3;
    const w1 = ws & 2, w2 = ws & 8, i1 = (ws & 1) !== 0, i2 = (ws & 4) !== 0;
    const l1 = this.wh[0], r1 = this.wh[1], l2 = this.wh[2], r2 = this.wh[3];
    for (let x = 0; x < 256; x++) {
      let a = false, b = false;
      if (w1) a = (x >= l1 && x <= r1) !== i1;
      if (w2) b = (x >= l2 && x <= r2) !== i2;
      let r;
      if (w1 && w2) r = lg === 0 ? (a || b) : lg === 1 ? (a && b) : lg === 2 ? (a !== b) : (a === b);
      else if (w1) r = a; else if (w2) r = b; else r = false;
      out[x] = r ? 1 : 0;
    }
  }
  /* ---------- linha ---------- */
  renderLine(y) {
    const out = this.frame, o = y * 256;
    const bright = this.inidisp & 15;
    if (this.inidisp & 0x80) { out.fill(0xFF000000, o, o + 256); return; }
    const mode = this.bgmode & 7, tm = this.tm, ts = this.ts;
    const need = tm | ts;
    // camadas
    let nbg = 4, bpps;
    switch (mode) {
      case 0: bpps = [2, 2, 2, 2]; break;
      case 1: bpps = [4, 4, 2, 0]; break;
      case 2: bpps = [4, 4, 0, 0]; break;
      case 3: bpps = [8, 4, 0, 0]; break;
      case 4: bpps = [8, 2, 0, 0]; break;
      case 5: bpps = [4, 2, 0, 0]; break;
      case 6: bpps = [4, 0, 0, 0]; break;
      default: bpps = [0, 0, 0, 0];
    }
    const ext = mode === 7 && (this.setini & 0x40) !== 0;
    if (mode === 7) {
      if (need & (ext ? 3 : 1)) {
        const c0 = this.bgcol[0];
        this.renderMode7(y, c0, this.bgpri[0]);
        if (ext && (need & 2)) { const c1 = this.bgcol[1], p1 = this.bgpri[1]; for (let i = 0; i < 256; i++) { const v = c0[i]; c1[i] = v & 0x7F; p1[i] = v >> 7; } }
      }
    }
    else for (let n = 0; n < nbg; n++) {
      if (!bpps[n] || !((need >> n) & 1)) continue;
      this.renderBg(n, y, bpps[n], mode === 0 ? n * 32 : 0, this.bgcol[n], this.bgpri[n]);
    }
    const objOn = (need & 0x10) !== 0;
    if (objOn) this.renderObjs(y);
    // janelas
    const useWin = (this.tmw | this.tsw) & 0x1F, msk = this.masks;
    for (let l = 0; l < 5; l++) if ((useWin >> l) & 1) this.windowMask(l, msk[l]);
    const cgw = this.cgwsel, mathOn = this.cgadsub & 0x3F;
    const needColorWin = (cgw & 0xF0) !== 0;
    if (needColorWin) this.windowMask(5, msk[5]);
    const order = ext ? SNES_ORDER['7x'] : mode === 1 ? ((this.bgmode & 8) ? SNES_ORDER['1p'] : SNES_ORDER[1]) : SNES_ORDER[mode === 3 || mode === 4 || mode === 5 ? 2 : mode] || SNES_ORDER[2];
    const cg = this.cgram, fixed = (this.fixB << 10) | (this.fixG << 5) | this.fixR;
    const addSub = (cgw & 2) !== 0, sub = (this.cgadsub & 0x80) !== 0, half = (this.cgadsub & 0x40) !== 0;
    const colors = this.bgcol, pris = this.bgpri, oc = this.objcol, op = this.objpri, om = this.objmath;
    const tmw = this.tmw, tsw = this.tsw;
    const doSub = mathOn !== 0 && addSub;
    for (let x = 0; x < 256; x++) {
      // pixel da tela principal
      let c15 = cg[0], layer = 5, ci = 0;
      for (let k = 0; k < order.length; k++) {
        const e = order[k], L = e >> 2, p = e & 3;
        if (!((tm >> L) & 1)) continue;
        if (L === 4) { if (op[x] !== p) continue; if (((tmw >> 4) & 1) && msk[4][x]) continue; ci = oc[x]; }
        else { if (!colors[L][x] || pris[L][x] !== p) continue; if (((tmw >> L) & 1) && msk[L][x]) continue; ci = colors[L][x]; }
        c15 = cg[ci]; layer = L === 4 ? (om[x] ? 4 : 6) : L; break;
      }
      // matemática de cores
      let r;
      if (mathOn) {
        let inMath = true, clip = false;
        if (needColorWin) {
          const w = msk[5][x];
          const pm = (cgw >> 4) & 3, cm = (cgw >> 6) & 3;
          if (pm === 3 || (pm === 1 && !w) || (pm === 2 && w)) inMath = false;
          if (cm === 3 || (cm === 1 && !w) || (cm === 2 && w)) clip = true;
        }
        if (clip) c15 = 0;
        const lbit = layer === 5 ? 5 : layer === 6 ? -1 : layer;
        if (inMath && lbit >= 0 && ((this.cgadsub >> lbit) & 1)) {
          let s15 = fixed, subLayer = false;
          if (addSub) {
            // subtela
            for (let k = 0; k < order.length; k++) {
              const e = order[k], L = e >> 2, p = e & 3;
              if (!((ts >> L) & 1)) continue;
              let sc;
              if (L === 4) { if (op[x] !== p) continue; if (((tsw >> 4) & 1) && msk[4][x]) continue; sc = oc[x]; }
              else { if (!colors[L][x] || pris[L][x] !== p) continue; if (((tsw >> L) & 1) && msk[L][x]) continue; sc = colors[L][x]; }
              s15 = cg[sc]; subLayer = true; break;
            }
            if (!subLayer) s15 = fixed;
          }
          const h = half && (!addSub || subLayer);
          let mr = c15 & 31, mg = (c15 >> 5) & 31, mb = (c15 >> 10) & 31;
          const sr = s15 & 31, sg = (s15 >> 5) & 31, sb = (s15 >> 10) & 31;
          if (sub) { mr -= sr; mg -= sg; mb -= sb; if (mr < 0) mr = 0; if (mg < 0) mg = 0; if (mb < 0) mb = 0; }
          else { mr += sr; mg += sg; mb += sb; }
          if (h) { mr >>= 1; mg >>= 1; mb >>= 1; }
          if (mr > 31) mr = 31; if (mg > 31) mg = 31; if (mb > 31) mb = 31;
          c15 = mr | (mg << 5) | (mb << 10);
        }
      }
      let R = c15 & 31, G = (c15 >> 5) & 31, Bl = (c15 >> 10) & 31;
      if (bright !== 15) { const f = bright + 1; R = (R * f) >> 4; G = (G * f) >> 4; Bl = (Bl * f) >> 4; }
      out[o + x] = 0xFF000000 | (((Bl << 3) | (Bl >> 2)) << 16) | (((G << 3) | (G >> 2)) << 8) | ((R << 3) | (R >> 2));
    }
  }
}

if (typeof module !== 'undefined') module.exports = { SNESPPU };
