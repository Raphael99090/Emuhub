'use strict';
/* YM2610 (Neo Geo): 4 canais FM (4 operadores), SSG (3 tons + ruído + envelope), ADPCM-A (6 canais) e ADPCM-B.
 * Gera uma amostra a cada 144 ciclos do clock de 8 MHz (55.555 Hz); o buffer de saída é reamostrado para o áudio do aparelho.
 * Simplificações: sem LFO (vibrato/tremolo), sem detune fino e sem o modo especial do canal 3. */
const YM_SIN = new Float32Array(1024), YM_AMP = new Float32Array(1024);
for (let i = 0; i < 1024; i++) { YM_SIN[i] = Math.sin((i + 0.5) / 1024 * 2 * Math.PI); YM_AMP[i] = Math.pow(10, -i * 0.09375 / 20); }
const YM_EGINC = [[0, 1, 0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 1, 1, 0, 1], [0, 1, 1, 1, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 1]];
const YM_SLOT = [0, 2, 1, 3], YM_MUL = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const YM_STEP = [16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552];
const YM_ADJ = [-1, -1, -1, -1, 2, 5, 7, 9], YM_BADJ = [57, 57, 57, 57, 77, 102, 128, 153];
const YM_ALGS = [ // [quem modula op2, op3, op4 (índices de entrada)], carriers
  { c: [3] }, { c: [3] }, { c: [3] }, { c: [3] }, { c: [1, 3] }, { c: [1, 2, 3] }, { c: [1, 2, 3] }, { c: [0, 1, 2, 3] }];
const YM_BUF = 1 << 15, YM_MASK = YM_BUF - 1;

