'use strict';
/* PPU: renderização por scanline, sprites, scroll */
/* ================================ PPU ================================= */
const NES_PALETTE = [
  0x666666, 0x002A88, 0x1412A7, 0x3B00A4, 0x5C007E, 0x6E0040, 0x6C0600, 0x561D00,
  0x333500, 0x0B4800, 0x005200, 0x004F08, 0x00404D, 0x000000, 0x000000, 0x000000,
  0xADADAD, 0x155FD9, 0x4240FF, 0x7527FE, 0xA01ACC, 0xB71E7B, 0xB53120, 0x994E00,
  0x6B6D00, 0x388700, 0x0C9300, 0x008F32, 0x007C8D, 0x000000, 0x000000, 0x000000,
  0xFFFEFF, 0x64B0FF, 0x9290FF, 0xC676FF, 0xF36AFF, 0xFE6ECC, 0xFE8170, 0xEA9E22,
  0xBCBE00, 0x88D800, 0x5CE430, 0x45E082, 0x48CDDE, 0x4F4F4F, 0x000000, 0x000000,
  0xFFFEFF, 0xC0DFFF, 0xD3D2FF, 0xE8C8FF, 0xFBC2FF, 0xFEC4EA, 0xFECCC5, 0xF7D8A5,
  0xE4E594, 0xCFEF96, 0xBDF4AB, 0xB3F3CC, 0xB5EBF2, 0xB8B8B8, 0x000000, 0x000000
];
const PAL32 = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  const c = NES_PALETTE[i];
  PAL32[i] = (0xFF000000 | ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)) >>> 0;
}

class PPU {
  constructor(nes) {
    this.nes = nes;
    this.frame = new Uint32Array(256 * 240).fill(0xFF000000);
    this.vram = new Uint8Array(4096);
    this.pal = new Uint8Array(32);
    this.oam = new Uint8Array(256);
    this.bg = new Uint8Array(256);
    this.sp = new Uint8Array(256);
    this.spBehind = new Uint8Array(256);
    this.sp0 = new Uint8Array(256);
    this.reset();
  }
  reset() {
    this.ctrl = 0; this.mask = 0; this.status = 0; this.oamAddr = 0;
    this.v = 0; this.t = 0; this.fineX = 0; this.w = 0; this.buf = 0; this.openBus = 0;
    this.dot = 0; this.scanline = 261; this.odd = false; this.frameDone = false; this.hitDot = -1;
    this.vram.fill(0); this.pal.fill(0); this.oam.fill(0);
    this.frame.fill(0xFF000000);
  }

  ntIndex(a) {
    const t = (a >> 10) & 3; let n;
    switch (this.nes.cart.mirror) {
      case MIR_H: n = t >> 1; break;
      case MIR_V: n = t & 1; break;
      case MIR_S0: n = 0; break;
      case MIR_S1: n = 1; break;
      default: n = t;
    }
    return (n << 10) | (a & 0x3FF);
  }
  read(a) {
    a &= 0x3FFF;
    if (a < 0x2000) return this.nes.cart.chrRead(a);
    if (a < 0x3F00) return this.vram[this.ntIndex(a)];
    let i = a & 0x1F; if ((i & 0x13) === 0x10) i &= 0x0F;
    return this.pal[i];
  }
  write(a, v) {
    a &= 0x3FFF;
    if (a < 0x2000) this.nes.cart.chrWrite(a, v);
    else if (a < 0x3F00) this.vram[this.ntIndex(a)] = v;
    else { let i = a & 0x1F; if ((i & 0x13) === 0x10) i &= 0x0F; this.pal[i] = v & 0x3F; }
  }

