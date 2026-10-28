'use strict';
/* Som do GBA: 4 canais PSG (2 quadrados, 1 de onda, 1 de ruído) + 2 canais Direct Sound (FIFO A/B).
 * Gera áudio mono (mistura esquerda e direita) por amostragem com 4x de sobreamostragem. */

const GBA_CLOCK = 16777216;
const GBA_DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];
const GBA_AUDIO_SIZE = 65536, GBA_AUDIO_MASK = GBA_AUDIO_SIZE - 1;

class GBAEnvelope {
  constructor() { this.on = false; this.dac = false; this.len = 0; this.lenEn = false; this.vol = 0; this.initVol = 0; this.envDir = 0; this.envPer = 0; this.envT = 0; }
  setEnv(v) { // bits 8-15: período, direção, volume inicial
    this.envPer = (v >> 8) & 7; this.envDir = (v >> 11) & 1; this.initVol = (v >> 12) & 15;
    this.dac = (v & 0xF800) !== 0; if (!this.dac) this.on = false;
  }
  clockLen() { if (this.lenEn && this.len > 0) { this.len--; if (this.len === 0) this.on = false; } }
  clockEnv() {
    if (this.envPer === 0) return;
    if (--this.envT <= 0) {
      this.envT = this.envPer;
      if (this.envDir) { if (this.vol < 15) this.vol++; } else if (this.vol > 0) this.vol--;
    }
  }
}

class GBAPulse extends GBAEnvelope {
  constructor(hasSweep) {
    super(); this.hasSweep = hasSweep; this.duty = 0; this.freq = 0; this.pos = 0;
    this.swShift = 0; this.swNeg = false; this.swPer = 0; this.swT = 0; this.swEn = false; this.swShadow = 0;
  }
  writeSweep(v) { this.swShift = v & 7; this.swNeg = (v & 8) !== 0; this.swPer = (v >> 4) & 7; }
  writeLH(v) { this.len = 64 - (v & 63); this.duty = (v >> 6) & 3; this.setEnv(v); }
  writeX(v) { this.freq = v & 0x7FF; this.lenEn = (v & 0x4000) !== 0; if (v & 0x8000) this.trigger(); }
  trigger() {
    this.on = this.dac; this.vol = this.initVol; this.envT = this.envPer; if (this.len === 0) this.len = 64;
    if (this.hasSweep) {
      this.swShadow = this.freq; this.swT = this.swPer || 8; this.swEn = this.swPer > 0 || this.swShift > 0;
      if (this.swShift > 0 && this.swCalc() > 2047) this.on = false;
    }
  }
  swCalc() { const d = this.swShadow >> this.swShift; return this.swNeg ? this.swShadow - d : this.swShadow + d; }
  clockSweep() {
    if (!this.hasSweep || --this.swT > 0) return;
    this.swT = this.swPer || 8;
    if (this.swEn && this.swPer > 0) {
      const nf = this.swCalc();
      if (nf > 2047) this.on = false;
      else if (this.swShift > 0) { this.freq = nf; this.swShadow = nf; if (this.swCalc() > 2047) this.on = false; }
    }
  }
  advance(cyc) { this.pos = (this.pos + cyc / (16 * (2048 - this.freq))) % 8; }
  out() { return this.on ? GBA_DUTY[this.duty][this.pos | 0] * this.vol : 0; }
}

class GBAWave {
  constructor() {
    this.ram = [new Uint8Array(16), new Uint8Array(16)];
    this.on = false; this.dac = false; this.dual = false; this.bank = 0; this.volCode = 0; this.force = false;
    this.freq = 0; this.len = 0; this.lenEn = false; this.pos = 0;
  }
  writeL(v) { this.dual = (v & 0x20) !== 0; this.bank = (v >> 6) & 1; this.dac = (v & 0x80) !== 0; if (!this.dac) this.on = false; }
  writeH(v) { this.len = 256 - (v & 255); this.volCode = (v >> 13) & 3; this.force = (v & 0x8000) !== 0; }
  writeX(v) { this.freq = v & 0x7FF; this.lenEn = (v & 0x4000) !== 0; if (v & 0x8000) { this.on = this.dac; if (this.len === 0) this.len = 256; this.pos = 0; } }
  clockLen() { if (this.lenEn && this.len > 0) { this.len--; if (this.len === 0) this.on = false; } }
  advance(cyc) { this.pos = (this.pos + cyc / (8 * (2048 - this.freq))) % (this.dual ? 64 : 32); }
  out() {
    if (!this.on) return 0;
    const i = this.pos | 0, b = this.dual ? (this.bank + (i >> 5)) & 1 : this.bank, byte = this.ram[b][(i & 31) >> 1];
    const nib = (i & 1) ? byte & 15 : byte >> 4;
    return this.force ? nib * 0.75 : nib * [0, 1, 0.5, 0.25][this.volCode];
  }
}

