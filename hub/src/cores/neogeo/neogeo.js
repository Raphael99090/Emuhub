'use strict';
/* Máquina Neo Geo (MVS/AES): 68000 a 12 MHz + Z80 a 4 MHz + YM2610 + LSPC (vídeo).
 * Vídeo: 320x224, 264 linhas por quadro (59,19 Hz), camada fixa 8x8 e até 381 sprites com encadeamento e encolhimento.
 * Precisa da BIOS do sistema (o usuário fornece). Jogos: conjunto estilo MAME (P, S, M, V, C). */
const FIXORD = [16, 24, 0, 8];
const NG_LINES = 264, NG_CPL = 768, NG_ZPL = 256;

class NeoGeo {
  constructor() {
    this.cpu = new M68K(this); this.ym = new YM2610();
    const me = this;
    this.zbus = {
      read: a => me.zr(a), write: (a, v) => me.zw(a, v), portIn: p => me.zin(p), portOut: (p, v) => me.zout(p, v)
    };
    this.z80 = new Z80(this.zbus);
    this.bios = new Uint8Array(0x20000); this.sfix = new Uint8Array(0x20000); this.zoom = null; this.sm1 = null;
    this.p = new Uint8Array(0x100000); this.s = new Uint8Array(0); this.m1 = new Uint8Array(0x10000);
    this.spr1 = new Uint8Array(64); this.spr2 = new Uint8Array(64); this.nTiles = 1; this.hasBios = false;
    this.wram = new Uint8Array(0x10000); this.sram = new Uint8Array(0x10000); this.zram = new Uint8Array(0x800);
    this.vram = new Uint16Array(0x8800); this.pal = [new Uint16Array(0x1000), new Uint16Array(0x1000)]; this.pcache = [new Uint32Array(0x1000), new Uint32Array(0x1000)];
    this.frame = new Uint32Array(320 * 224); this.lineBuf = new Uint32Array(320); this.lineDepth = new Uint8Array(320);
    this.buttons = [0, 0]; this.reset();
  }
  reset() {
    this.vecBios = true; this.fixBios = true; this.palBank = 0; this.sramLocked = true; this.pbank = 0;
    this.vaddr = 0; this.vmod = 0; this.mode = 0; this.tmrReload = 0; this.tmrCnt = 0; this.tmrRun = false; this.irqP = 4; this.anim = 0; this.animDiv = 0; this.frameNo = 0;
    this.cyc = 0; this.rtc = { cmd: 0, cmdShift: 0, mode: 0, reg: [], clk: 0, stb: 0, tp: 64, ival: 0 }; this.latch = 0; this.reply = 0; this.nmiOn = false; this.zb = [0x1E, 0x0E, 0x06, 0x02]; this.zc = 0; this.ymAcc = 0; this.line = 0; this.cycDebt = 0; this.wdog = 0;
    this.wram.fill(0); this.zram.fill(0);
    this.cpu.reset(); this.z80.reset(); this.ym.reset(); this.updateIrq();
  }
  /* ---- carregamento ---- */
  setBios(b) { // { bios, sfix, zoom, sm1 }
    if (b.bios) { this.bios = new Uint8Array(0x20000); this.bios.set(b.bios.subarray(0, 0x20000)); if (b.bios.length < 0x20000) for (let o = b.bios.length; o < 0x20000; o += b.bios.length) this.bios.set(b.bios.subarray(0, Math.min(b.bios.length, 0x20000 - o)), o); this.hasBios = true; }
    if (b.sfix) this.sfix = b.sfix; if (b.zoom) this.zoom = b.zoom; if (b.sm1) this.sm1 = b.sm1;
  }
  loadSet(set) { // { p, s, m1, v, c1, c2 }
    this.p = set.p; this.s = set.s || new Uint8Array(0); this.m1 = set.m1 && set.m1.length ? set.m1 : (this.sm1 || new Uint8Array(0x10000));
    this.ym.rom = set.v || new Uint8Array(0);
    this.spr1 = set.c1 && set.c1.length ? set.c1 : new Uint8Array(64); this.spr2 = set.c2 && set.c2.length ? set.c2 : new Uint8Array(64);
    this.nTiles = Math.max(1, Math.min(this.spr1.length, this.spr2.length) >> 6);
    this.reset();
  }
  /* ---- 68000: leituras ---- */
  p16(a) { const p = this.p; a %= Math.max(2, p.length); return (p[a] << 8) | p[a + 1 < p.length ? a + 1 : 0]; }
  r8(a) { return (this.r16(a & 0xFFFFFE) >> ((a & 1) ? 0 : 8)) & 255; }
  r16(a) {
    a &= 0xFFFFFF;
    switch (a >>> 20) {
      case 0: if (a < 0x80 && this.vecBios) return (this.bios[a] << 8) | this.bios[a + 1]; return this.p16(a);
      case 1: { const o = a & 0xFFFE; return (this.wram[o] << 8) | this.wram[o + 1]; }
      case 2: return this.p16(0x100000 + this.pbank * 0x100000 + (a & 0xFFFFF));
      case 3: return this.ioRead(a);
      case 4: case 5: case 6: case 7: return this.pal[this.palBank][(a & 0x1FFE) >> 1];
      case 8: case 9: case 10: case 11: return 0xFFFF;
      case 12: { const o = a & 0x1FFFE; return (this.bios[o] << 8) | this.bios[o + 1]; }
      case 13: { const o = a & 0xFFFE; return (this.sram[o] << 8) | this.sram[o + 1]; }
      default: return 0xFFFF;
    }
  }
  ioRead(a) {
    switch ((a >> 16) & 15) {
      case 0: if (a & 0x80) return 0xFF80 | 0x7F; return (this.joy(0) << 8) | 0xFF;
      case 2: return (this.reply << 8) | this.coin();
      case 4: return (this.joy(1) << 8) | 0xFF;
      case 8: return 0xFF00 | this.sysIn();
      case 12: return this.lspcRead((a >> 1) & 7);
      default: return 0xFFFF;
    }
  }
  joy(n) { const b = this.buttons[n]; let r = 0xFF; if (b & 16) r &= ~1; if (b & 32) r &= ~2; if (b & 64) r &= ~4; if (b & 128) r &= ~8; if (b & 1) r &= ~16; if (b & 2) r &= ~32; if (b & 256) r &= ~64; if (b & 512) r &= ~128; return r; }
  coin() {
    let r = 0x3F; if (this.buttons[0] & 4) r &= ~1;
    const t = this.rtc, f = t.tp; if (Math.floor(this.cyc / (12000000 / (2 * f))) & 1) r |= 0x40;   // TP: onda quadrada na frequência escolhida
    if (t.reg.length && t.reg[0]) r |= 0x80;                                                          // saída de dados do relógio
    return r;
  }
  /* uPD4990A (relógio): bits do porto 380051: 0 = dados, 1 = clock, 2 = strobe */
  rtcCtl(v) {
    const t = this.rtc, di = v & 1, clk = (v >> 1) & 1, stb = (v >> 2) & 1;
    if (clk && !t.clk) {                       // borda de subida do clock
      t.cmdShift = ((t.cmdShift >> 1) | (di << 3)) & 15;
      if (t.mode === 1 && t.reg.length) { t.reg.shift(); t.reg.push(di); }
    }
    if (stb && !t.stb) {                       // strobe: executa o comando
      const c = t.cmdShift;
      if (c === 0) t.mode = 0;
      else if (c === 1) t.mode = 1;
      else if (c === 3) { t.mode = 0; t.reg = this.rtcTime(); }
      else if (c >= 4 && c <= 7) t.tp = [64, 256, 2048, 4096][c - 4];
      else if (c >= 8 && c <= 11) t.tp = [1, 0.1, 1 / 30, 1 / 60][c - 8] * (c === 8 ? 1 : 10);
    }
    t.clk = clk; t.stb = stb;
  }
  rtcTime() {   // 48 bits, menos significativo primeiro: seg, min, hora, dia (BCD), dia da semana e mês (4 bits), ano (BCD)
    const d = new Date(), bcd = n => ((n / 10 | 0) << 4) | (n % 10), bits = [];
    const put = (v, n) => { for (let i = 0; i < n; i++) bits.push((v >> i) & 1); };
    put(bcd(d.getSeconds()), 8); put(bcd(d.getMinutes()), 8); put(bcd(d.getHours()), 8); put(bcd(d.getDate()), 8);
    put(d.getDay(), 4); put(d.getMonth() + 1, 4); put(bcd(d.getFullYear() % 100), 8);
    return bits;
  }
  sysIn() { const b = this.buttons[0], c = this.buttons[1]; let r = 0xFF; if (b & 8) r &= ~1; if (b & 4) r &= ~2; if (c & 8) r &= ~4; if (c & 4) r &= ~8; return r; }
  /* ---- 68000: escritas ---- */
  w8(a, v) {
    a &= 0xFFFFFF; const g = a >>> 20;
    if (g === 1) { this.wram[a & 0xFFFF] = v; return; }
    if (g === 13) { if (!this.sramLocked) this.sram[a & 0xFFFF] = v; return; }
    if (g === 3) {
      const r = (a >> 16) & 15;
      if (r === 2 && !(a & 1)) { this.latch = v; this.nmiPend = true; if (this.nmiOn) this.z80.nmi = true; return; } // comando de som
      if (r === 8 && (a & 1) && (a & 0xFFFF) === 0x51) { this.rtcCtl(v); return; }
      if (r === 10 && (a & 1)) return this.sysCtl(a & 0x1F);
      if (r === 12) { this.lspcWrite((a >> 1) & 7, (a & 1) ? v : v << 8); return; }
      return;
    }
    if (g >= 4 && g <= 7) { const i = (a & 0x1FFE) >> 1, pl = this.pal[this.palBank], w = pl[i]; this.setPal(i, (a & 1) ? (w & 0xFF00) | v : (w & 0x00FF) | (v << 8)); return; }
  }
  w16(a, v) {
    a &= 0xFFFFFF; const g = a >>> 20;
    switch (g) {
      case 1: { const o = a & 0xFFFE; this.wram[o] = v >> 8; this.wram[o + 1] = v & 255; return; }
      case 2: if (a >= 0x2FFFF0) this.pbank = v & 0xFF; return; // troca de banco da ROM de programa
      case 3: {
        const r = (a >> 16) & 15;
        if (r === 12) this.lspcWrite((a >> 1) & 7, v);
        else if (r === 2) { this.latch = v >> 8; this.nmiPend = true; if (this.nmiOn) this.z80.nmi = true; }
        else if (r === 10) this.sysCtl((a & 0x1F) | 1);
        return;
      }
      case 4: case 5: case 6: case 7: this.setPal((a & 0x1FFE) >> 1, v); return;
      case 13: if (!this.sramLocked) { const o = a & 0xFFFE; this.sram[o] = v >> 8; this.sram[o + 1] = v & 255; } return;
    }
  }
  sysCtl(r) {
    switch (r) {
      case 0x03: this.vecBios = true; break; case 0x13: this.vecBios = false; break;
      case 0x0B: this.fixBios = true; break; case 0x1B: this.fixBios = false; break;
      case 0x0D: this.sramLocked = true; break; case 0x1D: this.sramLocked = false; break;
      case 0x0F: this.palBank = 1; break; case 0x1F: this.palBank = 0; break;
    }
  }
  setPal(i, v) {
    const bk = this.palBank; this.pal[bk][i] = v;
    const dark = (v >> 15) & 1, r = (((v >> 8) & 15) << 1) | ((v >> 14) & 1), g = (((v >> 4) & 15) << 1) | ((v >> 13) & 1), b = ((v & 15) << 1) | ((v >> 12) & 1);
    const c = (x) => { const c6 = (x << 1) | (dark ? 0 : 1); return (c6 << 2) | (c6 >> 4); };
    this.pcache[bk][i] = (0xFF000000 | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
  }
  /* ---- LSPC ---- */
  vidx(a) { return a < 0x8000 ? a : 0x8000 | (a & 0x7FF); }
  lspcRead(r) {
    switch (r) {
      case 0: case 1: return this.vram[this.vidx(this.vaddr)];
      case 2: return this.vmod & 0xFFFF;
      case 3: return ((((this.line + 0xF8) & 0x1FF) << 7) | (this.anim & 7)) & 0xFFFF;
    }
    return 0xFFFF;
  }
  lspcWrite(r, v) {
    v &= 0xFFFF;
    switch (r) {
      case 0: this.vaddr = v; break;
      case 1: this.vram[this.vidx(this.vaddr)] = v; this.vaddr = (this.vaddr & 0x8000) | ((this.vaddr + this.vmod) & 0x7FFF); break;
      case 2: this.vmod = (v << 16) >> 16; break;
      case 3: this.mode = v; break;
      case 4: this.tmrReload = (this.tmrReload & 0xFFFF) | (v << 16); break;
      case 5: this.tmrReload = (this.tmrReload & 0xFFFF0000) | v; if (this.mode & 0x40) { this.tmrCnt = this.tmrReload; this.tmrRun = true; } break;
      case 6: if (v & 1) this.irqP &= ~4; if (v & 2) this.irqP &= ~2; if (v & 4) this.irqP &= ~1; this.updateIrq(); break;
    }
  }
  updateIrq() { this.cpu.irq = (this.irqP & 4) ? 3 : (this.irqP & 2) ? 2 : (this.irqP & 1) ? 1 : 0; }
  /* ---- Z80 ---- */
  zr(a) {
    if (a < 0x8000) return this.m1[a % this.m1.length];
    if (a < 0xC000) return this.m1[((this.zb[0] << 14) + (a - 0x8000)) % this.m1.length];
    if (a < 0xE000) return this.m1[((this.zb[1] << 13) + (a - 0xC000)) % this.m1.length];
    if (a < 0xF000) return this.m1[((this.zb[2] << 12) + (a - 0xE000)) % this.m1.length];
    if (a < 0xF800) return this.m1[((this.zb[3] << 11) + (a - 0xF000)) % this.m1.length];
    return this.zram[a & 0x7FF];
  }
  zw(a, v) { if (a >= 0xF800) this.zram[a & 0x7FF] = v; }
  zin(p) {
    const lo = p & 0xFF, hi = (p >> 8) & 0xFF;
    if (lo === 0) { this.nmiPend = false; return this.latch; }
    if (lo >= 4 && lo <= 7) return this.ym.read(lo - 4);
    if (lo >= 8 && lo <= 11) { this.zb[11 - lo] = hi; return 0; }   // 08: 2K em F000, 09: 4K em E000, 0A: 8K em C000, 0B: 16K em 8000
    return 0;
  }
  zout(p, v) {
    const lo = p & 0xFF;
    if (lo === 0) { this.nmiPend = false; this.z80.nmi = false; }
    else if (lo >= 4 && lo <= 7) this.ym.write(lo - 4, v);
    else if (lo === 0x08) { this.nmiOn = true; if (this.nmiPend) this.z80.nmi = true; }
    else if (lo === 0x0C) this.reply = v;
    else if (lo === 0x18) this.nmiOn = false;
  }
  /* ---- quadro ---- */
  runFrame() {
    const cpu = this.cpu, z = this.z80, ym = this.ym;
    for (let ln = 0; ln < NG_LINES; ln++) {
      this.line = ln;
      if (ln === 0 && (this.mode & 0x10)) { this.tmrCnt = this.tmrReload; this.tmrRun = true; }
      if (ln === 240) { this.irqP |= 1; this.updateIrq(); this.frameNo++; if (++this.animDiv > (this.mode >> 8)) { this.animDiv = 0; if (!(this.mode & 8)) this.anim++; } }
      this.cycDebt += NG_CPL;
      while (this.cycDebt > 0) { const c = cpu.step(); this.cycDebt -= c; this.cyc += c; }
      this.zc += NG_ZPL;
      while (this.zc > 0) {
        z.irqLine = ym.irq; const c = z.step(); this.zc -= c; this.ymAcc += c;
        while (this.ymAcc >= 72) { this.ymAcc -= 72; ym.sample(); }
      }
      if (this.tmrRun) {
        this.tmrCnt -= 384;
        if (this.tmrCnt <= 0) { if (this.mode & 0x80) { this.irqP |= 2; this.updateIrq(); } if (this.mode & 0x20) this.tmrCnt += this.tmrReload || 384; else this.tmrRun = false; }
      }
      if (ln >= 16 && ln < 240) this.renderLine(ln - 16);
    }
  }
  /* ---- renderização de uma linha ---- */
  renderLine(y) {
    const lb = this.lineBuf, pc = this.pcache[this.palBank], vr = this.vram, dep = this.lineDepth;
    lb.fill(pc[0xFFF]); dep.fill(0);
    // sprites
    const spr1 = this.spr1, spr2 = this.spr2, nT = this.nTiles, L = y + 16, zm = this.zoom, anim = this.anim;
    let x = 0, top = 0, h = 0, sx = 0, wpx = 16, count = 0;
    for (let n = 0; n < 381; n++) {
      const yc = vr[0x8200 + n], sh = vr[0x8000 + n];
      if (yc & 0x40) { x = (x + wpx) & 0x1FF; }
      else { top = (0x200 - (yc >> 7)) & 0x1FF; h = yc & 0x3F; if (h > 32) h = 32; x = vr[0x8400 + n] >> 7; }
      const hs = (sh >> 8) & 15, vs = sh & 255; wpx = hs + 1;
      if (!h) continue;
      let ry = (L - top) & 0x1FF, src;
      if (vs === 255) { if (ry >= h * 16) continue; src = ry; }
      else {
        const vis = (h * 16 * (vs + 1)) >> 8; if (ry >= vis) continue;
        if (zm && zm.length >= 0x10000) { src = zm[(vs << 8) | (ry & 255)]; if (ry >= 256) src += 256 * 0; } else src = (ry * 256 / (vs + 1)) | 0;
        if (src >= h * 16) continue;
      }
      if (++count > 96) break;
      const ti = src >> 4, row = src & 15, base = n * 64 + ti * 2, tn = vr[base], at = vr[base + 1];
      let tile = tn | (((at >> 4) & 15) << 16);
      if (at & 8) tile = (tile & ~3) | (anim & 3); else if (at & 4) tile = (tile & ~7) | (anim & 7);
      tile %= nT; const vf = at & 2, hf = at & 1, pal = (at >> 8) * 16, r2 = vf ? 15 - row : row, o = tile * 64;
      // dados da linha: 2 bytes por plano-par para cada metade (direita primeiro: bytes 0-31; esquerda: 32-63)
      for (let half = 0; half < 2; half++) {
        // 4 blocos de 8x8 (16 B cada, 2 bytes por linha): +0 e +16 = metade da esquerda (cima/baixo), +32 e +48 = direita; bit 0 = pixel da esquerda dentro do bloco
        const ro = o + (half === 0 ? 0 : 32) + (r2 >= 8 ? 16 : 0) + (r2 & 7) * 2;
        const b0 = spr1[ro], b1 = spr1[ro + 1], b2 = spr2[ro], b3 = spr2[ro + 1];
        for (let px = 0; px < 8; px++) {
          const bit = 7 - px, c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3);
          if (!c) continue;
          let sxp = half * 8 + px; if (!hf) sxp = 15 - sxp;
          let dx = hs === 15 ? sxp : ((sxp * (hs + 1)) >> 4);
          dx = (x + dx) & 0x1FF; if (dx < 320) lb[dx] = pc[pal + c];
        }
      }
    }
    // camada fixa
    const fx = this.fixBios ? this.sfix : (this.s.length ? this.s : this.sfix), nF = Math.max(1, fx.length >> 5), ry = (y >> 3) + 2, fy = y & 7;
    for (let col = 0; col < 40; col++) {
      const w = vr[0x7000 + col * 32 + ry], t = (w & 0xFFF) % nF, pal = (w >> 12) * 16;
      // formato da camada fixa: bytes (linha L): [16+L, 24+L, L, 8+L] = pixels 0-1, 2-3, 4-5, 6-7; pixel da esquerda no nibble baixo
      const o0 = t * 32 + fy;
      for (let k = 0; k < 4; k++) {
        const b = fx[o0 + FIXORD[k]], lo = b & 15, hi = b >> 4, xp = col * 8 + k * 2;
        if (lo) lb[xp] = pc[pal + lo]; if (hi) lb[xp + 1] = pc[pal + hi];
      }
    }
    this.frame.set(lb, y * 320);
  }
}
if (typeof module !== 'undefined') module.exports = { NeoGeo };