  readReg(r) {
    switch (r) {
      case 2: {
        const val = (this.status & 0xE0) | (this.openBus & 0x1F);
        this.status &= ~0x80; this.w = 0; this.openBus = val; return val;
      }
      case 4: { let v = this.oam[this.oamAddr]; if ((this.oamAddr & 3) === 2) v &= 0xE3; this.openBus = v; return v; }
      case 7: {
        const a = this.v & 0x3FFF; let ret;
        if (a >= 0x3F00) { ret = this.read(a); this.buf = this.vram[this.ntIndex(a)]; }
        else { ret = this.buf; this.buf = this.read(a); }
        this.v = (this.v + ((this.ctrl & 4) ? 32 : 1)) & 0x7FFF;
        this.openBus = ret; return ret;
      }
      default: return this.openBus;
    }
  }
  writeReg(r, val) {
    this.openBus = val;
    switch (r) {
      case 0: {
        const old = this.ctrl; this.ctrl = val;
        this.t = (this.t & ~0xC00) | ((val & 3) << 10);
        if (!(old & 0x80) && (val & 0x80) && (this.status & 0x80)) this.nes.nmi = true;
        break;
      }
      case 1: this.mask = val; break;
      case 3: this.oamAddr = val; break;
      case 4: this.oam[this.oamAddr] = val; this.oamAddr = (this.oamAddr + 1) & 0xFF; break;
      case 5:
        if (this.w === 0) { this.fineX = val & 7; this.t = (this.t & ~0x1F) | (val >> 3); this.w = 1; }
        else { this.t = (this.t & ~0x73E0) | ((val & 7) << 12) | ((val >> 3) << 5); this.w = 0; }
        break;
      case 6:
        if (this.w === 0) { this.t = (this.t & 0x00FF) | ((val & 0x3F) << 8); this.w = 1; }
        else { this.t = (this.t & 0xFF00) | val; this.v = this.t; this.w = 0; }
        break;
      case 7:
        this.write(this.v & 0x3FFF, val);
        this.v = (this.v + ((this.ctrl & 4) ? 32 : 1)) & 0x7FFF;
        break;
    }
  }

  incY() {
    let v = this.v;
    if ((v & 0x7000) !== 0x7000) v += 0x1000;
    else {
      v &= ~0x7000;
      let y = (v & 0x3E0) >> 5;
      if (y === 29) { y = 0; v ^= 0x800; } else if (y === 31) y = 0; else y++;
      v = (v & ~0x3E0) | (y << 5);
    }
    this.v = v;
  }
  copyX() { this.v = (this.v & ~0x41F) | (this.t & 0x41F); }
  copyY() { this.v = (this.v & ~0x7BE0) | (this.t & 0x7BE0); }

  tick() {
    const sl = this.scanline, dot = this.dot, rend = (this.mask & 0x18) !== 0;
    if (sl < 240) {
      if (dot === 0) {
        this.hitDot = -1;
        if (rend) this.renderLine(sl);
        else this.frame.fill(PAL32[this.pal[0] & 0x3F], sl * 256, sl * 256 + 256);
      } else if (dot === this.hitDot) { this.status |= 0x40; this.hitDot = -1; }
      if (rend) {
        if (dot === 256) this.incY();
        else if (dot === 257) this.copyX();
        else if (dot === 260) this.nes.cart.scanline();
      }
    } else if (sl === 241) {
      if (dot === 1 && this.nes.xPre && !this.inExtra) this.runExtra(this.nes.xPre); // overclock: CPU ganha tempo antes do V-Blank
      if (dot === 1) { this.status |= 0x80; if (this.ctrl & 0x80) this.nes.nmi = true; this.frameDone = true; }
    } else if (sl === 261) {
      if (dot === 0 && this.nes.xPost && !this.inExtra) this.runExtra(this.nes.xPost); // V-Blank estendido
      if (dot === 1) this.status &= ~0xE0;
      if (rend) {
        if (dot === 257) this.copyX();
        else if (dot === 260) this.nes.cart.scanline();
        else if (dot === 280) this.copyY();
        else if (dot === 339 && this.odd) this.dot = 340;
      }
    }
    if (++this.dot >= 341) {
      this.dot = 0;
      if (++this.scanline >= 262) { this.scanline = 0; this.odd = !this.odd; }
    }
  }

  /* CPU-only: o relógio de vídeo e o som ficam parados enquanto a CPU recebe linhas extras */
  runExtra(lines) {
    this.inExtra = true;
    const cyc = Math.round(lines * 113.667), cpu = this.nes.cpu;
    for (let used = 0; used < cyc;) used += cpu.step();
    this.inExtra = false;
  }