class GBANoise extends GBAEnvelope {
  constructor() { super(); this.div = 0; this.width7 = false; this.shift = 0; this.lfsr = 0x7FFF; this.acc = 0; }
  writeL(v) { this.len = 64 - (v & 63); this.setEnv(v); }
  writeH(v) {
    this.div = v & 7; this.width7 = (v & 8) !== 0; this.shift = (v >> 4) & 15; this.lenEn = (v & 0x4000) !== 0;
    if (v & 0x8000) { this.on = this.dac; this.vol = this.initVol; this.envT = this.envPer; if (this.len === 0) this.len = 64; this.lfsr = 0x7FFF; }
  }
  advance(cyc) {
    this.acc += cyc;
    const p = (this.div ? this.div * 32 : 16) * (1 << (this.shift + 1));
    while (this.acc >= p) {
      this.acc -= p;
      const x = (this.lfsr & 1) ^ ((this.lfsr >> 1) & 1);
      this.lfsr = (this.lfsr >> 1) | (x << 14);
      if (this.width7) this.lfsr = (this.lfsr & ~0x40) | (x << 6);
    }
  }
  out() { return this.on && !(this.lfsr & 1) ? this.vol : 0; }
}

class GBAFifo {
  constructor() { this.q = new Int8Array(32); this.head = 0; this.n = 0; this.cur = 0; this.timer = 0; }
  clear() { this.head = 0; this.n = 0; this.cur = 0; }
  push(b) { if (this.n < 32) { this.q[(this.head + this.n) & 31] = b; this.n++; } }
  pop() { if (this.n > 0) { this.cur = this.q[this.head]; this.head = (this.head + 1) & 31; this.n--; } }
}

class GBAAPU {
  constructor(sys) {
    this.sys = sys;
    this.buf = new Float32Array(GBA_AUDIO_SIZE);
    this.rp = 0; this.wp = 0; this.last = 0; this.px = 0; this.py = 0; this.volume = 1; this.fast = false;
    this.setSampleRate(44100);
    this.reset();
  }
  setSampleRate(sr) { this.sampleRate = sr; this.cps = GBA_CLOCK / sr; }
  reset() {
    this.p1 = new GBAPulse(true); this.p2 = new GBAPulse(false); this.wave = new GBAWave(); this.noise = new GBANoise();
    this.fifo = [new GBAFifo(), new GBAFifo()];
    this.master = false; this.acc = 0; this.seq = 0; this.seqStep = 0;
  }
  buffered() { return this.wp - this.rp; }
  fill(out) {
    for (let i = 0; i < out.length; i++) {
      if (this.rp < this.wp) { this.last = this.buf[this.rp & GBA_AUDIO_MASK]; this.rp++; } else this.last *= 0.995;
      out[i] = this.last;
    }
  }
  push(s) {
    const y = s - this.px + 0.996 * this.py; this.px = s; this.py = y;
    if (this.wp - this.rp >= GBA_AUDIO_SIZE) this.rp++;
    this.buf[this.wp & GBA_AUDIO_MASK] = Math.max(-1, Math.min(1, y)) * this.volume; this.wp++;
  }