class YM2610 {
  constructor() {
    this.rom = new Uint8Array(0); this.rate = 8000000 / 144;
    this.r = [new Uint8Array(256), new Uint8Array(256)]; this.addr = [0, 0];
    this.abuf = new Float32Array(YM_BUF); this.wp = 0; this.rp = 0; this.pos = 0; this.last = 0; this.volume = 1; this.hostSr = 44100;
    this.reset();
  }
  reset() {
    this.r[0].fill(0); this.r[1].fill(0);
    this.ta = 0; this.tb = 0; this.taOn = false; this.tbOn = false; this.flags = 0; this.irq = false; this.egCnt = 0; this.egDiv = 0;
    // FM: 6 canais x 4 operadores (ordem S1,S2,S3,S4)
    this.ph = new Float64Array(24); this.att = new Int32Array(24).fill(1023); this.st = new Uint8Array(24).fill(4);
    this.dtm = new Float64Array(24).fill(1); this.tl = new Int32Array(24); this.ks = new Uint8Array(24); this.ar = new Uint8Array(24); this.dr = new Uint8Array(24);
    this.sr = new Uint8Array(24); this.sl = new Int32Array(24); this.rr = new Uint8Array(24); this.inc = new Float64Array(24); this.rate4 = new Int32Array(24);
    this.fn = new Int32Array(6); this.blk = new Uint8Array(6); this.fnHi = 0; this.alg = new Uint8Array(6); this.fb = new Uint8Array(6);
    this.fbo = new Float64Array(12); this.o = new Float64Array(24);
    // SSG
    this.sCnt = new Float64Array(3); this.sOut = new Uint8Array(3).fill(1); this.nCnt = 0; this.nOut = 1; this.lfsr = 1; this.eCnt = 0; this.eStep = 0; this.eVol = 0; this.eDir = 0; this.eHold = false;
    // ADPCM-A
    this.aOn = new Uint8Array(6); this.aAddr = new Float64Array(6); this.aEnd = new Int32Array(6); this.aAcc = new Int32Array(6); this.aIdx = new Int32Array(6); this.aNib = new Int32Array(6); this.aOut = new Float64Array(6); this.aDiv = 0;
    this.aFlags = 0; this.bFlag = false;
    // ADPCM-B
    this.bOn = false; this.bAddr = 0; this.bEnd = 0; this.bAcc = 0; this.bDelta = 127; this.bPos = 0; this.bOut = 0; this.bPrev = 0; this.bNib = 0; this.bCur = 0; this.bNibLeft = 0;
  }
  setSampleRate(sr) { this.hostSr = sr; }
  buffered() { return Math.floor((this.wp - this.rp) * this.hostSr / this.rate); }
  fill(out) {
    const step = this.rate / this.hostSr;
    for (let i = 0; i < out.length; i++) {
      if (this.rp + 1 < this.wp) {
        const i0 = Math.floor(this.pos), f = this.pos - i0, a = this.abuf[(this.rp) & YM_MASK], b = this.abuf[(this.rp + 1) & YM_MASK];
        this.last = a + (b - a) * f; this.pos += step; const adv = Math.floor(this.pos); this.pos -= adv; this.rp += adv; if (this.rp > this.wp) this.rp = this.wp;
      } else this.last *= 0.995;
      out[i] = this.last * this.volume;
    }
  }
  /* ---- acesso pelas portas do Z80 ---- */
  read(p) {
    if (p === 0) return this.flags & 3;
    if (p === 1) { const a = this.addr[0]; if (a < 16) return this.r[0][a]; return 0; }
    if (p === 2) return this.aFlags | (this.bFlag ? 0x80 : 0);
    return 0;
  }
  write(p, v) {
    v &= 255;
    if ((p & 1) === 0) { this.addr[p >> 1] = v; return; }
    const port = p >> 1, a = this.addr[port]; this.r[port][a] = v;
    if (port === 0) this.wA(a, v); else this.wB(a, v);
  }
  updateIrq() { this.irq = !!((this.flags & 1) && (this.r[0][0x27] & 4)) || !!((this.flags & 2) && (this.r[0][0x27] & 8)); }
  wA(a, v) {
    if (a < 0x10) { return; }
    if (a < 0x20) { // ADPCM-B
      if (a === 0x10) { if (v & 1) { this.bOn = false; } else if (v & 0x80) { this.bOn = true; this.bAddr = ((this.r[0][0x13] << 8) | this.r[0][0x12]) * 256; this.bEnd = (((this.r[0][0x15] << 8) | this.r[0][0x14]) + 1) * 256; this.bAcc = 0; this.bDelta = 127; this.bPos = 1; this.bNibLeft = 0; this.bFlag = false; } }
      else if (a === 0x1C) { if (v & 0x80) { this.aFlags = 0; this.bFlag = false; } else this.aFlags &= ~(v & 0x3F); }
      return;
    }
    switch (a) {
      case 0x24: case 0x25: break;
      case 0x27: {
        if (v & 0x10) this.flags &= ~1; if (v & 0x20) this.flags &= ~2;
        if ((v & 1) && !this.taOn) this.ta = 1024 - (((this.r[0][0x24] << 2) | (this.r[0][0x25] & 3)) & 1023);
        if ((v & 2) && !this.tbOn) this.tb = 256 - this.r[0][0x26];
        this.taOn = !!(v & 1); this.tbOn = !!(v & 2); this.updateIrq(); break;
      }
      case 0x28: {
        let c = v & 3; if (c === 0 || c === 3) return; if (v & 4) c += 3;
        for (let s = 0; s < 4; s++) { const o = c * 4 + s; if (v & (0x10 << s)) { this.ph[o] = 0; this.st[o] = 0; this.fbo[c * 2] = this.fbo[c * 2 + 1] = 0; } else if (this.st[o] !== 4) this.st[o] = 3; }
        return;
      }
    }
    if (a >= 0x30) this.fmReg(0, a, v);
  }
  wB(a, v) {
    if (a < 0x30) { // ADPCM-A
      if (a === 0x00) { for (let c = 0; c < 6; c++) if (v & (1 << c)) { if (v & 0x80) this.aOn[c] = 0; else { const r = this.r[1]; this.aOn[c] = 1; this.aAddr[c] = ((r[0x18 + c] << 8) | r[0x10 + c]) * 256; this.aEnd[c] = (((r[0x28 + c] << 8) | r[0x20 + c]) + 1) * 256; this.aAcc[c] = 0; this.aIdx[c] = 0; this.aNib[c] = 0; this.aOut[c] = 0; } } }
      return;
    }
    this.fmReg(1, a, v);
  }
  fmReg(port, a, v) {
    let c = a & 3; if (c === 3) return; if (port) c += 3;
    const s = YM_SLOT[(a >> 2) & 3], o = c * 4 + s, g = a & 0xF0;
    if (a < 0xA0) {
      switch (g) {
        case 0x30: this.dtm[o] = YM_MUL[v & 15]; this.updInc(c); break;
        case 0x40: this.tl[o] = v & 127; break;
        case 0x50: this.ks[o] = v >> 6; this.ar[o] = v & 31; this.updInc(c); break;
        case 0x60: this.dr[o] = v & 31; break;
        case 0x70: this.sr[o] = v & 31; break;
        case 0x80: this.sl[o] = (v >> 4) === 15 ? 992 : (v >> 4) * 32; this.rr[o] = v & 15; break;
      }
      return;
    }
    if ((a & 0xFC) === 0xA4) { this.fnHi = v & 0x3F; return; }
    if ((a & 0xFC) === 0xA0) { this.fn[c] = ((this.fnHi & 7) << 8) | v; this.blk[c] = (this.fnHi >> 3) & 7; this.updInc(c); return; }
    if ((a & 0xFC) === 0xB0) { this.alg[c] = v & 7; this.fb[c] = (v >> 3) & 7; }
  }
  updInc(c) {
    const fn = this.fn[c], b = this.blk[c], kc = (b << 2) | ((fn >> 9) & 3);
    for (let s = 0; s < 4; s++) { const o = c * 4 + s; this.inc[o] = ((fn << b) >> 1) * this.dtm[o] * (1 / 1024) * 1; this.rate4[o] = kc >> (3 - this.ks[o]); }
  }
  egRate(o, R) { if (R === 0) return 0; const r = 2 * R + this.rate4[o]; return r > 63 ? 63 : r; }
  egTick(o) {
    const st = this.st[o]; if (st === 4) return;
    let rate = 0;
    if (st === 0) rate = this.egRate(o, this.ar[o]); else if (st === 1) rate = this.egRate(o, this.dr[o]); else if (st === 2) rate = this.egRate(o, this.sr[o]); else rate = Math.min(63, 4 * this.rr[o] + 2 + this.rate4[o]);
    if (rate === 0) return;
    let inc, sh = 11 - (rate >> 2);
    if (sh < 0) { inc = YM_EGINC[rate & 3][this.egCnt & 7] * (1 << (-sh)); }
    else { if (this.egCnt & ((1 << sh) - 1)) return; inc = YM_EGINC[rate & 3][(this.egCnt >> sh) & 7]; }
    if (!inc) return;
    if (st === 0) { if (rate >= 62) this.att[o] = 0; else this.att[o] += ((~this.att[o]) * inc) >> 4; if (this.att[o] <= 0) { this.att[o] = 0; this.st[o] = 1; } }
    else if (st === 1) { this.att[o] += inc; if (this.att[o] >= this.sl[o]) { this.att[o] = Math.min(this.att[o], 1023); this.st[o] = 2; } }
    else if (st === 2) { this.att[o] += inc; if (this.att[o] >= 1023) { this.att[o] = 1023; this.st[o] = 4; } }
    else { this.att[o] += inc; if (this.att[o] >= 1023) { this.att[o] = 1023; this.st[o] = 4; } }
  }
  opOut(o, pm) { const att = this.att[o] + (this.tl[o] << 3); const idx = ((this.ph[o] * 1024) | 0) + (pm | 0); return YM_SIN[idx & 1023] * YM_AMP[att > 1023 ? 1023 : att] * 8191; }
  /* ---- uma amostra (a 55.5 kHz) ---- */
  sample() {
    // timers
    if (this.taOn) { this.ta -= 2; if (this.ta <= 0) { this.ta += 1024 - (((this.r[0][0x24] << 2) | (this.r[0][0x25] & 3)) & 1023); this.flags |= 1; this.updateIrq(); } }
    if (this.tbOn) { this.tb -= 0.125; if (this.tb <= 0) { this.tb += 256 - this.r[0][0x26]; this.flags |= 2; this.updateIrq(); } }
    // envelope (a cada 3 amostras)
    if (++this.egDiv >= 3) { this.egDiv = 0; this.egCnt++; for (let o = 0; o < 24; o++) this.egTick(o); }
    let fm = 0;
    for (let k = 0; k < 4; k++) {
      const c = k < 2 ? k + 1 : k + 2, b = c * 4, o = this.o, ph = this.ph, inc = this.inc;
      let any = false; for (let s = 0; s < 4; s++) if (this.st[b + s] !== 4) { any = true; break; }
      if (!any) continue;
      for (let s = 0; s < 4; s++) { ph[b + s] = (ph[b + s] + inc[b + s] / 1024 * 1024 / 1024 * 1) % 1; }
      const fbv = this.fb[c] ? (this.fbo[c * 2] + this.fbo[c * 2 + 1]) / (1 << (10 - this.fb[c])) : 0;
      const o0 = this.opOut(b, fbv); this.fbo[c * 2 + 1] = this.fbo[c * 2]; this.fbo[c * 2] = o0; o[b] = o0;
      const m = x => x / 2;
      let out = 0;
      switch (this.alg[c]) {
        case 0: o[b + 1] = this.opOut(b + 1, m(o0)); o[b + 2] = this.opOut(b + 2, m(o[b + 1])); out = this.opOut(b + 3, m(o[b + 2])); break;
        case 1: o[b + 1] = this.opOut(b + 1, 0); o[b + 2] = this.opOut(b + 2, m(o0 + o[b + 1])); out = this.opOut(b + 3, m(o[b + 2])); break;
        case 2: o[b + 1] = this.opOut(b + 1, 0); o[b + 2] = this.opOut(b + 2, m(o[b + 1])); out = this.opOut(b + 3, m(o0 + o[b + 2])); break;
        case 3: o[b + 1] = this.opOut(b + 1, m(o0)); o[b + 2] = this.opOut(b + 2, 0); out = this.opOut(b + 3, m(o[b + 1] + o[b + 2])); break;
        case 4: o[b + 1] = this.opOut(b + 1, m(o0)); o[b + 3] = this.opOut(b + 3, m(this.opOut(b + 2, 0))); out = o[b + 1] + o[b + 3]; break;
        case 5: out = this.opOut(b + 1, m(o0)) + this.opOut(b + 2, m(o0)) + this.opOut(b + 3, m(o0)); break;
        case 6: out = this.opOut(b + 1, m(o0)) + this.opOut(b + 2, 0) + this.opOut(b + 3, 0); break;
        default: out = o0 + this.opOut(b + 1, 0) + this.opOut(b + 2, 0) + this.opOut(b + 3, 0);
      }
      fm += out;
    }
    let mix = fm / 32768 * 0.9;
    mix += this.ssg() * 0.30 + this.adpcmA() * 0.45 + this.adpcmB() * 0.45;
    if (this.wp - this.rp >= YM_BUF - 2) this.rp++;
    this.abuf[this.wp & YM_MASK] = mix; this.wp++;
  }
  /* ---- SSG ---- */
  ssg() {
    const r = this.r[0], per = i => Math.max(1, ((r[i * 2 + 1] & 15) << 8) | r[i * 2]);
    for (let i = 0; i < 3; i++) { this.sCnt[i] += 2.25; const p = per(i); while (this.sCnt[i] >= p) { this.sCnt[i] -= p; this.sOut[i] ^= 1; } }
    this.nCnt += 2.25 / 2; const np = Math.max(1, r[6] & 31); while (this.nCnt >= np) { this.nCnt -= np; const b = (this.lfsr ^ (this.lfsr >> 3)) & 1; this.lfsr = (this.lfsr >> 1) | (b << 16); this.nOut = this.lfsr & 1; }
    // envelope
    const ep = Math.max(1, (r[12] << 8) | r[11]); this.eCnt += 0.1406; while (this.eCnt >= ep) { this.eCnt -= ep; this.envStep(); }
    let s = 0;
    for (let i = 0; i < 3; i++) {
      const mx = r[7], tone = (mx >> i) & 1 ? 1 : this.sOut[i], noise = (mx >> (i + 3)) & 1 ? 1 : this.nOut;
      const vol = (r[8 + i] & 16) ? this.eVol : (r[8 + i] & 15) * 2 + 1;
      if (tone & noise) s += SSGV[vol & 31];
    }
    return s;
  }
  envStep() {
    const sh = this.r[0][13] & 15;
    if (this.eHold) return;
    if (this.eStep === 0 && this.eCnt >= 0) { /* início tratado em wA(13) */ }
    this.eStep++;
    const cont = sh & 8, att = sh & 4, alt = sh & 2, hold = sh & 1;
    if (this.eStep < 32) { this.eVol = this.eDir ? this.eVol + 1 : this.eVol - 1; }
    if (this.eVol < 0) this.eVol = 0; if (this.eVol > 31) this.eVol = 31;
    if (this.eStep >= 32) {
      this.eStep = 0;
      if (!cont) { this.eVol = 0; this.eHold = true; }
      else if (hold) { if (alt) this.eVol = this.eDir ? 0 : 31; this.eHold = true; }
      else { if (alt) this.eDir ^= 1; this.eVol = this.eDir ? 0 : 31; }
    }
  }
  /* ---- ADPCM-A ---- */
  adpcmA() {
    const r = this.r[1]; let sum = 0;
    const step = ++this.aDiv >= 3; if (step) this.aDiv = 0;
    const tl = r[1] & 63;
    for (let c = 0; c < 6; c++) {
      if (!this.aOn[c]) continue;
      if (step) {
        const ad = this.aAddr[c] | 0;
        if (ad >= this.aEnd[c] || (ad >> 1) >= this.rom.length) { this.aOn[c] = 0; this.aFlags |= 1 << c; continue; }
        const byte = this.rom[ad], nib = (this.aNib[c] === 0) ? (byte >> 4) & 15 : byte & 15;
        let df = (((nib & 7) * 2 + 1) * YM_STEP[this.aIdx[c]]) >> 3; if (nib & 8) df = -df;
        this.aAcc[c] = ((this.aAcc[c] + df) << 20) >> 20;
        this.aIdx[c] += YM_ADJ[nib & 7]; if (this.aIdx[c] < 0) this.aIdx[c] = 0; else if (this.aIdx[c] > 48) this.aIdx[c] = 48;
        if (this.aNib[c] === 0) this.aNib[c] = 1; else { this.aNib[c] = 0; this.aAddr[c]++; }
        this.aOut[c] = this.aAcc[c];
      }
      const lv = r[8 + c] & 31;
      sum += this.aOut[c] * Math.pow(10, -0.75 * ((31 - lv) + (63 - tl)) / 20);
    }
    return sum / 2048 * 0.5;
  }
  /* ---- ADPCM-B ---- */
  adpcmB() {
    if (!this.bOn) return 0;
    const dn = (this.r[0][0x1A] << 8) | this.r[0][0x19]; this.bPos += dn / 65536;
    while (this.bPos >= 1) {
      this.bPos -= 1;
      if (this.bNibLeft === 0) {
        if (this.bAddr >= this.bEnd || this.bAddr >= this.rom.length) { if (this.r[0][0x10] & 0x10) { this.bAddr = ((this.r[0][0x13] << 8) | this.r[0][0x12]) * 256; } else { this.bOn = false; this.bFlag = true; return 0; } }
        this.bCur = this.rom[this.bAddr++]; this.bNibLeft = 2;
      }
      const nib = this.bNibLeft === 2 ? (this.bCur >> 4) & 15 : this.bCur & 15; this.bNibLeft--;
      let df = (((nib & 7) * 2 + 1) * this.bDelta) >> 3; if (nib & 8) df = -df;
      this.bAcc += df; if (this.bAcc > 32767) this.bAcc = 32767; else if (this.bAcc < -32768) this.bAcc = -32768;
      this.bDelta = (this.bDelta * YM_BADJ[nib & 7]) >> 6; if (this.bDelta < 127) this.bDelta = 127; else if (this.bDelta > 24576) this.bDelta = 24576;
      this.bPrev = this.bOut; this.bOut = this.bAcc;
    }
    return this.bOut / 32768 * (this.r[0][0x1B] / 255);
  }
}
const SSGV = new Float32Array(32); for (let i = 0; i < 32; i++) SSGV[i] = i === 0 ? 0 : Math.pow(10, -(31 - i) * 1.5 / 20) / 3;
/* escrever no registrador 13 do SSG reinicia o envelope */
const _wA = YM2610.prototype.wA;
YM2610.prototype.wA = function (a, v) { if (a === 13) { const att = v & 4; this.eDir = att ? 1 : 0; this.eVol = att ? 0 : 31; this.eStep = 0; this.eHold = false; this.eCnt = 0; } _wA.call(this, a, v); };
if (typeof module !== 'undefined') module.exports = { YM2610 };
