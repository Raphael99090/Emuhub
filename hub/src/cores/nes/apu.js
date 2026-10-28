'use strict';
/* APU: 2 quadrados, triângulo, ruído; DMC fora */
/* ================================ APU ================================= */
const LEN = [10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14, 12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30];
const DUTY = [[0, 1, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 0, 0, 0], [1, 0, 0, 1, 1, 1, 1, 1]];
const NOISE_P = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const PULSE_T = new Float32Array(31), TND_T = new Float32Array(203);
for (let i = 1; i < 31; i++) PULSE_T[i] = 95.52 / (8128 / i + 100);
for (let i = 1; i < 203; i++) TND_T[i] = 163.67 / (24329 / i + 100);

class Env {
  constructor() { this.enabled = false; this.halt = false; this.constVol = false; this.vol = 0; this.envStart = false; this.envDiv = 0; this.envDecay = 0; this.length = 0; }
  clockEnv() {
    if (this.envStart) { this.envStart = false; this.envDecay = 15; this.envDiv = this.vol; }
    else if (this.envDiv === 0) {
      this.envDiv = this.vol;
      if (this.envDecay > 0) this.envDecay--; else if (this.halt) this.envDecay = 15;
    } else this.envDiv--;
  }
  clockLen() { if (!this.halt && this.length > 0) this.length--; }
}
class Pulse extends Env {
  constructor(ones) {
    super(); this.ones = ones; this.duty = 0; this.seq = 0; this.timer = 0; this.period = 0;
    this.sweepEn = false; this.sweepPeriod = 0; this.sweepNeg = false; this.sweepShift = 0; this.sweepReload = false; this.sweepDiv = 0;
  }
  write(r, v) {
    switch (r) {
      case 0: this.duty = v >> 6; this.halt = !!(v & 0x20); this.constVol = !!(v & 0x10); this.vol = v & 15; break;
      case 1: this.sweepEn = !!(v & 0x80); this.sweepPeriod = (v >> 4) & 7; this.sweepNeg = !!(v & 8); this.sweepShift = v & 7; this.sweepReload = true; break;
      case 2: this.period = (this.period & 0x700) | v; break;
      case 3: this.period = (this.period & 0xFF) | ((v & 7) << 8); if (this.enabled) this.length = LEN[v >> 3]; this.seq = 0; this.envStart = true; break;
    }
  }
  clockTimer() { if (this.timer === 0) { this.timer = this.period; this.seq = (this.seq + 1) & 7; } else this.timer--; }
  advance(k) { // equivale a k chamadas de clockTimer()
    while (k > 0) { if (this.timer >= k) { this.timer -= k; return; } k -= this.timer + 1; this.timer = this.period; this.seq = (this.seq + 1) & 7; }
  }
  target() { const d = this.period >> this.sweepShift; return this.sweepNeg ? this.period - d - (this.ones ? 1 : 0) : this.period + d; }
  clockSweep() {
    const tg = this.target(), mute = this.period < 8 || tg > 0x7FF;
    if (this.sweepDiv === 0 && this.sweepEn && this.sweepShift > 0 && !mute) this.period = tg;
    if (this.sweepDiv === 0 || this.sweepReload) { this.sweepDiv = this.sweepPeriod; this.sweepReload = false; } else this.sweepDiv--;
  }
  out() {
    if (!this.enabled || this.length === 0 || DUTY[this.duty][this.seq] === 0 || this.period < 8 || this.target() > 0x7FF) return 0;
    return this.constVol ? this.vol : this.envDecay;
  }
}
class Triangle {
  constructor() { this.enabled = false; this.control = false; this.linearReload = 0; this.linear = 0; this.linearFlag = false; this.timer = 0; this.period = 0; this.length = 0; this.seq = 0; }
  write(r, v) {
    switch (r) {
      case 0: this.control = !!(v & 0x80); this.linearReload = v & 0x7F; break;
      case 2: this.period = (this.period & 0x700) | v; break;
      case 3: this.period = (this.period & 0xFF) | ((v & 7) << 8); if (this.enabled) this.length = LEN[v >> 3]; this.linearFlag = true; break;
    }
  }
  clockTimer() { if (this.timer === 0) { this.timer = this.period; if (this.length > 0 && this.linear > 0) this.seq = (this.seq + 1) & 31; } else this.timer--; }
  advance(k) {
    while (k > 0) { if (this.timer >= k) { this.timer -= k; return; } k -= this.timer + 1; this.timer = this.period; if (this.length > 0 && this.linear > 0) this.seq = (this.seq + 1) & 31; }
  }
  clockLinear() { if (this.linearFlag) this.linear = this.linearReload; else if (this.linear > 0) this.linear--; if (!this.control) this.linearFlag = false; }
  clockLen() { if (!this.control && this.length > 0) this.length--; }
  out() { if (this.period < 2) return 7; return this.seq < 16 ? 15 - this.seq : this.seq - 16; }
}
class Noise extends Env {
  constructor() { super(); this.mode = false; this.period = 4; this.timer = 0; this.sr = 1; }
  write(r, v) {
    switch (r) {
      case 0: this.halt = !!(v & 0x20); this.constVol = !!(v & 0x10); this.vol = v & 15; break;
      case 2: this.mode = !!(v & 0x80); this.period = NOISE_P[v & 15]; break;
      case 3: if (this.enabled) this.length = LEN[v >> 3]; this.envStart = true; break;
    }
  }
  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.period;
      const fb = (this.sr & 1) ^ ((this.sr >> (this.mode ? 6 : 1)) & 1);
      this.sr = (this.sr >> 1) | (fb << 14);
    } else this.timer--;
  }
  advance(k) {
    while (k > 0) {
      if (this.timer >= k) { this.timer -= k; return; }
      k -= this.timer + 1; this.timer = this.period;
      const fb = (this.sr & 1) ^ ((this.sr >> (this.mode ? 6 : 1)) & 1);
      this.sr = (this.sr >> 1) | (fb << 14);
    }
  }
  out() { if (!this.enabled || this.length === 0 || (this.sr & 1)) return 0; return this.constVol ? this.vol : this.envDecay; }
}

