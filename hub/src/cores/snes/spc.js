'use strict';
/* APU do SNES: processador de som SPC700 + DSP de 8 vozes (BRR, envelopes ADSR/GAIN, ruído, modulação
 * de pitch, eco com filtro FIR). A ROM de boot do SPC (IPL) é emulada por código em JS que segue o
 * protocolo documentado de upload pelas portas 2140-2143, então nenhuma ROM da Nintendo é necessária.
 * A interpolação é cúbica (a original usa uma tabela gaussiana), o que soa quase igual. */
const SPC_RATE = [0, 2048, 1536, 1280, 1024, 768, 640, 512, 384, 320, 256, 192, 160, 128, 96, 80, 64, 48, 40, 32, 24, 20, 16, 12, 10, 8, 6, 5, 4, 3, 2, 1];
const SPC_CYC = [
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 6, 8, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 4, 6,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 4, 5, 4, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 6, 5, 2, 2, 3, 8,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 6, 6, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 4, 5, 2, 2, 4, 3,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 4, 5, 5, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 6,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 6, 5, 4, 5, 2, 4, 5, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 12, 5,
  3, 8, 4, 5, 3, 4, 3, 6, 2, 6, 4, 4, 5, 2, 4, 4, 2, 8, 4, 5, 4, 5, 5, 6, 5, 5, 5, 5, 2, 2, 3, 4,
  3, 8, 4, 5, 4, 5, 4, 7, 2, 5, 6, 4, 5, 2, 4, 9, 2, 8, 4, 5, 5, 6, 6, 7, 4, 5, 5, 5, 2, 2, 6, 3,
  2, 8, 4, 5, 3, 4, 3, 6, 2, 4, 5, 3, 4, 3, 4, 3, 2, 8, 4, 5, 4, 5, 5, 6, 3, 4, 5, 5, 2, 2, 4, 3
];

