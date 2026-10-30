'use strict';
/* PSG SN76489: 3 tons + ruído, relógio do Z80 / 16. Saída mono reamostrada (média por amostra). */
const PSG_CLOCK = 3579545, PSG_BUF = 32768, PSG_MASK = PSG_BUF - 1;
const PSG_VOL = [1, 0.794, 0.631, 0.501, 0.398, 0.316, 0.251, 0.2, 0.158, 0.126, 0.1, 0.079, 0.063, 0.05, 0.04, 0];

class SMSPsg {
  constructor() {
    this.abuf = new Float32Array(PSG_BUF); this.rp = 0; this.wp = 0; this.last = 0; this.px = 0; this.py = 0; this.volume = 1;
    this.setSampleRate(44100); this.reset();
  }
  setSampleRate(sr) { this.sampleRate = sr; this.cpuPerSample = PSG_CLOCK / sr; }
  reset() {
    this.freq = [0, 0, 0]; this.cnt = [1, 1, 1]; this.out = [1, 1, 1]; this.att = [15, 15, 15, 15];
    this.noiseCtl = 0; this.noiseCnt = 1; this.noiseFlip = 0; this.lfsr = 0x8000; this.noiseOut = 0;
    this.latchCh = 0; this.latchType = 0; this.clk = 0; this.acc = 0; this.n = 0; this.cyc = 0;
  }
  write(v) {
    if (v & 0x80) {
      this.latchCh = (v >> 5) & 3; this.latchType = (v >> 4) & 1;
      if (this.latchType) this.att[this.latchCh] = v & 15;
      else if (this.latchCh < 3) this.freq[this.latchCh] = (this.freq[this.latchCh] & 0x3F0) | (v & 15);
      else { this.noiseCtl = v & 7; this.lfsr = 0x8000; }
    } else {
      if (this.latchType) this.att[this.latchCh] = v & 15;
      else if (this.latchCh < 3) this.freq[this.latchCh] = (this.freq[this.latchCh] & 15) | ((v & 0x3F) << 4);
      else { this.noiseCtl = v & 7; this.lfsr = 0x8000; }
    }
  }
  /* avança 'c' ciclos de CPU */
  tick(c) {
    this.clk += c;
    while (this.clk >= 16) { this.clk -= 16; this.step(); }
  }
  step() {
    for (let i = 0; i < 3; i++) {
      if (--this.cnt[i] <= 0) {
        const f = this.freq[i]; this.cnt[i] = f;
        if (f < 2) this.out[i] = 1; else this.out[i] ^= 1;
      }
    }
    if (--this.noiseCnt <= 0) {
      const r = this.noiseCtl & 3;
      this.noiseCnt = r === 0 ? 16 : r === 1 ? 32 : r === 2 ? 64 : (this.freq[2] || 1);
      this.noiseFlip ^= 1;
      if (this.noiseFlip) {
        const fb = (this.noiseCtl & 4) ? ((this.lfsr & 1) ^ ((this.lfsr >> 3) & 1)) : (this.lfsr & 1);
        this.lfsr = (this.lfsr >> 1) | (fb << 15); this.noiseOut = this.lfsr & 1;
      }
    }
    let s = 0;
    for (let i = 0; i < 3; i++) s += (this.out[i] ? 1 : -1) * PSG_VOL[this.att[i]];
    s += (this.noiseOut ? 1 : -1) * PSG_VOL[this.att[3]];
    this.acc += s; this.n++;
    this.cyc += 16;
    if (this.cyc >= this.cpuPerSample) { this.cyc -= this.cpuPerSample; this.push(this.acc / this.n * 0.22); this.acc = 0; this.n = 0; }
  }
  buffered() { return this.wp - this.rp; }
  push(s) {
    const y = s - this.px + 0.996 * this.py; this.px = s; this.py = y;
    if (this.wp - this.rp >= PSG_BUF) this.rp++;
    this.abuf[this.wp & PSG_MASK] = y * this.volume; this.wp++;
  }
  fill(out) {
    for (let i = 0; i < out.length; i++) {
      if (this.rp < this.wp) { this.last = this.abuf[this.rp & PSG_MASK]; this.rp++; } else this.last *= 0.995;
      out[i] = this.last;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { SMSPsg };