const AUDIO_SIZE = 32768, AUDIO_MASK = AUDIO_SIZE - 1;
class APU {
  constructor(nes) {
    this.nes = nes;
    this.buf = new Float32Array(AUDIO_SIZE);
    this.rp = 0; this.wp = 0; this.last = 0;
    this.px = 0; this.py = 0; this.volume = 1;
    this.setSampleRate(44100);
    this.reset();
  }
  setSampleRate(sr) { this.sampleRate = sr; this.ratio = 1789773 / sr; }
  reset() {
    this.p1 = new Pulse(true); this.p2 = new Pulse(false); this.tri = new Triangle(); this.noise = new Noise();
    this.fc = 0; this.mode5 = false; this.inhibit = false; this.irq = false; this.cyc = 0;
    this.sum = 0; this.nacc = 0; this.phase = 0;
  }
  buffered() { return this.wp - this.rp; }
  push(s) {
    const y = s - this.px + 0.996 * this.py; this.px = s; this.py = y;
    if (this.wp - this.rp >= AUDIO_SIZE) this.rp++;
    this.buf[this.wp & AUDIO_MASK] = y * 0.8 * this.volume; this.wp++;
  }
  fill(out) {
    for (let i = 0; i < out.length; i++) {
      if (this.rp < this.wp) { this.last = this.buf[this.rp & AUDIO_MASK]; this.rp++; } else this.last *= 0.995;
      out[i] = this.last;
    }
  }
  quarter() { this.p1.clockEnv(); this.p2.clockEnv(); this.noise.clockEnv(); this.tri.clockLinear(); }
  half() {
    this.p1.clockLen(); this.p2.clockLen(); this.tri.clockLen(); this.noise.clockLen();
    this.p1.clockSweep(); this.p2.clockSweep();
  }
  read(a) {
    if (a === 0x4015) {
      const v = (this.p1.length > 0 ? 1 : 0) | (this.p2.length > 0 ? 2 : 0) | (this.tri.length > 0 ? 4 : 0) | (this.noise.length > 0 ? 8 : 0) | (this.irq ? 0x40 : 0);
      this.irq = false; return v;
    }
    return 0;
  }
  write(a, v) {
    if (a < 0x4004) this.p1.write(a & 3, v);
    else if (a < 0x4008) this.p2.write(a & 3, v);
    else if (a < 0x400C) this.tri.write(a & 3, v);
    else if (a < 0x4010) this.noise.write(a & 3, v);
    else if (a === 0x4015) {
      this.p1.enabled = !!(v & 1); if (!this.p1.enabled) this.p1.length = 0;
      this.p2.enabled = !!(v & 2); if (!this.p2.enabled) this.p2.length = 0;
      this.tri.enabled = !!(v & 4); if (!this.tri.enabled) this.tri.length = 0;
      this.noise.enabled = !!(v & 8); if (!this.noise.enabled) this.noise.length = 0;
    } else if (a === 0x4017) {
      this.mode5 = !!(v & 0x80); this.inhibit = !!(v & 0x40);
      if (this.inhibit) this.irq = false;
      this.fc = 0;
      if (this.mode5) { this.quarter(); this.half(); }
    }
  }
  run(n) {
    const p1 = this.p1, p2 = this.p2, tri = this.tri, noi = this.noise;
    while (n > 0) {
      // caminho rápido: 4 ciclos de uma vez quando nenhum evento do contador de quadros cai neles
      if ((this.cyc & 3) === 0 && n >= 4) {
        const fc = this.fc, last = this.mode5 ? 37281 : 29829, lim = this.mode5 ? 37282 : 29830;
        const nxt = fc < 7457 ? 7457 : fc < 14913 ? 14913 : fc < 22371 ? 22371 : fc < last ? last : lim;
        if (nxt - fc > 4) {
          this.fc = fc + 4; this.cyc += 4; n -= 4;
          tri.advance(4); noi.advance(4); p1.advance(2); p2.advance(2);
          this.sum += PULSE_T[p1.out() + p2.out()] + TND_T[3 * tri.out() + 2 * noi.out()];
          this.nacc++; this.phase += 4;
          if (this.phase >= this.ratio) { this.phase -= this.ratio; this.push(this.sum / this.nacc); this.sum = 0; this.nacc = 0; }
          continue;
        }
      }
      const f = ++this.fc;
      if (f === 7457) this.quarter();
      else if (f === 14913) { this.quarter(); this.half(); }
      else if (f === 22371) this.quarter();
      else if (this.mode5) { if (f === 37281) { this.quarter(); this.half(); } }
      else if (f === 29829) { this.quarter(); this.half(); if (!this.inhibit) this.irq = true; }
      if (f >= (this.mode5 ? 37282 : 29830)) this.fc = 0;
      tri.clockTimer(); noi.clockTimer();
      this.cyc++;
      if (this.cyc & 1) { p1.clockTimer(); p2.clockTimer(); }
      if ((this.cyc & 3) === 0) {
        this.sum += PULSE_T[p1.out() + p2.out()] + TND_T[3 * tri.out() + 2 * noi.out()];
        this.nacc++; this.phase += 4;
        if (this.phase >= this.ratio) {
          this.phase -= this.ratio;
          this.push(this.sum / this.nacc); this.sum = 0; this.nacc = 0;
        }
      }
      n--;
    }
  }
}