class SNESAPU {
  constructor(sys) {
    this.sys = sys;
    this.ram = new Uint8Array(65536);
    this.inPorts = new Uint8Array(4); this.outPorts = new Uint8Array(4);
    this.dsp = new Uint8Array(128);
    this.timerTarget = new Uint8Array(3); this.timerStage = new Uint8Array(3); this.timerOut = new Uint8Array(3); this.timerCyc = new Float64Array(3);
    // vozes
    this.vAddr = new Uint16Array(8); this.vIdx = new Uint8Array(8); this.vFrac = new Uint16Array(8);
    this.vEnv = new Int16Array(8); this.vMode = new Uint8Array(8); // 0 desligada, 1 ataque, 2 decaimento, 3 sustentação, 4 release
    this.vHist = new Int16Array(8 * 4); this.vBlk = new Int16Array(8 * 16); this.vP1 = new Int16Array(8); this.vP2 = new Int16Array(8);
    this.vOut = new Int16Array(8); this.vKonDelay = new Uint8Array(8);
    this.echoHist = new Int16Array(16); this.echoPos = 0; this.echoIdx = 0;
    this.sampleBuf = new Float32Array(1 << 16); this.wp = 0; this.rpf = 0; this.step = 32000 / 44100; this.volume = 1;
    this.reset();
  }
  reset() {
    this.ram.fill(0); this.dsp.fill(0); this.inPorts.fill(0); this.outPorts.fill(0);
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xEF; this.pc = 0;
    this.n = 0; this.v = 0; this.p = 0; this.h = 0; this.i = 0; this.z = 0; this.c = 0;
    this.control = 0x80; this.dspAddr = 0; this.running = false; this.owed = 0; this.lastCyc = 0; this.dspCyc = 0;
    this.timerTarget.fill(0xFF); this.timerStage.fill(0); this.timerOut.fill(0); this.timerCyc.fill(0);
    this.vMode.fill(0); this.vEnv.fill(0); this.vOut.fill(0); this.echoHist.fill(0); this.echoPos = 0;
    this.noise = 0x4000; this.sampleCount = 0; this.kon = 0; this.koff = 0; this.endx = 0;
    this.dsp[0x6C] = 0xE0;
    this.bootIpl();
  }
  /* ---------- IPL em JS ---------- */
  bootIpl() {
    this.running = false; this.iplMode = 0; this.iplCounter = 0; this.iplDest = 0; this.iplLast = -1;
    this.outPorts[0] = 0xAA; this.outPorts[1] = 0xBB;
  }
  iplStep() {
    const i = this.inPorts, o = this.outPorts;
    for (let guard = 0; guard < 4 && !this.running; guard++) {
      if (this.iplMode === 0) { // espera o CC
        if (i[0] !== 0xCC) return;
        this.iplHeader(0xCC);
      } else if (this.iplMode === 1) { // espera port0 = 0 depois de um cabeçalho
        if (i[0] !== 0) return;
        this.iplMode = 2; this.iplCounter = 0;
      } else {
        const p0 = i[0];
        if (p0 === this.iplCounter) {
          this.ram[this.iplDest] = i[1]; this.iplDest = (this.iplDest + 1) & 0xFFFF;
          o[0] = this.iplCounter; this.iplCounter = (this.iplCounter + 1) & 0xFF;
        } else if (((p0 - this.iplCounter) & 0xFF) < 0x80 && p0 !== this.iplLast) this.iplHeader(p0);
        else return;
      }
    }
  }
  iplHeader(p0) {
    const i = this.inPorts, o = this.outPorts;
    this.iplDest = i[2] | (i[3] << 8); this.iplLast = p0; o[0] = p0;
    if (i[1] === 0) { // executar
      this.pc = this.iplDest; this.sp = 0xEF; this.x = 0; this.running = true;
      for (let k = 0; k < 0xF0; k++) if (k !== 0xF0) { /* o IPL real zera $00-$EF antes do upload; já está zerado */ }
    } else this.iplMode = 1;
  }
  /* ---------- barramento do SPC ---------- */
  rd(a) {
    if (a >= 0xF0 && a < 0x100) {
      switch (a) {
        case 0xF2: return this.dspAddr;
        case 0xF3: return this.dsp[this.dspAddr & 0x7F];
        case 0xF4: case 0xF5: case 0xF6: case 0xF7: return this.inPorts[a - 0xF4];
        case 0xFA: case 0xFB: case 0xFC: return 0;
        case 0xFD: case 0xFE: case 0xFF: { const t = a - 0xFD, v = this.timerOut[t]; this.timerOut[t] = 0; return v; }
        default: return this.ram[a];
      }
    }
    return this.ram[a];
  }
  wr(a, v) {
    this.ram[a] = v;
    if (a >= 0xF0 && a < 0x100) {
      switch (a) {
        case 0xF1: {
          const was = this.control; this.control = v;
          for (let t = 0; t < 3; t++) if ((v & (1 << t)) && !(was & (1 << t))) { this.timerStage[t] = 0; this.timerOut[t] = 0; this.timerCyc[t] = 0; }
          if (v & 0x10) { this.inPorts[0] = 0; this.inPorts[1] = 0; }
          if (v & 0x20) { this.inPorts[2] = 0; this.inPorts[3] = 0; }
          break;
        }
        case 0xF2: this.dspAddr = v; break;
        case 0xF3: if (this.dspAddr < 0x80) this.dspWrite(this.dspAddr, v); break;
        case 0xF4: case 0xF5: case 0xF6: case 0xF7: this.outPorts[a - 0xF4] = v; break;
        case 0xFA: case 0xFB: case 0xFC: this.timerTarget[a - 0xFA] = v; break;
      }
    }
  }
  dspWrite(r, v) {
    if (r === 0x7C) { this.dsp[r] = 0; this.endx = 0; return; } // qualquer escrita limpa o ENDX
    this.dsp[r] = v;
    if (r === 0x4C) this.kon |= v;
    else if (r === 0x5C) this.koff = v;
  }
  /* ---------- sincronização com a CPU principal ---------- */
  sync(cyc, eol) {
    if (this.clock === undefined) { this.clock = 0; this.portClock = -100; }
    const d = cyc - this.lastCyc;
    this.lastCyc = eol ? cyc - 1364 : cyc;
    if (d > 0) { this.owed += d * (1024000 / 21477272); this.clock += d; }
    if (!this.running) { if (this.clock - this.portClock >= 40) this.iplStep(); if (!this.running) { this.skipIdle(); return; } }
    while (this.owed > 0) {
      if (this.pc >= 0xFFC0 && (this.control & 0x80)) { this.bootIpl(); this.skipIdle(); return; }
      this.stepCycles(this.exec());
    }
  }
  skipIdle() { // enquanto o IPL espera, só o relógio do DSP anda
    if (this.owed > 0) { const c = this.owed; this.owed = 0; this.stepCycles2(c); }
  }
  stepCycles(c) { this.owed -= c; this.stepCycles2(c); }
  stepCycles2(c) {
    // temporizadores
    const ctl = this.control;
    for (let t = 0; t < 3; t++) {
      if (!(ctl & (1 << t))) continue;
      const per = t === 2 ? 16 : 128; this.timerCyc[t] += c;
      while (this.timerCyc[t] >= per) {
        this.timerCyc[t] -= per;
        if (++this.timerStage[t] === (this.timerTarget[t] || 256)) { this.timerStage[t] = 0; this.timerOut[t] = (this.timerOut[t] + 1) & 15; }
      }
    }
    this.dspCyc += c;
    while (this.dspCyc >= 32) { this.dspCyc -= 32; this.dspSample(); }
  }
  /* ---------- CPU SPC700 ---------- */
  psw() { return (this.n << 7) | (this.v << 6) | (this.p << 5) | (this.h << 3) | (this.i << 2) | (this.z << 1) | this.c; }
  setPsw(v) { this.n = (v >> 7) & 1; this.v = (v >> 6) & 1; this.p = (v >> 5) & 1; this.h = (v >> 3) & 1; this.i = (v >> 2) & 1; this.z = (v >> 1) & 1; this.c = v & 1; }
  f8() { const v = this.rd(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  f16() { const l = this.f8(); return l | (this.f8() << 8); }
  dpa(o) { return (this.p ? 0x100 : 0) | (o & 0xFF); }
  push(v) { this.ram[0x100 | this.sp] = v; this.sp = (this.sp - 1) & 0xFF; }
  pop() { this.sp = (this.sp + 1) & 0xFF; return this.ram[0x100 | this.sp]; }
  nz(v) { this.n = (v >> 7) & 1; this.z = (v & 0xFF) === 0 ? 1 : 0; }
  alu(k, a, b) {
    let r;
    switch (k) {
      case 0: r = a | b; this.nz(r); return r;
      case 1: r = a & b; this.nz(r); return r;
      case 2: r = a ^ b; this.nz(r); return r;
      case 3: r = a - b; this.c = a >= b ? 1 : 0; this.nz(r & 0xFF); return a; // CMP: não altera
      case 4: r = a + b + this.c; this.v = (~(a ^ b) & (a ^ r) & 0x80) ? 1 : 0; this.h = (((a & 15) + (b & 15) + this.c) > 15) ? 1 : 0; this.c = r > 0xFF ? 1 : 0; r &= 0xFF; this.nz(r); return r;
      default: { b ^= 0xFF; r = a + b + this.c; this.v = (~(a ^ b) & (a ^ r) & 0x80) ? 1 : 0; this.h = (((a & 15) + (b & 15) + this.c) > 15) ? 1 : 0; this.c = r > 0xFF ? 1 : 0; r &= 0xFF; this.nz(r); return r; }
    }
  }
  bra(cond) { const o = this.f8(); if (cond) { this.pc = (this.pc + (o << 24 >> 24)) & 0xFFFF; return 2; } return 0; }
  exec() {
    const op = this.f8(); let extra = 0;
    // grupo ALU: OR AND EOR CMP ADC SBC com os modos usuais
    const lo = op & 15, hi = op >> 4;
    if (lo >= 4 && lo <= 9 && hi <= 0xB) {
      const k = hi >> 1, odd = hi & 1;
      let ea, src, dst;
      if (!odd) {
        switch (lo) {
          case 4: ea = this.dpa(this.f8()); break;
          case 5: ea = this.f16(); break;
          case 6: ea = this.dpa(this.x); break;
          case 7: { const d = (this.f8() + this.x) & 0xFF, a = this.dpa(d); ea = this.rd(a) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8); } break;
          case 8: { const v = this.f8(); this.a = this.alu(k, this.a, v); return SPC_CYC[op]; }
          default: { const s = this.dpa(this.f8()), d = this.dpa(this.f8()); const r = this.alu(k, this.rd(d), this.rd(s)); if (k !== 3) this.wr(d, r); return SPC_CYC[op]; }
        }
        this.a = this.alu(k, this.a, this.rd(ea)); return SPC_CYC[op];
      }
      switch (lo) {
        case 4: ea = this.dpa((this.f8() + this.x) & 0xFF); break;
        case 5: ea = (this.f16() + this.x) & 0xFFFF; break;
        case 6: ea = (this.f16() + this.y) & 0xFFFF; break;
        case 7: { const d = this.f8(), a = this.dpa(d); ea = ((this.rd(a) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8)) + this.y) & 0xFFFF; } break;
        case 8: { const v = this.f8(), d = this.dpa(this.f8()); const r = this.alu(k, this.rd(d), v); if (k !== 3) this.wr(d, r); return SPC_CYC[op]; }
        default: { const sa = this.dpa(this.y), da = this.dpa(this.x); const r = this.alu(k, this.rd(da), this.rd(sa)); if (k !== 3) this.wr(da, r); return SPC_CYC[op]; }
      }
      this.a = this.alu(k, this.a, this.rd(ea)); return SPC_CYC[op];
    }
    switch (op) {
      case 0x00: break; // NOP
      case 0xEF: case 0xFF: this.pc = (this.pc - 1) & 0xFFFF; break; // SLEEP / STOP: travam
      /* TCALL */
      case 0x01: case 0x11: case 0x21: case 0x31: case 0x41: case 0x51: case 0x61: case 0x71:
      case 0x81: case 0x91: case 0xA1: case 0xB1: case 0xC1: case 0xD1: case 0xE1: case 0xF1: {
        this.push(this.pc >> 8); this.push(this.pc & 0xFF); const vec = 0xFFDE - (op >> 4) * 2; this.pc = this.rd(vec) | (this.rd(vec + 1) << 8);
      } break;
      /* SET1 / CLR1 */
      case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xA2: case 0xC2: case 0xE2: { const a = this.dpa(this.f8()); this.wr(a, this.rd(a) | (1 << (op >> 5))); } break;
      case 0x12: case 0x32: case 0x52: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2: { const a = this.dpa(this.f8()); this.wr(a, this.rd(a) & ~(1 << (op >> 5))); } break;
      /* BBS / BBC */
      case 0x03: case 0x23: case 0x43: case 0x63: case 0x83: case 0xA3: case 0xC3: case 0xE3: { const v = this.rd(this.dpa(this.f8())); extra = this.bra((v >> (op >> 5)) & 1); } break;
      case 0x13: case 0x33: case 0x53: case 0x73: case 0x93: case 0xB3: case 0xD3: case 0xF3: { const v = this.rd(this.dpa(this.f8())); extra = this.bra(!((v >> (op >> 5)) & 1)); } break;
      /* ramos */
      case 0x10: extra = this.bra(!this.n); break; case 0x30: extra = this.bra(this.n); break;
      case 0x50: extra = this.bra(!this.v); break; case 0x70: extra = this.bra(this.v); break;
      case 0x90: extra = this.bra(!this.c); break; case 0xB0: extra = this.bra(this.c); break;
      case 0xD0: extra = this.bra(!this.z); break; case 0xF0: extra = this.bra(this.z); break;
      case 0x2F: extra = this.bra(true); break;
      case 0x2E: { const v = this.rd(this.dpa(this.f8())); extra = this.bra(this.a !== v); } break; // CBNE d
      case 0xDE: { const v = this.rd(this.dpa((this.f8() + this.x) & 0xFF)); extra = this.bra(this.a !== v); } break; // CBNE d+X
      case 0x6E: { const a = this.dpa(this.f8()), v = (this.rd(a) - 1) & 0xFF; this.wr(a, v); extra = this.bra(v !== 0); } break; // DBNZ d
      case 0xFE: this.y = (this.y - 1) & 0xFF; extra = this.bra(this.y !== 0); break; // DBNZ Y
      /* flags */
      case 0x20: this.p = 0; break; case 0x40: this.p = 1; break;
      case 0x60: this.c = 0; break; case 0x80: this.c = 1; break; case 0xED: this.c ^= 1; break;
      case 0xA0: this.i = 1; break; case 0xC0: this.i = 0; break; // EI / DI
      case 0xE0: this.v = 0; this.h = 0; break;
      /* pilha */
      case 0x0D: this.push(this.psw()); break; case 0x2D: this.push(this.a); break; case 0x4D: this.push(this.x); break; case 0x6D: this.push(this.y); break;
      case 0x8E: this.setPsw(this.pop()); break; case 0xAE: this.a = this.pop(); break; case 0xCE: this.x = this.pop(); break; case 0xEE: this.y = this.pop(); break;
      /* chamadas e saltos */
      case 0x3F: { const a = this.f16(); this.push(this.pc >> 8); this.push(this.pc & 0xFF); this.pc = a; } break; // CALL
      case 0x4F: { const o = this.f8(); this.push(this.pc >> 8); this.push(this.pc & 0xFF); this.pc = 0xFF00 | o; } break; // PCALL
      case 0x6F: { const l = this.pop(); this.pc = l | (this.pop() << 8); } break; // RET
      case 0x7F: { this.setPsw(this.pop()); const l = this.pop(); this.pc = l | (this.pop() << 8); } break; // RETI
      case 0x0F: { this.push(this.pc >> 8); this.push(this.pc & 0xFF); this.push(this.psw()); this.pc = this.rd(0xFFDE) | (this.rd(0xFFDF) << 8); this.i = 0; } break; // BRK
      case 0x5F: this.pc = this.f16(); break;
      case 0x1F: { const a = (this.f16() + this.x) & 0xFFFF; this.pc = this.rd(a) | (this.rd((a + 1) & 0xFFFF) << 8); } break;
      /* MOV registrador <-> registrador */
      case 0x7D: this.a = this.x * 0 + this.x; this.nz(this.a); break; // MOV A,X
      case 0xDD: this.a = this.y; this.nz(this.a); break; // MOV A,Y
      case 0x5D: this.x = this.a; this.nz(this.x); break; // MOV X,A
      case 0xFD: this.y = this.a; this.nz(this.y); break; // MOV Y,A
      case 0x9D: this.x = this.sp; this.nz(this.x); break; // MOV X,SP
      case 0xBD: this.sp = this.x; break; // MOV SP,X
      /* MOV imediato */
      case 0xE8: this.a = this.f8(); this.nz(this.a); break;
      case 0xCD: this.x = this.f8(); this.nz(this.x); break;
      case 0x8D: this.y = this.f8(); this.nz(this.y); break;
      /* MOV carga */
      case 0xE4: this.a = this.rd(this.dpa(this.f8())); this.nz(this.a); break;
      case 0xF4: this.a = this.rd(this.dpa((this.f8() + this.x) & 0xFF)); this.nz(this.a); break;
      case 0xE5: this.a = this.rd(this.f16()); this.nz(this.a); break;
      case 0xF5: this.a = this.rd((this.f16() + this.x) & 0xFFFF); this.nz(this.a); break;
      case 0xF6: this.a = this.rd((this.f16() + this.y) & 0xFFFF); this.nz(this.a); break;
      case 0xE6: this.a = this.rd(this.dpa(this.x)); this.nz(this.a); break;
      case 0xBF: this.a = this.rd(this.dpa(this.x)); this.x = (this.x + 1) & 0xFF; this.nz(this.a); break;
      case 0xE7: { const d = (this.f8() + this.x) & 0xFF; this.a = this.rd(this.rd(this.dpa(d)) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8)); this.nz(this.a); } break;
      case 0xF7: { const d = this.f8(); this.a = this.rd(((this.rd(this.dpa(d)) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8)) + this.y) & 0xFFFF); this.nz(this.a); } break;
      case 0xF8: this.x = this.rd(this.dpa(this.f8())); this.nz(this.x); break;
      case 0xF9: this.x = this.rd(this.dpa((this.f8() + this.y) & 0xFF)); this.nz(this.x); break;
      case 0xE9: this.x = this.rd(this.f16()); this.nz(this.x); break;
      case 0xEB: this.y = this.rd(this.dpa(this.f8())); this.nz(this.y); break;
      case 0xFB: this.y = this.rd(this.dpa((this.f8() + this.x) & 0xFF)); this.nz(this.y); break;
      case 0xEC: this.y = this.rd(this.f16()); this.nz(this.y); break;
      /* MOV guarda */
      case 0xC4: this.wr(this.dpa(this.f8()), this.a); break;
      case 0xD4: this.wr(this.dpa((this.f8() + this.x) & 0xFF), this.a); break;
      case 0xC5: this.wr(this.f16(), this.a); break;
      case 0xD5: this.wr((this.f16() + this.x) & 0xFFFF, this.a); break;
      case 0xD6: this.wr((this.f16() + this.y) & 0xFFFF, this.a); break;
      case 0xC6: this.wr(this.dpa(this.x), this.a); break;
      case 0xAF: this.wr(this.dpa(this.x), this.a); this.x = (this.x + 1) & 0xFF; break;
      case 0xC7: { const d = (this.f8() + this.x) & 0xFF; this.wr(this.rd(this.dpa(d)) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8), this.a); } break;
      case 0xD7: { const d = this.f8(); this.wr(((this.rd(this.dpa(d)) | (this.rd(this.dpa((d + 1) & 0xFF)) << 8)) + this.y) & 0xFFFF, this.a); } break;
      case 0xD8: this.wr(this.dpa(this.f8()), this.x); break;
      case 0xD9: this.wr(this.dpa((this.f8() + this.y) & 0xFF), this.x); break;
      case 0xC9: this.wr(this.f16(), this.x); break;
      case 0xCB: this.wr(this.dpa(this.f8()), this.y); break;
      case 0xDB: this.wr(this.dpa((this.f8() + this.x) & 0xFF), this.y); break;
      case 0xCC: this.wr(this.f16(), this.y); break;
      case 0x8F: { const v = this.f8(); this.wr(this.dpa(this.f8()), v); } break; // MOV d,#i
      case 0xFA: { const s = this.rd(this.dpa(this.f8())); this.wr(this.dpa(this.f8()), s); } break; // MOV dd,ds
      /* CMP X / Y */
      case 0xC8: this.alu(3, this.x, this.f8()); break;
      case 0x3E: this.alu(3, this.x, this.rd(this.dpa(this.f8()))); break;
      case 0x1E: this.alu(3, this.x, this.rd(this.f16())); break;
      case 0xAD: this.alu(3, this.y, this.f8()); break;
      case 0x7E: this.alu(3, this.y, this.rd(this.dpa(this.f8()))); break;
      case 0x5E: this.alu(3, this.y, this.rd(this.f16())); break;
      /* INC / DEC / deslocamentos */
      case 0xBC: this.a = (this.a + 1) & 0xFF; this.nz(this.a); break; case 0x3D: this.x = (this.x + 1) & 0xFF; this.nz(this.x); break; case 0xFC: this.y = (this.y + 1) & 0xFF; this.nz(this.y); break;
      case 0x9C: this.a = (this.a - 1) & 0xFF; this.nz(this.a); break; case 0x1D: this.x = (this.x - 1) & 0xFF; this.nz(this.x); break; case 0xDC: this.y = (this.y - 1) & 0xFF; this.nz(this.y); break;
      case 0xAB: { const a = this.dpa(this.f8()), v = (this.rd(a) + 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0xBB: { const a = this.dpa((this.f8() + this.x) & 0xFF), v = (this.rd(a) + 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0xAC: { const a = this.f16(), v = (this.rd(a) + 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0x8B: { const a = this.dpa(this.f8()), v = (this.rd(a) - 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0x9B: { const a = this.dpa((this.f8() + this.x) & 0xFF), v = (this.rd(a) - 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0x8C: { const a = this.f16(), v = (this.rd(a) - 1) & 0xFF; this.wr(a, v); this.nz(v); } break;
      case 0x1C: this.a = this.shl(this.a, 0); break; case 0x3C: this.a = this.shl(this.a, 1); break; case 0x5C: this.a = this.shl(this.a, 2); break; case 0x7C: this.a = this.shl(this.a, 3); break;
      case 0x0B: case 0x2B: case 0x4B: case 0x6B: { const a = this.dpa(this.f8()); this.wr(a, this.shl(this.rd(a), (op >> 5))); } break;
      case 0x1B: case 0x3B: case 0x5B: case 0x7B: { const a = this.dpa((this.f8() + this.x) & 0xFF); this.wr(a, this.shl(this.rd(a), (op >> 5))); } break;
      case 0x0C: case 0x2C: case 0x4C: case 0x6C: { const a = this.f16(); this.wr(a, this.shl(this.rd(a), (op >> 5))); } break;
      case 0x9F: this.a = ((this.a << 4) | (this.a >> 4)) & 0xFF; this.nz(this.a); break; // XCN
      /* 16 bits */
      case 0xBA: { const a = this.dpa(this.f8()), l = this.rd(a), h = this.rd(this.dpa((a + 1) & 0xFF)); this.a = l; this.y = h; this.n = (h >> 7) & 1; this.z = (l | h) === 0 ? 1 : 0; } break; // MOVW YA,d
      case 0xDA: { const o = this.f8(), a = this.dpa(o); this.wr(a, this.a); this.wr(this.dpa((o + 1) & 0xFF), this.y); } break; // MOVW d,YA
      case 0x3A: case 0x1A: { // INCW / DECW
        const o = this.f8(), a = this.dpa(o), a2 = this.dpa((o + 1) & 0xFF); let w = this.rd(a) | (this.rd(a2) << 8); w = (w + (op === 0x3A ? 1 : -1)) & 0xFFFF;
        this.wr(a, w & 0xFF); this.wr(a2, w >> 8); this.n = (w >> 15) & 1; this.z = w === 0 ? 1 : 0;
      } break;
      case 0x7A: case 0x9A: { // ADDW / SUBW
        const o = this.f8(), a = this.dpa(o), w = this.rd(a) | (this.rd(this.dpa((o + 1) & 0xFF)) << 8), ya = this.a | (this.y << 8); let r;
        if (op === 0x7A) { r = ya + w; this.v = (~(ya ^ w) & (ya ^ r) & 0x8000) ? 1 : 0; this.h = (((ya & 0xFFF) + (w & 0xFFF)) > 0xFFF) ? 1 : 0; this.c = r > 0xFFFF ? 1 : 0; }
        else { r = ya - w; this.v = ((ya ^ w) & (ya ^ r) & 0x8000) ? 1 : 0; this.h = (((ya & 0xFFF) - (w & 0xFFF)) >= 0) ? 1 : 0; this.c = r >= 0 ? 1 : 0; }
        r &= 0xFFFF; this.a = r & 0xFF; this.y = r >> 8; this.n = (r >> 15) & 1; this.z = r === 0 ? 1 : 0;
      } break;
      case 0x5A: { // CMPW YA,d
        const o = this.f8(), a = this.dpa(o), w = this.rd(a) | (this.rd(this.dpa((o + 1) & 0xFF)) << 8), ya = this.a | (this.y << 8), r = ya - w;
        this.c = ya >= w ? 1 : 0; this.n = (r >> 15) & 1; this.z = (r & 0xFFFF) === 0 ? 1 : 0;
      } break;
      case 0xCF: { const r = this.y * this.a; this.a = r & 0xFF; this.y = (r >> 8) & 0xFF; this.n = (this.y >> 7) & 1; this.z = this.y === 0 ? 1 : 0; } break; // MUL
      case 0x9E: { // DIV YA,X
        const ya = this.a | (this.y << 8); this.v = this.y >= this.x ? 1 : 0; this.h = (this.y & 15) >= (this.x & 15) ? 1 : 0;
        if (this.y < (this.x << 1)) { this.a = this.x ? Math.floor(ya / this.x) & 0xFF : 0xFF; this.y = this.x ? ya % this.x : this.a; }
        else { const d = ya - (this.x << 9), q = this.x ? (255 - Math.floor(d / (256 - this.x))) : 0; this.a = q & 0xFF; this.y = (this.x + (this.x ? d % (256 - this.x) : 0)) & 0xFF; }
        this.nz(this.a);
      } break;
      case 0xDF: { // DAA
        if (this.c || this.a > 0x99) { this.a += 0x60; this.c = 1; }
        if (this.h || (this.a & 15) > 9) this.a += 6; this.a &= 0xFF; this.nz(this.a);
      } break;
      case 0xBE: { // DAS
        if (!this.c || this.a > 0x99) { this.a -= 0x60; this.c = 0; }
        if (!this.h || (this.a & 15) > 9) this.a -= 6; this.a &= 0xFF; this.nz(this.a);
      } break;
      /* bits e operações com carry */
      case 0x0E: case 0x4E: { const a = this.f16(), v = this.rd(a); this.nz((this.a - v) & 0xFF); this.wr(a, op === 0x0E ? (v | this.a) : (v & ~this.a)); } break; // TSET1 / TCLR1
      case 0x0A: case 0x2A: case 0x4A: case 0x6A: case 0x8A: case 0xAA: case 0xCA: case 0xEA: { // m.b
        const w = this.f16(), a = w & 0x1FFF, b = w >> 13, v = (this.rd(a) >> b) & 1;
        switch (op) {
          case 0x0A: this.c |= v; break; case 0x2A: this.c |= v ^ 1; break; case 0x4A: this.c &= v; break; case 0x6A: this.c &= v ^ 1; break;
          case 0x8A: this.c ^= v; break; case 0xAA: this.c = v; break;
          case 0xCA: { const m = this.rd(a); this.wr(a, this.c ? (m | (1 << b)) : (m & ~(1 << b))); } break;
          default: this.wr(a, this.rd(a) ^ (1 << b)); // NOT1
        }
      } break;
      default: break;
    }
    return SPC_CYC[op] + extra;
  }
  shl(v, k) { // 0 ASL, 1 ROL, 2 LSR, 3 ROR
    let r, c;
    switch (k) {
      case 0: c = v >> 7; r = (v << 1) & 0xFF; break;
      case 1: c = v >> 7; r = ((v << 1) | this.c) & 0xFF; break;
      case 2: c = v & 1; r = v >> 1; break;
      default: c = v & 1; r = (v >> 1) | (this.c << 7); break;
    }
    this.c = c; this.nz(r); return r;
  }
  /* ---------- DSP ---------- */
  decodeBlock(v) {
    const ram = this.ram, addr = this.vAddr[v], hdr = ram[addr], shift = hdr >> 4, filt = (hdr >> 2) & 3;
    let p1 = this.vP1[v], p2 = this.vP2[v];
    for (let i = 0; i < 16; i++) {
      let nib = ram[(addr + 1 + (i >> 1)) & 0xFFFF]; nib = (i & 1) ? (nib & 15) : (nib >> 4); if (nib > 7) nib -= 16;
      let s = shift <= 12 ? (nib << shift) >> 1 : (nib < 0 ? -2048 : 0);
      if (filt === 1) s += p1 + ((-p1) >> 4);
      else if (filt === 2) s += (p1 << 1) + ((-(p1 * 3)) >> 5) - p2 + (p2 >> 4);
      else if (filt === 3) s += (p1 << 1) + ((-(p1 * 13)) >> 6) - p2 + ((p2 * 3) >> 4);
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      this.vBlk[v * 16 + i] = s; p2 = p1; p1 = s;
    }
    this.vP1[v] = p1; this.vP2[v] = p2;
  }
  advanceSample(v) {
    // empurra a próxima amostra decodificada para o histórico
    const i = this.vIdx[v], h = v * 4;
    this.vHist[h] = this.vHist[h + 1]; this.vHist[h + 1] = this.vHist[h + 2]; this.vHist[h + 2] = this.vHist[h + 3];
    this.vHist[h + 3] = this.vBlk[v * 16 + i];
    if (i === 15) {
      const hdr = this.ram[this.vAddr[v]];
      if (hdr & 1) { // fim do bloco
        this.endx |= 1 << v;
        if (hdr & 2) this.vAddr[v] = this.loopAddr(v);
        else { this.vMode[v] = 0; this.vEnv[v] = 0; this.vAddr[v] = (this.vAddr[v] + 9) & 0xFFFF; this.decodeBlock(v); this.vIdx[v] = 0; return; }
      } else this.vAddr[v] = (this.vAddr[v] + 9) & 0xFFFF;
      this.decodeBlock(v); this.vIdx[v] = 0;
    } else this.vIdx[v] = i + 1;
  }
  loopAddr(v) { const d = this.dsp[0x5D] << 8, e = d + (this.dsp[v * 16 + 4] << 2) + 2; return this.ram[e & 0xFFFF] | (this.ram[(e + 1) & 0xFFFF] << 8); }
  rateHit(rate) { return rate !== 0 && (this.sampleCount % SPC_RATE[rate]) === 0; }
  dspSample() {
    const d = this.dsp, ram = this.ram;
    this.sampleCount = (this.sampleCount + 1) | 0;
    const flg = d[0x6C];
    if (flg & 0x80) { for (let v = 0; v < 8; v++) { this.vMode[v] = 0; this.vEnv[v] = 0; } }
    // ruído
    if (this.rateHit(flg & 31)) { const bit = (this.noise ^ (this.noise >> 1)) & 1; this.noise = (this.noise >> 1) | (bit << 14); }
    let mixL = 0, mixR = 0, echoL = 0, echoR = 0, prevOut = 0;
    const dirBase = d[0x5D] << 8;
    for (let v = 0; v < 8; v++) {
      const r = v * 16, bit = 1 << v;
      if (this.kon & bit) {
        const sa = (dirBase + (d[r + 4] << 2)) & 0xFFFF;
        this.vAddr[v] = ram[sa] | (ram[(sa + 1) & 0xFFFF] << 8); this.vIdx[v] = 0; this.vFrac[v] = 0; this.vP1[v] = 0; this.vP2[v] = 0;
        this.vHist.fill(0, v * 4, v * 4 + 4); this.decodeBlock(v);
        this.vEnv[v] = 0; this.vMode[v] = 1; this.endx &= ~bit; this.kon &= ~bit;
      }
      if (this.koff & bit && this.vMode[v] !== 0) this.vMode[v] = 4;
      if (flg & 0x80) this.vMode[v] = 0;
      let out = 0;
      if (this.vMode[v] !== 0) {
        // envelope
        let env = this.vEnv[v];
        if (this.vMode[v] === 4) { env -= 8; if (env <= 0) { env = 0; this.vMode[v] = 0; } }
        else if (d[r + 5] & 0x80) {
          const adsr2 = d[r + 6];
          switch (this.vMode[v]) {
            case 1: { const rate = ((d[r + 5] & 15) << 1) + 1; if (this.rateHit(rate)) { env += rate === 31 ? 1024 : 32; if (env >= 0x7E0) this.vMode[v] = 2; if (env > 0x7FF) env = 0x7FF; } } break;
            case 2: { const rate = (((d[r + 5] >> 4) & 7) << 1) + 16; if (this.rateHit(rate)) env -= ((env - 1) >> 8) + 1; if ((env >> 8) <= (adsr2 >> 5)) this.vMode[v] = 3; } break;
            default: { const rate = adsr2 & 31; if (this.rateHit(rate)) env -= ((env - 1) >> 8) + 1; }
          }
          if (env < 0) env = 0;
        } else {
          const g = d[r + 7];
          if (!(g & 0x80)) env = (g & 0x7F) << 4;
          else {
            const rate = g & 31, md = (g >> 5) & 3;
            if (this.rateHit(rate)) {
              if (md === 0) env -= 32; else if (md === 1) env -= ((env - 1) >> 8) + 1; else if (md === 2) env += 32; else env += env < 0x600 ? 32 : 8;
              if (env < 0) env = 0; if (env > 0x7FF) env = 0x7FF;
            }
          }
          if (this.vMode[v] === 1) this.vMode[v] = 3;
        }
        this.vEnv[v] = env;
        // pitch
        let pitch = d[r + 2] | ((d[r + 3] & 0x3F) << 8);
        if ((d[0x2D] & bit) && v > 0) pitch = (pitch + (((pitch >> 5) * (prevOut >> 4)) >> 6)) & 0x3FFF;
        let f = this.vFrac[v] + pitch;
        while (f >= 0x1000) { f -= 0x1000; this.advanceSample(v); if (this.vMode[v] === 0) break; }
        this.vFrac[v] = f;
        // interpolação cúbica (Catmull-Rom) entre as duas amostras do meio
        const h = v * 4, a0 = this.vHist[h], b0 = this.vHist[h + 1], c0 = this.vHist[h + 2], d0 = this.vHist[h + 3], t = f / 4096;
        let s = b0 + 0.5 * t * (c0 - a0 + t * (2 * a0 - 5 * b0 + 4 * c0 - d0 + t * (3 * (b0 - c0) + d0 - a0)));
        if (d[0x3D] & bit) s = (this.noise << 1) << 16 >> 16;
        if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
        out = ((s * this.vEnv[v]) >> 11) | 0;
      }
      this.vOut[v] = out; prevOut = out;
      d[r + 8] = (this.vEnv[v] >> 4) & 0x7F; d[r + 9] = (out >> 8) & 0xFF;
      const vl = (d[r] << 24) >> 24, vr = (d[r + 1] << 24) >> 24;
      const l = (out * vl) >> 7, rr = (out * vr) >> 7;
      mixL += l; mixR += rr;
      if (d[0x4D] & bit) { echoL += l; echoR += rr; }
    }
    this.koff = 0; d[0x7C] = this.endx;
    // eco
    const edl = d[0x7D] & 15, elen = edl ? edl * 2048 : 4, ebase = (d[0x6D] << 8);
    const ea = (ebase + this.echoPos) & 0xFFFF;
    const eL = (ram[ea] | (ram[(ea + 1) & 0xFFFF] << 8)) << 16 >> 16, eR = (ram[(ea + 2) & 0xFFFF] | (ram[(ea + 3) & 0xFFFF] << 8)) << 16 >> 16;
    const H = this.echoHist, hi = this.echoIdx;
    H[hi * 2] = eL >> 1; H[hi * 2 + 1] = eR >> 1;
    let fL = 0, fR = 0;
    for (let k = 0; k < 8; k++) {
      const idx = (hi - 7 + k) & 7, co = (d[k * 16 + 0x0F] << 24) >> 24;
      fL += H[idx * 2] * co; fR += H[idx * 2 + 1] * co;
    }
    fL >>= 6; fR >>= 6;
    if (fL > 32767) fL = 32767; else if (fL < -32768) fL = -32768;
    if (fR > 32767) fR = 32767; else if (fR < -32768) fR = -32768;
    this.echoIdx = (hi + 1) & 7;
    if (!(flg & 0x20)) {
      const efb = (d[0x0D] << 24) >> 24;
      let wl = echoL + ((fL * efb) >> 7), wr = echoR + ((fR * efb) >> 7);
      if (wl > 32767) wl = 32767; else if (wl < -32768) wl = -32768; if (wr > 32767) wr = 32767; else if (wr < -32768) wr = -32768;
      ram[ea] = wl & 0xFF; ram[(ea + 1) & 0xFFFF] = (wl >> 8) & 0xFF; ram[(ea + 2) & 0xFFFF] = wr & 0xFF; ram[(ea + 3) & 0xFFFF] = (wr >> 8) & 0xFF;
    }
    this.echoPos += 4; if (this.echoPos >= elen) this.echoPos = 0;
    const mvl = (d[0x0C] << 24) >> 24, mvr = (d[0x1C] << 24) >> 24, evl = (d[0x2C] << 24) >> 24, evr = (d[0x3C] << 24) >> 24;
    let L = ((mixL * mvl) >> 7) + ((fL * evl) >> 7), R = ((mixR * mvr) >> 7) + ((fR * evr) >> 7);
    if (flg & 0x40) { L = 0; R = 0; }
    if (L > 32767) L = 32767; else if (L < -32768) L = -32768; if (R > 32767) R = 32767; else if (R < -32768) R = -32768;
    // mono para o hub
    if (this.wp - this.rpf >= 60000) this.rpf = this.wp - 30000; // estouro: descarta
    this.sampleBuf[this.wp & 0xFFFF] = ((L + R) / 65536) * this.volume; this.wp++;
  }
  /* ---------- saída de áudio ---------- */
  setSampleRate(sr) { this.step = 32000 / sr; }
  buffered() { return Math.max(0, Math.floor((this.wp - this.rpf) / this.step)); }
  fill(out) {
    const buf = this.sampleBuf;
    for (let i = 0; i < out.length; i++) {
      const p = this.rpf, ip = Math.floor(p);
      if (ip + 1 < this.wp) { const f = p - ip; this.last = buf[ip & 0xFFFF] * (1 - f) + buf[(ip + 1) & 0xFFFF] * f; this.rpf = p + this.step; }
      else this.last = (this.last || 0) * 0.995;
      out[i] = this.last;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { SNESAPU };