  read(off) {
    if (off === 0x84) return (this.master ? 0x80 : 0) | (this.p1.on ? 1 : 0) | (this.p2.on ? 2 : 0) | (this.wave.on ? 4 : 0) | (this.noise.on ? 8 : 0);
    if (off >= 0x90 && off < 0xA0) { const r = this.wave.ram[this.wave.bank ^ 1], i = off - 0x90; return r[i] | (r[i + 1] << 8); }
    return undefined;
  }
  write(off, v) {
    switch (off) {
      case 0x60: this.p1.writeSweep(v); return;
      case 0x62: this.p1.writeLH(v); return;
      case 0x64: this.p1.writeX(v); return;
      case 0x68: this.p2.writeLH(v); return;
      case 0x6C: this.p2.writeX(v); return;
      case 0x70: this.wave.writeL(v); return;
      case 0x72: this.wave.writeH(v); return;
      case 0x74: this.wave.writeX(v); return;
      case 0x78: this.noise.writeL(v); return;
      case 0x7C: this.noise.writeH(v); return;
      case 0x82:
        this.fifo[0].timer = (v >> 10) & 1; this.fifo[1].timer = (v >> 14) & 1;
        if (v & 0x800) this.fifo[0].clear();
        if (v & 0x8000) this.fifo[1].clear();
        return;
      case 0x84:
        this.master = (v & 0x80) !== 0;
        if (!this.master) { this.p1.on = this.p2.on = this.wave.on = this.noise.on = false; }
        return;
    }
    if (off >= 0x90 && off < 0xA0) { const r = this.wave.ram[this.wave.bank ^ 1], i = off - 0x90; r[i] = v & 255; r[i + 1] = v >> 8; }
  }
  pushFifo(i, byte) { this.fifo[i].push(byte << 24 >> 24); }

  /* chamado pelo sistema quando o timer 0 ou 1 estoura */
  timerOverflow(t, count) {
    for (let i = 0; i < 2; i++) {
      const f = this.fifo[i];
      if (f.timer !== t) continue;
      for (let k = 0; k < count; k++) f.pop();
      if (f.n <= 16) this.sys.dmaFifo(i);
    }
  }

  stepSequencer() {
    const s = this.seqStep;
    if ((s & 1) === 0) { this.p1.clockLen(); this.p2.clockLen(); this.wave.clockLen(); this.noise.clockLen(); }
    if (s === 2 || s === 6) this.p1.clockSweep();
    if (s === 7) { this.p1.clockEnv(); this.p2.clockEnv(); this.noise.clockEnv(); }
    this.seqStep = (s + 1) & 7;
  }
  run(c) {
    this.seq += c;
    while (this.seq >= 32768) { this.seq -= 32768; this.stepSequencer(); }
    if (this.fast) { this.acc = 0; return; } // turbo: sem geração de áudio (o hub descarta o som mesmo)
    this.acc += c;
    while (this.acc >= this.cps) { this.acc -= this.cps; this.genSample(); }
  }
  genSample() {
    const io = this.sys.bus.io.u16;
    if (!this.master) { this.push(0); return; }
    const sub = this.cps / 4, p1 = this.p1, p2 = this.p2, wv = this.wave, nz = this.noise;
    let o1 = 0, o2 = 0, o3 = 0, o4 = 0;
    for (let k = 0; k < 4; k++) {
      p1.advance(sub); p2.advance(sub); wv.advance(sub); nz.advance(sub);
      o1 += p1.out(); o2 += p2.out(); o3 += wv.out(); o4 += nz.out();
    }
    o1 /= 60; o2 /= 60; o3 /= 60; o4 /= 60; // 4 subamostras x 15
    const cnt = io[0x80 >> 1], ch = io[0x82 >> 1];
    const volR = ((cnt & 7) + 1) / 8, volL = (((cnt >> 4) & 7) + 1) / 8, enR = (cnt >> 8) & 15, enL = (cnt >> 12) & 15;
    const ratio = [0.25, 0.5, 1, 0][ch & 3];
    const psgL = ((enL & 1 ? o1 : 0) + (enL & 2 ? o2 : 0) + (enL & 4 ? o3 : 0) + (enL & 8 ? o4 : 0)) * volL * ratio;
    const psgR = ((enR & 1 ? o1 : 0) + (enR & 2 ? o2 : 0) + (enR & 4 ? o3 : 0) + (enR & 8 ? o4 : 0)) * volR * ratio;
    const a = this.fifo[0].cur / 128 * ((ch & 4) ? 1 : 0.5), b = this.fifo[1].cur / 128 * ((ch & 8) ? 1 : 0.5);
    const l = psgL + ((ch & 0x200) ? a : 0) + ((ch & 0x2000) ? b : 0);
    const r = psgR + ((ch & 0x100) ? a : 0) + ((ch & 0x1000) ? b : 0);
    this.push((l + r) * 0.45);
  }
}

if (typeof module !== 'undefined') module.exports = { GBAAPU };
