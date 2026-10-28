'use strict';
/* APU do Game Boy: 2 quadrados (o 1º com sweep), onda e ruído; sequenciador de quadros de 512 Hz.
 * Saída mono (soma dos dois lados), reamostrada para a taxa do navegador. */
const GB_CLOCK = 4194304;
const GB_DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];
const GB_NOISE_DIV = [8, 16, 32, 48, 64, 80, 96, 112];
const GB_AUDIO_SIZE = 32768, GB_AUDIO_MASK = GB_AUDIO_SIZE - 1;

class GBApuChan {
  constructor() { this.on = false; this.dac = false; this.len = 0; this.lenEn = false; this.vol = 0; this.initVol = 0; this.envDir = 0; this.envPer = 0; this.envT = 0; this.timer = 0; }
  clockLen(max) { if (this.lenEn && this.len > 0) { this.len--; if (this.len === 0) this.on = false; } }
  clockEnv() {
    if (this.envPer === 0) return;
    if (--this.envT <= 0) {
      this.envT = this.envPer;
      if (this.envDir && this.vol < 15) this.vol++; else if (!this.envDir && this.vol > 0) this.vol--;
    }
  }
  setEnv(v) { this.initVol = v >> 4; this.envDir = (v >> 3) & 1; this.envPer = v & 7; this.dac = (v & 0xF8) !== 0; if (!this.dac) this.on = false; }
  trigEnv() { this.vol = this.initVol; this.envT = this.envPer || 8; }
}

