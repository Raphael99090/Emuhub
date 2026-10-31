'use strict';
/* SA-1 (Super Mario RPG, Kirby Super Star, Kirby's Dream Land 3...): segunda CPU 65C816 a 10,74 MHz
 * que divide ROM, 2 KB de I-RAM e BW-RAM com a CPU principal. Registradores em $2200-$23FF:
 * controle e interrupções entre as CPUs, mapeamento da ROM em 4 blocos de 1 MB, mapa de bits,
 * DMA (normal e conversão de caracteres), aritmética (multiplicação, divisão, soma acumulada),
 * leitura de dados com tamanho variável e temporizador.
 * Experimental: escrito pela documentação, sem jogo comercial para testar. */
class SA1 {
  constructor(sys, rom, bwBytes) {
    this.sys = sys; this.rom = rom;
    let m = 1; while (m < rom.length) m <<= 1; this.romMask = m - 1;
    let b = 0x2000; while (b < bwBytes) b <<= 1;
    this.bw = new Uint8Array(b); this.bwMask = b - 1; this.iram = new Uint8Array(0x800);
    this.brf = new Uint8Array(16);
    this.cpu = new CPU65816(this);
    this.irqLine = false; this.nmiPending = false; this.gsuIrq = false;
    this.reset();
  }
  reset() {
    this.iram.fill(0); this.brf.fill(0);
    this.cyc = 0; this.ccnt = 0x20; this.sie = 0; this.cie = 0; this.scnt = 0;
    this.sfrIrq = false; this.sfrDma = false; this.cfrIrq = false; this.cfrTimer = false; this.cfrDma = false; this.cfrNmi = false;
    this.msgToSa1 = 0; this.msgToCpu = 0;
    this.crv = 0; this.cnv = 0; this.civ = 0; this.snv = 0; this.siv = 0;
    this.tmc = 0; this.hcnt = 0; this.vcnt = 0; this.hpos = 0; this.vpos = 0;
    this.cxb = 0; this.dxb = 1; this.exb = 2; this.fxb = 3; this.bmaps = 0; this.bmap = 0; this.bbf = 0;
    this.dcnt = 0; this.cdma = 0; this.sda = 0; this.dda = 0; this.dtc = 0;
    this.mcnt = 0; this.ma = 0; this.mb = 0; this.mr = 0; this.mrOver = false;
    this.vbd = 0; this.vda = 0; this.vbit = 0; this.vb = 16; this.vhl = false;
    this.sys.gsuIrq = false;
  }
  /* ---- mapa de memória (sa1 = true: visão da SA-1; false: visão da CPU principal) ---- */
  romByte(bank, off) {
    // bancos 00-3F/80-BF (LoROM, 32 KB) e C0-FF (HiROM, 64 KB), com 4 blocos de 1 MB selecionáveis
    if (bank >= 0xC0) {
      const grp = (bank >> 4) & 3, reg = grp === 0 ? this.cxb : grp === 1 ? this.dxb : grp === 2 ? this.exb : this.fxb;
      const chunk = (reg & 0x80) ? (reg & 7) : grp;
      return this.rom[((chunk << 20) | ((bank & 0x0F) << 16) | off) & this.romMask];
    }
    const reg = (bank & 0x20) ? ((bank & 0x80) ? this.fxb : this.dxb) : ((bank & 0x80) ? this.exb : this.cxb);
    return this.rom[(((reg & 7) << 20) | ((bank & 0x1F) << 15) | (off & 0x7FFF)) & this.romMask];
  }
  bitmapRead(off) {
    if (this.bbf & 0x80) return (this.bw[(off >> 2) & this.bwMask] >> ((off & 3) * 2)) & 3;
    return (this.bw[(off >> 1) & this.bwMask] >> ((off & 1) * 4)) & 15;
  }
  bitmapWrite(off, v) {
    if (this.bbf & 0x80) { const i = (off >> 2) & this.bwMask, sh = (off & 3) * 2; this.bw[i] = (this.bw[i] & ~(3 << sh)) | ((v & 3) << sh); }
    else { const i = (off >> 1) & this.bwMask, sh = (off & 1) * 4; this.bw[i] = (this.bw[i] & ~(15 << sh)) | ((v & 15) << sh); }
  }
  get(bank, off, sa1) {
    if (bank < 0x40 || (bank >= 0x80 && bank < 0xC0)) {
      if (bank === 0 && off >= 0xFFEA) {
        if (sa1) { if (off === 0xFFEA || off === 0xFFFA) return this.cnv & 0xFF; if (off === 0xFFEB || off === 0xFFFB) return this.cnv >> 8;
          if (off === 0xFFEE || off === 0xFFFE) return this.civ & 0xFF; if (off === 0xFFEF || off === 0xFFFF) return this.civ >> 8;
          if (off === 0xFFFC) return this.crv & 0xFF; if (off === 0xFFFD) return this.crv >> 8; }
        else {
          if ((this.scnt & 0x10) && (off === 0xFFEA || off === 0xFFFA)) return this.snv & 0xFF;
          if ((this.scnt & 0x10) && (off === 0xFFEB || off === 0xFFFB)) return this.snv >> 8;
          if ((this.scnt & 0x40) && (off === 0xFFEE || off === 0xFFFE)) return this.siv & 0xFF;
          if ((this.scnt & 0x40) && (off === 0xFFEF || off === 0xFFFF)) return this.siv >> 8;
        }
      }
      if (off >= 0x8000) return this.romByte(bank, off);
      if (off >= 0x6000) return this.bw[((((sa1 ? this.bmap & 0x7F : this.bmaps & 0x1F) << 13) | (off - 0x6000))) & this.bwMask];
      if (off >= 0x3000 && off < 0x3800) return this.iram[off - 0x3000];
      if (sa1 && off < 0x800) return this.iram[off];
      if (off >= 0x2200 && off < 0x2400) return this.regRead(off);
      return -1;
    }
    if (bank >= 0xC0) return this.romByte(bank, off);
    if (bank < 0x50) return this.bw[(((bank & 0xF) << 16) | off) & this.bwMask];
    if (bank >= 0x60 && bank < 0x70) return this.bitmapRead(((bank & 0xF) << 16) | off);
    return -1;
  }
  put(bank, off, v, sa1) {
    if (bank < 0x40 || (bank >= 0x80 && bank < 0xC0)) {
      if (off >= 0x6000 && off < 0x8000) { this.bw[((((sa1 ? this.bmap & 0x7F : this.bmaps & 0x1F) << 13) | (off - 0x6000))) & this.bwMask] = v; return true; }
      if (off >= 0x3000 && off < 0x3800) { this.iram[off - 0x3000] = v; return true; }
      if (sa1 && off < 0x800) { this.iram[off] = v; return true; }
      if (off >= 0x2200 && off < 0x2400) { this.regWrite(off, v, sa1); return true; }
      return off >= 0x8000;
    }
    if (bank >= 0xC0) return true;
    if (bank < 0x50) { this.bw[(((bank & 0xF) << 16) | off) & this.bwMask] = v; return true; }
    if (bank >= 0x60 && bank < 0x70) { this.bitmapWrite(((bank & 0xF) << 16) | off, v); return true; }
    return false;
  }
  /* ---- barramento da SA-1 (cada acesso custa 2 ciclos mestres) ---- */
  read(a) { this.cyc += 2; const v = this.get(a >>> 16, a & 0xFFFF, true); return v < 0 ? (this.mdr = this.mdr | 0) : (this.mdr = v); }
  write(a, v) { this.cyc += 2; this.put(a >>> 16, a & 0xFFFF, v, true); }
  idle(n) { this.cyc += 2 * n; }
  /* ---- registradores ---- */
  regWrite(a, v, sa1) {
    switch (a) {
      case 0x2200: {
        const was = this.ccnt; this.ccnt = v; this.msgToSa1 = v & 15;
        if (v & 0x80) this.cfrIrq = true;
        if (v & 0x10) this.cfrNmi = true;
        if ((was & 0x20) && !(v & 0x20)) { this.cpu.reset(); }
        this.updateIrq(); return;
      }
      case 0x2201: this.sie = v; this.updateIrq(); return;
      case 0x2202: if (v & 0x80) this.sfrIrq = false; if (v & 0x20) this.sfrDma = false; this.updateIrq(); return;
      case 0x2203: this.crv = (this.crv & 0xFF00) | v; return; case 0x2204: this.crv = (this.crv & 0xFF) | (v << 8); return;
      case 0x2205: this.cnv = (this.cnv & 0xFF00) | v; return; case 0x2206: this.cnv = (this.cnv & 0xFF) | (v << 8); return;
      case 0x2207: this.civ = (this.civ & 0xFF00) | v; return; case 0x2208: this.civ = (this.civ & 0xFF) | (v << 8); return;
      case 0x2209: this.scnt = v; this.msgToCpu = v & 15; if (v & 0x80) { this.sfrIrq = true; } this.updateIrq(); return;
      case 0x220A: this.cie = v; this.updateIrq(); return;
      case 0x220B: if (v & 0x80) this.cfrIrq = false; if (v & 0x40) this.cfrTimer = false; if (v & 0x20) this.cfrDma = false; if (v & 0x10) this.cfrNmi = false; this.updateIrq(); return;
      case 0x220C: this.snv = (this.snv & 0xFF00) | v; return; case 0x220D: this.snv = (this.snv & 0xFF) | (v << 8); return;
      case 0x220E: this.siv = (this.siv & 0xFF00) | v; return; case 0x220F: this.siv = (this.siv & 0xFF) | (v << 8); return;
      case 0x2210: this.tmc = v; return;
      case 0x2211: this.hpos = 0; this.vpos = 0; return;
      case 0x2212: this.hcnt = (this.hcnt & 0x100) | v; return; case 0x2213: this.hcnt = (this.hcnt & 0xFF) | ((v & 1) << 8); return;
      case 0x2214: this.vcnt = (this.vcnt & 0x100) | v; return; case 0x2215: this.vcnt = (this.vcnt & 0xFF) | ((v & 1) << 8); return;
      case 0x2220: this.cxb = v; return; case 0x2221: this.dxb = v; return; case 0x2222: this.exb = v; return; case 0x2223: this.fxb = v; return;
      case 0x2224: this.bmaps = v; return;
      case 0x2225: this.bmap = v; return;
      case 0x223F: this.bbf = v; return;
      case 0x2230: this.dcnt = v; return;
      case 0x2231: this.cdma = v; if (v & 0x80) this.charIdx = 0; return;
      case 0x2232: this.sda = (this.sda & 0xFFFF00) | v; return; case 0x2233: this.sda = (this.sda & 0xFF00FF) | (v << 8); return; case 0x2234: this.sda = (this.sda & 0xFFFF) | (v << 16); return;
      case 0x2235: this.dda = (this.dda & 0xFFFF00) | v; return;
      case 0x2236: this.dda = (this.dda & 0xFF00FF) | (v << 8); if (this.dcnt & 0x80) { if (!(this.dcnt & 0x20) && !(this.dcnt & 4)) this.dmaNormal(); else if ((this.dcnt & 0x30) === 0x30) this.dmaChar1(); } return;
      case 0x2237: this.dda = (this.dda & 0xFFFF) | (v << 16); if ((this.dcnt & 0x80) && !(this.dcnt & 0x20) && (this.dcnt & 0x04)) this.dmaNormal(); return;
      case 0x2238: this.dtc = (this.dtc & 0xFF00) | v; return; case 0x2239: this.dtc = (this.dtc & 0xFF) | (v << 8); return;
      case 0x2250: this.mcnt = v; if (v & 2) { this.mr = 0; this.mrOver = false; } return;
      case 0x2251: this.ma = (this.ma & 0xFF00) | v; return; case 0x2252: this.ma = (this.ma & 0xFF) | (v << 8); return;
      case 0x2253: this.mb = (this.mb & 0xFF00) | v; return;
      case 0x2254: this.mb = (this.mb & 0xFF) | (v << 8); this.math(); return;
      case 0x2258: this.vbd = v; this.vb = (v & 15) || 16; this.vhl = (v & 0x80) !== 0; if (!this.vhl) this.vbAdvance(); return;
      case 0x2259: this.vda = (this.vda & 0xFFFF00) | v; return; case 0x225A: this.vda = (this.vda & 0xFF00FF) | (v << 8); return;
      case 0x225B: this.vda = (this.vda & 0xFFFF) | (v << 16); this.vbit = 0; return;
    }
    if (a >= 0x2240 && a < 0x2250) { this.brf[a - 0x2240] = v; if (a === 0x2247 || a === 0x224F) this.charType2(a === 0x224F ? 8 : 0); return; }
  }
  regRead(a) {
    switch (a) {
      case 0x2300: return (this.sfrIrq ? 0x80 : 0) | ((this.scnt & 0x40) ? 0x40 : 0) | (this.sfrDma ? 0x20 : 0) | ((this.scnt & 0x10) ? 0x10 : 0) | this.msgToCpu;
      case 0x2301: return (this.cfrIrq ? 0x80 : 0) | (this.cfrTimer ? 0x40 : 0) | (this.cfrDma ? 0x20 : 0) | (this.cfrNmi ? 0x10 : 0) | this.msgToSa1;
      case 0x2302: return this.hpos & 0xFF; case 0x2303: return (this.hpos >> 8) & 1;
      case 0x2304: return this.vpos & 0xFF; case 0x2305: return (this.vpos >> 8) & 1;
      case 0x2306: case 0x2307: case 0x2308: case 0x2309: case 0x230A: { const u = this.mr < 0 ? this.mr + 1099511627776 : this.mr; return Math.floor(u / Math.pow(2, (a - 0x2306) * 8)) & 0xFF; }
      case 0x230B: return this.mrOver ? 0x80 : 0;
      case 0x230C: return this.vbData() & 0xFF;
      case 0x230D: { const v = (this.vbData() >> 8) & 0xFF; if (this.vhl) this.vbAdvance(); return v; }
      case 0x230E: return 0x01;
    }
    return 0;
  }
  vbData() {
    const base = this.vda + (this.vbit >> 3), sh = this.vbit & 7;
    const d = this.rd(base) | (this.rd(base + 1) << 8) | (this.rd(base + 2) << 16);
    return (d >> sh) & 0xFFFF;
  }
  vbAdvance() { this.vbit += this.vb; this.vda += this.vbit >> 3; this.vbit &= 7; }
  rd(a) { const v = this.get((a >>> 16) & 0xFF, a & 0xFFFF, true); return v < 0 ? 0 : v; }
  wr(a, v) { this.put((a >>> 16) & 0xFF, a & 0xFFFF, v & 0xFF, true); }
  /* ---- aritmética ---- */
  math() {
    const ma = (this.ma << 16) >> 16, mb = (this.mb << 16) >> 16;
    switch (this.mcnt & 3) {
      case 0: this.mr = ma * mb; break;
      case 1: {
        const d = this.mb; // divisor sem sinal
        if (d === 0) this.mr = 0;
        else { const q = Math.trunc(ma / d), r = ma - q * d; this.mr = (r & 0xFFFF) * 65536 + (q & 0xFFFF); }
        this.ma = 0; break;
      }
      default: {
        let sum = this.mr + ma * mb;
        this.mrOver = sum >= 549755813888 || sum < -549755813888;
        if (this.mrOver) sum = ((sum % 1099511627776) + 1099511627776) % 1099511627776;
        this.mr = sum;
      }
    }
    this.mb = 0;
  }
  /* ---- DMA ---- */
  dmaNormal() {
    const src = this.dcnt & 3, dstBw = (this.dcnt & 4) !== 0;
    let s = this.sda, d = this.dda, n = this.dtc;
    for (let i = 0; i < n; i++) {
      let v;
      if (src === 0) v = this.romByte((s >>> 16) & 0xFF, (s + i) & 0xFFFF); // ROM
      else if (src === 1) v = this.bw[(s + i) & this.bwMask];
      else v = this.iram[(s + i) & 0x7FF];
      if (dstBw) this.bw[(d + i) & this.bwMask] = v; else this.iram[(d + i) & 0x7FF] = v;
    }
    this.dcnt &= 0x7F; this.cfrDma = true; this.updateIrq();
  }
  /* conversão de caracteres tipo 1: bitmap linear na BW-RAM -> tiles planares na I-RAM */
  dmaChar1() {
    const bpp = [8, 4, 2][this.cdma & 3] || 2, wTiles = 1 << ((this.cdma >> 2) & 7), tileBytes = bpp * 8;
    const n = this.dtc || ((wTiles) * tileBytes), rowBytes = wTiles * 8 * bpp / 8;
    let dst = this.dda & 0x7FF, written = 0, tile = 0;
    while (written < n) {
      const tx = tile % wTiles, ty = (tile / wTiles) | 0;
      for (let y = 0; y < 8; y++) {
        const px = new Uint8Array(8), rowBase = this.sda + (ty * 8 + y) * rowBytes + tx * bpp;
        for (let x = 0; x < 8; x++) {
          const bi = x * bpp, byte = this.bw[(rowBase + (bi >> 3)) & this.bwMask];
          px[x] = bpp === 8 ? byte : (byte >> (8 - bpp - (bi & 7))) & ((1 << bpp) - 1);
        }
        for (let pl = 0; pl < bpp; pl++) {
          let b = 0; for (let x = 0; x < 8; x++) b |= ((px[x] >> pl) & 1) << (7 - x);
          this.iram[(dst + ((pl >> 1) << 4) + y * 2 + (pl & 1)) & 0x7FF] = b;
        }
      }
      dst += tileBytes; written += tileBytes; tile++;
    }
    this.dcnt &= 0x7F; this.sfrDma = true; this.updateIrq();
  }
  /* conversão tipo 2: 8 pixels em BRF (2240-224F) viram uma linha de tile na I-RAM */
  charType2(half) {
    if ((this.dcnt & 0xB0) !== 0xA0) return;
    const bpp = [8, 4, 2][this.cdma & 3] || 2, row = (this.charIdx || 0);
    let dst = this.dda & 0x7FF;
    const px = this.brf.subarray(half, half + 8), y = row & 7;
    for (let pl = 0; pl < bpp; pl++) {
      let b = 0; for (let x = 0; x < 8; x++) b |= ((px[x] >> pl) & 1) << (7 - x);
      this.iram[(dst + ((pl >> 1) << 4) + y * 2 + (pl & 1)) & 0x7FF] = b;
    }
    this.charIdx = row + 1; if ((this.charIdx & 7) === 0) this.dda += bpp * 8;
    this.sfrDma = true; this.updateIrq();
  }
  /* ---- interrupções e execução ---- */
  updateIrq() {
    this.sys.gsuIrq = (this.sfrIrq && (this.sie & 0x80)) || (this.sfrDma && (this.sie & 0x20));
    this.irqLine = (this.cfrIrq && (this.cie & 0x80)) || (this.cfrTimer && (this.cie & 0x40)) || (this.cfrDma && (this.cie & 0x20));
    if (this.cfrNmi && (this.cie & 0x10)) { this.nmiPending = true; this.cfrNmi = false; }
  }
  /* roda a SA-1 até alcançar o relógio da CPU principal (em ciclos mestres dentro da linha) */
  run(target) {
    if ((this.ccnt & 0x60) || false) { this.cyc = target; return; }
    const cpu = this.cpu;
    while (this.cyc < target) cpu.step();
  }
  /* chamado uma vez por linha: temporizador e normalização do relógio */
  endLine(line) {
    this.cyc -= 1364; if (this.cyc < 0) this.cyc = 0;
    this.vpos = line === 0 ? 0 : (this.vpos + 1) % 262;
    const ven = (this.tmc & 2) !== 0, hen = (this.tmc & 1) !== 0;
    if ((ven && this.vpos === this.vcnt) || (hen && !ven)) this.cfrTimer = true;
    this.updateIrq();
  }
}

if (typeof module !== 'undefined') module.exports = { SA1 };
