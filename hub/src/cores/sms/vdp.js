'use strict';
/* VDP do Master System / Game Gear (modo 4): fundo com rolagem, sprites 8x8/8x16 (com zoom),
 * interrupções de quadro e de linha, contadores V/H, paleta CRAM (6 bits no SMS, 12 bits no GG). */
const SMS_LINES = 262, SMS_CYC_LINE = 228;

class SMSVDP {
  constructor(m) {
    this.m = m; this.gg = false;
    this.vram = new Uint8Array(0x4000); this.cram = new Uint8Array(64); this.pal = new Uint32Array(32);
    this.regs = new Uint8Array(16);
    this.frame = new Uint32Array(256 * 192);
    this.lineBuf = new Uint8Array(256 + 16); this.prioBuf = new Uint8Array(256 + 16); this.sprMask = new Uint8Array(256 + 16);
    this.reset();
  }
  reset() {
    this.vram.fill(0); this.cram.fill(0); this.regs.fill(0);
    this.regs[0] = 0x04; this.regs[1] = 0x00; this.regs[2] = 0xFF; this.regs[3] = 0xFF; this.regs[4] = 0xFF; this.regs[5] = 0xFF; this.regs[6] = 0xFF; this.regs[10] = 0xFF;
    this.addr = 0; this.code = 0; this.latch = false; this.low = 0; this.buf = 0;
    this.vint = false; this.lineIrq = false; this.ovf = false; this.col = false;
    this.line = 0; this.lineCnt = 0xFF; this.hLatch = 0;
    for (let i = 0; i < 32; i++) this.setPal(i);
    this.updateIrq();
  }
  updateIrq() { const r = this.regs; this.m.cpu.irqLine = (this.vint && (r[1] & 0x20) !== 0) || (this.lineIrq && (r[0] & 0x10) !== 0); }
  setPal(i) {
    if (this.gg) {
      const v = this.cram[i * 2] | (this.cram[i * 2 + 1] << 8);
      this.pal[i] = 0xFF000000 | (((v >> 8) & 15) * 17 << 16) | (((v >> 4) & 15) * 17 << 8) | ((v & 15) * 17);
    } else {
      const v = this.cram[i];
      this.pal[i] = 0xFF000000 | (((v >> 4) & 3) * 85 << 16) | (((v >> 2) & 3) * 85 << 8) | ((v & 3) * 85);
    }
  }
  /* ---- portas ---- */
  readData() {
    this.latch = false;
    const v = this.buf; this.buf = this.vram[this.addr]; this.addr = (this.addr + 1) & 0x3FFF; return v;
  }
  writeData(v) {
    this.latch = false;
    if (this.code === 3) {
      if (this.gg) { const i = this.addr & 63; this.cram[i] = v; this.setPal(i >> 1); }
      else { const i = this.addr & 31; this.cram[i] = v; this.setPal(i); }
    } else this.vram[this.addr] = v;
    this.buf = v; this.addr = (this.addr + 1) & 0x3FFF;
  }
  readStatus() {
    const v = (this.vint ? 0x80 : 0) | (this.ovf ? 0x40 : 0) | (this.col ? 0x20 : 0) | 0x1F;
    this.vint = false; this.lineIrq = false; this.ovf = false; this.col = false; this.latch = false;
    this.updateIrq(); return v;
  }
  writeCtrl(v) {
    if (!this.latch) { this.low = v; this.latch = true; this.addr = (this.addr & 0x3F00) | v; return; }
    this.latch = false; this.code = v >> 6; this.addr = ((v & 0x3F) << 8) | this.low;
    if (this.code === 0) { this.buf = this.vram[this.addr]; this.addr = (this.addr + 1) & 0x3FFF; }
    else if (this.code === 2) {
      const r = v & 15; this.regs[r] = this.low;
      if (r === 0 || r === 1) this.updateIrq();
    }
  }
  vcounter() { const l = this.line; return l <= 0xDA ? l : l - 6; }
  hcounter() { return (((this.m.cyc || 0) * 342 / SMS_CYC_LINE) >> 1) & 255; }
  /* ---- início de cada linha: contadores, interrupções e desenho ---- */
  startLine(line) {
    this.line = line; const r = this.regs;
    if (line <= 192) {
      if (this.lineCnt === 0) { this.lineCnt = r[10]; this.lineIrq = true; } else this.lineCnt--;
    } else this.lineCnt = r[10];
    if (line === 193) this.vint = true;
    this.updateIrq();
    if (line < 192) this.renderLine(line);
  }
  renderLine(line) {
    const r = this.regs, vram = this.vram, pal = this.pal, out = this.frame, o = line * 256;
    const bd = pal[16 + (r[7] & 15)];
    if (!(r[1] & 0x40)) { for (let x = 0; x < 256; x++) out[o + x] = bd; return; }
    const lb = this.lineBuf, pb = this.prioBuf;
    // fundo: pixel de tela x mostra o pixel (x - rolagem) do mapa; colunas 24-31 podem ignorar a rolagem vertical
    const nameBase = (r[2] & 0x0E) << 10;
    const sx = (r[0] & 0x40) && line < 16 ? 0 : r[8], vlock = (r[0] & 0x80) !== 0, yScroll = r[9];
    const tp = this.tilePix || (this.tilePix = new Uint8Array(8));
    let key = -1, tpri = 0;
    for (let x = 0; x < 256; x++) {
      const mx = (x - sx) & 255, vl = vlock && x >= 192 ? 1 : 0, k = (mx >> 3) * 2 + vl;
      if (k !== key) {
        key = k;
        const ys = vl ? line : (line + yScroll) % 224, row = ys >> 3, py = ys & 7;
        const ne = nameBase + ((row << 5) + (mx >> 3)) * 2, lo = vram[ne], hi = vram[ne + 1];
        const tile = lo | ((hi & 1) << 8), hf = hi & 2, vf = hi & 4, palOff = (hi & 8) ? 16 : 0;
        tpri = (hi & 0x10) ? 1 : 0;
        const ta = tile * 32 + ((vf ? 7 - py : py) << 2), b0 = vram[ta], b1 = vram[ta + 1], b2 = vram[ta + 2], b3 = vram[ta + 3];
        for (let px = 0; px < 8; px++) {
          const bit = hf ? px : 7 - px;
          tp[px] = (((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3)) + palOff;
        }
      }
      const c = tp[mx & 7]; lb[x] = c; pb[x] = tpri && (c & 15) ? 1 : 0;
    }
    // sprites
    const sm = this.sprMask; sm.fill(0, 0, 256);
    const tall = (r[1] & 2) !== 0, zoom = (r[1] & 1) !== 0, h = (tall ? 16 : 8) * (zoom ? 2 : 1);
    const sat = (r[5] & 0x7E) << 7, tileBank = (r[6] & 4) ? 256 : 0, shift = (r[0] & 8) ? 8 : 0;
    let n = 0; const list = this.sprList || (this.sprList = new Uint8Array(8));
    for (let i = 0; i < 64; i++) {
      const y = vram[sat + i];
      if (y === 0xD0) break;
      const top = (y + 1) & 255, dy = (line - top) & 255;
      if (dy < h) { if (n < 8) list[n++] = i; else { this.ovf = true; break; } }
    }
    // em ordem de índice: o primeiro sprite a pintar um pixel vence; dois sprites no mesmo pixel marcam colisão
    const used = this.sprUsed || (this.sprUsed = new Uint8Array(256));
    used.fill(0);
    for (let k = 0; k < n; k++) {
      const i = list[k], y = vram[sat + i], xx = vram[sat + 0x80 + i * 2] - shift, tn = vram[sat + 0x81 + i * 2];
      let row = ((line - ((y + 1) & 255)) & 255); if (zoom) row >>= 1;
      let tile = tn | tileBank; if (tall) tile = (tile & ~1) | (row >> 3);
      const ta = tile * 32 + ((row & 7) << 2), b0 = vram[ta], b1 = vram[ta + 1], b2 = vram[ta + 2], b3 = vram[ta + 3];
      const w = zoom ? 16 : 8;
      for (let px = 0; px < w; px++) {
        const x = xx + px; if (x < 0 || x > 255) continue;
        const bit = 7 - (zoom ? px >> 1 : px);
        const c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
        if (!c) continue;
        if (used[x]) { this.col = true; continue; }
        used[x] = 1;
        if (pb[x]) continue; // fundo com prioridade cobre o sprite
        sm[x] = c + 16 + 1; // +1 para distinguir de 0
      }
    }
    const mask = (r[0] & 0x20) !== 0;
    for (let x = 0; x < 256; x++) {
      let c;
      if (mask && x < 8) c = bd;
      else if (sm[x]) c = pal[sm[x] - 1];
      else c = pal[lb[x]];
      out[o + x] = c;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { SMSVDP, SMS_LINES, SMS_CYC_LINE };