class GBApu {
  constructor(gb) {
    this.gb = gb;
    this.buf = new Float32Array(GB_AUDIO_SIZE);
    this.rp = 0; this.wp = 0; this.last = 0; this.px = 0; this.py = 0; this.volume = 1;
    this.setSampleRate(44100);
    this.reset();
  }
  setSampleRate(sr) { this.sampleRate = sr; this.cps = GB_CLOCK / sr; }
  reset() {
    this.regs = new Uint8Array(0x30);
    this.p1 = new GBApuChan(); this.p2 = new GBApuChan(); this.wv = new GBApuChan(); this.nz = new GBApuChan();
    this.p1.duty = 0; this.p1.freq = 0; this.p1.seq = 0; this.p2.duty = 0; this.p2.freq = 0; this.p2.seq = 0;
    this.sweepPer = 0; this.sweepShift = 0; this.sweepNeg = false; this.sweepT = 0; this.sweepEn = false; this.shadow = 0;
    this.wv.freq = 0; this.wv.pos = 0; this.wv.code = 0; this.wram = new Uint8Array(16); this.wv.sample = 0;
    this.nz.lfsr = 0x7FFF; this.nz.shift = 0; this.nz.width7 = false; this.nz.div = 0;
    this.nr50 = 0; this.nr51 = 0; this.power = true;
    this.fs = 0; this.fsT = 0; this.acc = 0; this.mix = 0;
  }
  /* ---- registradores ---- */
  read(a) {
    if (a >= 0xFF30) return this.wram[a - 0xFF30];
    switch (a) {
      case 0xFF10: return this.regs[0] | 0x80;
      case 0xFF11: return this.regs[1] | 0x3F; case 0xFF12: return this.regs[2]; case 0xFF13: return 0xFF; case 0xFF14: return this.regs[4] | 0xBF;
      case 0xFF16: return this.regs[6] | 0x3F; case 0xFF17: return this.regs[7]; case 0xFF18: return 0xFF; case 0xFF19: return this.regs[9] | 0xBF;
      case 0xFF1A: return this.regs[10] | 0x7F; case 0xFF1B: return 0xFF; case 0xFF1C: return this.regs[12] | 0x9F; case 0xFF1D: return 0xFF; case 0xFF1E: return this.regs[14] | 0xBF;
      case 0xFF20: return 0xFF; case 0xFF21: return this.regs[17]; case 0xFF22: return this.regs[18]; case 0xFF23: return this.regs[19] | 0xBF;
      case 0xFF24: return this.nr50; case 0xFF25: return this.nr51;
      case 0xFF26: return 0x70 | (this.power ? 0x80 : 0) | (this.p1.on ? 1 : 0) | (this.p2.on ? 2 : 0) | (this.wv.on ? 4 : 0) | (this.nz.on ? 8 : 0);
    }
    return 0xFF;
  }
  write(a, v) {
    if (a >= 0xFF30) { this.wram[a - 0xFF30] = v; return; }
    if (a === 0xFF26) {
      const p = (v & 0x80) !== 0;
      if (!p && this.power) { for (let r = 0xFF10; r < 0xFF26; r++) this.writeReg(r, 0, true); this.nr50 = 0; this.nr51 = 0; this.p1.on = this.p2.on = this.wv.on = this.nz.on = false; }
      this.power = p; return;
    }
    if (!this.power) { // desligado: no DMG só os contadores de comprimento aceitam escrita
      if (a === 0xFF11) this.p1.len = 64 - (v & 63); else if (a === 0xFF16) this.p2.len = 64 - (v & 63);
      else if (a === 0xFF1B) this.wv.len = 256 - v; else if (a === 0xFF20) this.nz.len = 64 - (v & 63);
      return;
    }
    this.writeReg(a, v, false);
  }
  writeReg(a, v, force) {
    const R = this.regs, p1 = this.p1, p2 = this.p2, wv = this.wv, nz = this.nz;
    const r = a - 0xFF10; if (r >= 0 && r < 0x20) R[r] = v;
    switch (a) {
      case 0xFF10: if (this.negUsed && this.sweepNeg && !(v & 8)) this.p1.on = false; this.sweepPer = (v >> 4) & 7; this.sweepNeg = (v & 8) !== 0; this.sweepShift = v & 7; break;
      case 0xFF11: p1.duty = v >> 6; if (!force) p1.len = 64 - (v & 63); break;
      case 0xFF12: p1.setEnv(v); break;
      case 0xFF13: p1.freq = (p1.freq & 0x700) | v; break;
      case 0xFF14: p1.freq = (p1.freq & 0xFF) | ((v & 7) << 8); this.lenEnable(p1, v); if (v & 0x80) { this.trigPulse(p1, true); this.trigLen(p1, 64); } break;
      case 0xFF16: p2.duty = v >> 6; if (!force) p2.len = 64 - (v & 63); break;
      case 0xFF17: p2.setEnv(v); break;
      case 0xFF18: p2.freq = (p2.freq & 0x700) | v; break;
      case 0xFF19: p2.freq = (p2.freq & 0xFF) | ((v & 7) << 8); this.lenEnable(p2, v); if (v & 0x80) { this.trigPulse(p2, false); this.trigLen(p2, 64); } break;
      case 0xFF1A: wv.dac = (v & 0x80) !== 0; if (!wv.dac) wv.on = false; break;
      case 0xFF1B: if (!force) wv.len = 256 - v; break;
      case 0xFF1C: wv.code = (v >> 5) & 3; break;
      case 0xFF1D: wv.freq = (wv.freq & 0x700) | v; break;
      case 0xFF1E: wv.freq = (wv.freq & 0xFF) | ((v & 7) << 8); this.lenEnable(wv, v); if (v & 0x80) { wv.on = wv.dac; this.trigLen(wv, 256); wv.timer = (2048 - wv.freq) * 2; wv.pos = 0; } break;
      case 0xFF20: if (!force) nz.len = 64 - (v & 63); break;
      case 0xFF21: nz.setEnv(v); break;
      case 0xFF22: nz.shift = v >> 4; nz.width7 = (v & 8) !== 0; nz.div = v & 7; break;
      case 0xFF23: this.lenEnable(nz, v); if (v & 0x80) { nz.on = nz.dac; this.trigLen(nz, 64); nz.trigEnv(); nz.lfsr = 0x7FFF; nz.timer = GB_NOISE_DIV[nz.div] << nz.shift; } break;
      case 0xFF24: this.nr50 = v; break;
      case 0xFF25: this.nr51 = v; break;
    }
  }
  lenEnable(ch, v) { // habilitar o comprimento na primeira metade do período dá um clock extra
    const was = ch.lenEn; ch.lenEn = (v & 0x40) !== 0;
    if (!was && ch.lenEn && (this.fs & 1) && ch.len > 0) { ch.len--; if (ch.len === 0 && !(v & 0x80)) ch.on = false; }
  }
  trigLen(ch, max) { if (ch.len === 0) { ch.len = max; if (ch.lenEn && (this.fs & 1)) ch.len--; } }
  trigPulse(p, sw) {
    p.on = p.dac;
    p.timer = (2048 - p.freq) * 4; p.trigEnv();
    if (sw) {
      this.negUsed = false; this.shadow = p.freq; this.sweepT = this.sweepPer || 8; this.sweepEn = this.sweepPer > 0 || this.sweepShift > 0;
      if (this.sweepShift > 0) this.sweepCalc(false);
    }
  }
  sweepCalc(apply) {
    let d = this.shadow >> this.sweepShift;
    const nf = this.sweepNeg ? this.shadow - d : this.shadow + d;
    if (this.sweepNeg) this.negUsed = true;
    if (nf > 2047) { this.p1.on = false; return false; }
    if (apply && this.sweepShift > 0) { this.shadow = nf; this.p1.freq = nf; }
    return true;
  }
  /* ---- relógio ---- */
  frameSeq() {
    const s = this.fs; this.fs = (this.fs + 1) & 7;
    if (!(s & 1)) { this.p1.clockLen(); this.p2.clockLen(); this.wv.clockLen(); this.nz.clockLen(); }
    if (s === 2 || s === 6) {
      if (this.sweepEn && --this.sweepT <= 0) {
        this.sweepT = this.sweepPer || 8;
        if (this.sweepPer > 0) { if (this.sweepCalc(true)) this.sweepCalc(false); }
      }
    }
    if (s === 7) { this.p1.clockEnv(); this.p2.clockEnv(); this.nz.clockEnv(); }
  }
  chanOut() {
    const p1 = this.p1, p2 = this.p2, wv = this.wv, nz = this.nz, n = this.nr51;
    let l = 0, r = 0, v;
    if (p1.on) { v = GB_DUTY[p1.duty][p1.seq] ? p1.vol : 0; if (n & 1) r += v; if (n & 0x10) l += v; }
    if (p2.on) { v = GB_DUTY[p2.duty][p2.seq] ? p2.vol : 0; if (n & 2) r += v; if (n & 0x20) l += v; }
    if (wv.on) { v = wv.code ? wv.sample >> (wv.code - 1) : 0; if (n & 4) r += v; if (n & 0x40) l += v; }
    if (nz.on) { v = (nz.lfsr & 1) ? 0 : nz.vol; if (n & 8) r += v; if (n & 0x80) l += v; }
    return (l * (((this.nr50 >> 4) & 7) + 1) + r * ((this.nr50 & 7) + 1)) / (2 * 8 * 60);
  }
  tick(c) {
    // avança em passos de até 4 ciclos para manter os temporizadores dos canais coerentes
    let left = c;
    while (left > 0) {
      const st = left > 8 ? 8 : left; left -= st;
      this.fsT += st; if (this.fsT >= 8192) { this.fsT -= 8192; this.frameSeq(); }
      const p1 = this.p1, p2 = this.p2, wv = this.wv, nz = this.nz;
      p1.timer -= st; while (p1.timer <= 0) { p1.timer += (2048 - p1.freq) * 4 || 4; p1.seq = (p1.seq + 1) & 7; }
      p2.timer -= st; while (p2.timer <= 0) { p2.timer += (2048 - p2.freq) * 4 || 4; p2.seq = (p2.seq + 1) & 7; }
      wv.timer -= st;
      while (wv.timer <= 0) { wv.timer += (2048 - wv.freq) * 2 || 2; wv.pos = (wv.pos + 1) & 31; const b = this.wram[wv.pos >> 1]; wv.sample = (wv.pos & 1) ? b & 15 : b >> 4; }
      nz.timer -= st;
      while (nz.timer <= 0) {
        nz.timer += (GB_NOISE_DIV[nz.div] << nz.shift) || 8;
        const x = (nz.lfsr & 1) ^ ((nz.lfsr >> 1) & 1);
        nz.lfsr = (nz.lfsr >> 1) | (x << 14);
        if (nz.width7) nz.lfsr = (nz.lfsr & ~0x40) | (x << 6);
      }
      this.acc += st;
      if (this.acc >= this.cps) { this.acc -= this.cps; this.push(this.power ? this.chanOut() : 0); }
    }
  }
  buffered() { return this.wp - this.rp; }
  push(s) {
    const y = s - this.px + 0.996 * this.py; this.px = s; this.py = y;
    if (this.wp - this.rp >= GB_AUDIO_SIZE) this.rp++;
    this.buf[this.wp & GB_AUDIO_MASK] = y * 0.9 * this.volume; this.wp++;
  }
  fill(out) {
    for (let i = 0; i < out.length; i++) {
      if (this.rp < this.wp) { this.last = this.buf[this.rp & GB_AUDIO_MASK]; this.rp++; } else this.last *= 0.995;
      out[i] = this.last;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GBApu };