  /* próximo ponto em que algo acontece nesta linha (>= dot); 341 = nada até o fim da linha */
  nextEvent() {
    const sl = this.scanline, dot = this.dot, rend = (this.mask & 0x18) !== 0;
    let e = 341;
    const pick = d => { if (d >= dot && d < e) e = d; };
    if (sl < 240) { pick(0); if (this.hitDot >= 0) pick(this.hitDot); if (rend) { pick(256); pick(257); pick(260); } }
    else if (sl === 241) pick(1);
    else if (sl === 261) { pick(0); pick(1); if (rend) { pick(257); pick(260); pick(280); pick(339); } }
    return e;
  }
  /* avança n pontos (dots) pulando os trechos sem eventos; equivale a chamar tick() n vezes */
  advance(n) {
    while (n > 0) {
      const e = this.nextEvent();
      if (e <= this.dot) { this.tick(); n--; continue; }
      const step = Math.min(n, e - this.dot);
      this.dot += step; n -= step;
      if (this.dot >= 341) { this.dot = 0; if (++this.scanline >= 262) { this.scanline = 0; this.odd = !this.odd; } }
    }
  }

  renderLine(y) {
    const cart = this.nes.cart, mask = this.mask, ctrl = this.ctrl, vram = this.vram, pal = this.pal;
    const bg = this.bg, sp = this.sp, behind = this.spBehind, sp0 = this.sp0;
    const showBG = (mask & 8) !== 0, showSP = (mask & 16) !== 0;

    if (showBG) {
      let v = this.v;
      const fineY = (v >> 12) & 7, pbase = (ctrl & 0x10) ? 0x1000 : 0, fx = this.fineX;
      for (let tile = 0; tile < 33; tile++) {
        const id = vram[this.ntIndex(0x2000 | (v & 0x0FFF))];
        let at = vram[this.ntIndex(0x23C0 | (v & 0x0C00) | ((v >> 4) & 0x38) | ((v >> 2) & 7))];
        at = (at >> (((v >> 4) & 4) | (v & 2))) & 3;
        const addr = pbase + id * 16 + fineY;
        const lo = cart.chrRead(addr), hi = cart.chrRead(addr + 8);
        const ax = tile * 8 - fx;
        for (let b = 0; b < 8; b++) {
          const px = ax + b;
          if (px < 0 || px > 255) continue;
          const c = ((lo >> (7 - b)) & 1) | (((hi >> (7 - b)) & 1) << 1);
          bg[px] = c ? ((at << 2) | c) : 0;
        }
        if ((v & 31) === 31) v = (v & ~31) ^ 0x400; else v++;
      }
      if (!(mask & 2)) for (let i = 0; i < 8; i++) bg[i] = 0;
    } else bg.fill(0);

    sp.fill(0); behind.fill(0); sp0.fill(0);
    if (showSP) {
      const h = (ctrl & 0x20) ? 16 : 8, oam = this.oam, leftSP = (mask & 4) !== 0;
      let count = 0;
      for (let i = 0; i < 64; i++) {
        const o = i * 4, row = y - (oam[o] + 1);
        if (row < 0 || row >= h) continue;
        if (++count > 8) { this.status |= 0x20; if (!this.nes.noLimit) break; }
        const tile = oam[o + 1], attr = oam[o + 2], sx = oam[o + 3];
        const r = (attr & 0x80) ? (h - 1 - row) : row;
        let addr;
        if (h === 8) addr = ((ctrl & 8) ? 0x1000 : 0) + tile * 16 + r;
        else addr = ((tile & 1) ? 0x1000 : 0) + (tile & 0xFE) * 16 + ((r & 8) ? 16 : 0) + (r & 7);
        const lo = cart.chrRead(addr), hi = cart.chrRead(addr + 8), flipH = attr & 0x40;
        for (let b = 0; b < 8; b++) {
          const px = sx + b;
          if (px > 255) break;
          if (px < 8 && !leftSP) continue;
          const bit = flipH ? b : 7 - b;
          const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
          if (!c || sp[px]) continue;
          sp[px] = 0x10 | ((attr & 3) << 2) | c;
          behind[px] = attr & 0x20 ? 1 : 0;
          if (i === 0) sp0[px] = 1;
        }
      }
    }

    const fb = this.frame, base = y * 256, gray = (mask & 1) ? 0x30 : 0x3F;
    let hit = -1;
    for (let x = 0; x < 256; x++) {
      const b = bg[x], s = sp[x];
      let idx;
      if (s && (b === 0 || !behind[x])) idx = s; else if (b) idx = b; else idx = 0;
      if (hit < 0 && x < 255 && sp0[x] && b && showBG && showSP) hit = x;
      fb[base + x] = PAL32[pal[idx] & gray];
    }
    if (hit >= 0 && !(this.status & 0x40)) this.hitDot = hit + 2;
  }
}

