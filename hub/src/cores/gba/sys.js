'use strict';
/* Sistema do GBA: registradores de IO, interrupções, timers, DMA, teclas e o relógio por scanline.
 * Um quadro = 228 linhas x 1232 ciclos (960 de desenho + 272 de HBlank) = 280896 ciclos. */

class GBASystem {
  constructor(frame) {
    this.bus = new GBABus();
    this.cpu = new ARM7(this.bus);
    this.ppu = new GBAPPU(this.bus, frame);
    this.timers = [0, 1, 2, 3].map(() => ({ counter: 0, reload: 0, on: false, cascade: false, irq: false, div: 1, acc: 0 }));
    this.dma = [0, 1, 2, 3].map(() => ({ src: 0, dst: 0, count: 0 }));
    this.dmaOn = [false, false, false, false];
    this.timersOn = false; this.tAcc = 0; this.tNext = 0x7FFFFFFF; this.line = 0; this.hblank = false; this.carry = 0; this.frameDone = false;
    this.skipVideo = false; this.keys = 0x3FF; this.keyHeld = false; this.intrWaiting = false;
    this.apu = new GBAAPU(this);
    this.installBios();
    const bus = this.bus;
    bus.ioRead16 = off => this.ioRead(off);
    bus.ioWrite16 = (off, v) => this.ioWrite(off, v);
    bus.ioWrite8 = (off, v) => this.ioWrite8(off, v);
    this.cpu.swiHook = (n, pc) => gbaSwi(this, n, pc);
    this.reset();
  }

  /* Vetor de IRQ da BIOS real: salva registradores, chama o handler do jogo em [0x03007FFC] e retorna. */
  installBios() {
    const b = this.bus.bios.u32;
    b[6] = 0xEA000042;              // 0x18: b 0x128
    b[0x128 >> 2] = 0xE92D500F;     // stmfd sp!, {r0-r3, r12, lr}
    b[(0x128 >> 2) + 1] = 0xE3A00301; // mov r0, #0x04000000
    b[(0x128 >> 2) + 2] = 0xE28FE000; // add lr, pc, #0
    b[(0x128 >> 2) + 3] = 0xE510F004; // ldr pc, [r0, #-4]
    b[(0x128 >> 2) + 4] = 0xE8BD500F; // ldmfd sp!, {r0-r3, r12, lr}
    b[(0x128 >> 2) + 5] = 0xE25EF004; // subs pc, lr, #4
  }

  reset() {
    const b = this.bus;
    b.ewram.u8.fill(0); b.iwram.u8.fill(0); b.pal.u8.fill(0); b.vram.u8.fill(0); b.oam.u8.fill(0); b.io.u8.fill(0);
    b.io.u16[0] = 0x80; b.io.u16[0x88 >> 1] = 0x200;
    for (const o of [0x20, 0x26, 0x30, 0x36]) b.io.u16[o >> 1] = 0x100; // PA/PD dos BGs afins começam em 1.0
    for (const t of this.timers) { t.counter = 0; t.reload = 0; t.on = false; t.cascade = false; t.irq = false; t.div = 1; t.acc = 0; }
    this.dmaOn.fill(false); this.timersOn = false; this.tAcc = 0; this.tNext = 0x7FFFFFFF; this.apu.reset();
    Object.assign(b.fl, { state: 0, id: false, erase: false, prog: false, bankSw: false }); b.ee.bits = 0; b.ee.outPos = 68;
    this.line = 0; this.hblank = false; this.carry = 0; this.frameDone = false; this.intrWaiting = false; this.keyHeld = false;
    this.cpu.reset(true);
    this.ppu.latchRef(0); this.ppu.latchRef(1);
  }
  /* BIOS opcional fornecida pelo usuário (16 KB). Nunca vem embutida no projeto. */
  loadBios(u8) {
    this.bus.bios.u8.set(u8.subarray(0, 0x4000));
    this.cpu.swiHook = null; this.userBios = true;
    this.reset();
  }
  softReset() {
    const flag = this.bus.iwram.u8[0x7FFA];
    this.bus.iwram.u8.fill(0, 0x7E00);
    this.cpu.reset(true);
    this.cpu.r[15] = flag ? 0x02000000 : 0x08000000; this.cpu.pcWritten = true;
  }

  /* ---------- interrupções ---------- */
  raise(bit) { this.bus.io.u16[0x101] |= bit; this.updateIrq(); }
  updateIrq() {
    const io = this.bus.io.u16, pend = io[0x100] & io[0x101] & 0x3FFF;
    this.cpu.irqPending = (io[0x104] & 1) !== 0 && pend !== 0;
    if (pend && this.cpu.halted) this.cpu.halted = false;
  }

  /* ---------- registradores ---------- */
  ioRead(off) {
    const io = this.bus.io.u16;
    switch (off) {
      case 0x004: {
        let v = io[2] & 0xFF38; const vc = this.line;
        if (vc >= 160 && vc !== 227) v |= 1;
        if (this.hblank) v |= 2;
        if (vc === (v >> 8)) v |= 4;
        return v;
      }
      case 0x006: return this.line;
      case 0x100: case 0x104: case 0x108: case 0x10C: if (this.tAcc) this.timerFlush(); return this.timers[(off - 0x100) >> 2].counter;
      case 0x130: return this.keys;
      case 0x84: return this.apu.read(0x84);
      default:
        if (off >= 0x90 && off < 0xA0) return this.apu.read(off);
        return io[off >> 1];
    }
  }
  ioWrite8(off, v) {
    if (off >= 0xA0 && off < 0xA8) { this.apu.pushFifo((off >> 2) & 1, v & 255); return; }
    if (off === 0x301) { this.cpu.halted = true; return; }
    if (off === 0x202 || off === 0x203) { this.ioWrite(0x202, v << ((off & 1) << 3)); return; }
    const a = off & ~1, cur = this.bus.io.u16[a >> 1];
    this.ioWrite(a, (off & 1) ? ((cur & 0xFF) | (v << 8)) : ((cur & 0xFF00) | v));
  }
  ioWrite(off, v) {
    const io = this.bus.io.u16;
    if (off >= 0xB0 && off < 0xE0) {
      io[off >> 1] = v;
      const rel = off - 0xB0;
      if (rel % 12 === 10) this.dmaCtl((rel / 12) | 0, v);
      return;
    }
    if (off >= 0x100 && off < 0x110) {
      io[off >> 1] = v;
      const i = (off - 0x100) >> 2;
      if (off & 2) this.timerCtl(i, v); else this.timers[i].reload = v;
      return;
    }
    if (off >= 0x28 && off <= 0x2E) { io[off >> 1] = v; this.ppu.latchRef(0); return; }
    if (off >= 0x38 && off <= 0x3E) { io[off >> 1] = v; this.ppu.latchRef(1); return; }
    if (off >= 0x60 && off < 0xA8) {
      if (off >= 0xA0) { const f = (off >> 2) & 1; this.apu.pushFifo(f, v & 255); this.apu.pushFifo(f, (v >> 8) & 255); return; }
      let st = v;
      if (off === 0x64 || off === 0x6C || off === 0x74) st = v & 0x47FF;
      else if (off === 0x7C) st = v & 0x40FF;
      else if (off === 0x82) st = v & 0x770F;
      else if (off === 0x84) st = v & 0x80;
      io[off >> 1] = st;
      this.apu.write(off, v);
      return;
    }
    switch (off) {
      case 0x004: io[2] = v & 0xFF38; return;
      case 0x006: return;
      case 0x200: io[0x100] = v; this.updateIrq(); return;
      case 0x202: io[0x101] &= ~v; this.updateIrq(); return;
      case 0x208: io[0x104] = v & 1; this.updateIrq(); return;
      case 0x132: io[0x99] = v; return;
      case 0x300: this.cpu.halted = true; return;
      default: io[off >> 1] = v;
    }
  }

  /* ---------- teclas ---------- */
  setButtons(m) {
    const pressed = (m & 1) | ((m >> 1) & 1) << 1 | ((m >> 2) & 1) << 2 | ((m >> 3) & 1) << 3 |
      ((m >> 7) & 1) << 4 | ((m >> 6) & 1) << 5 | ((m >> 4) & 1) << 6 | ((m >> 5) & 1) << 7 |
      ((m >> 11) & 1) << 8 | ((m >> 10) & 1) << 9;
    this.keys = (~pressed) & 0x3FF;
    const kc = this.bus.io.u16[0x99];
    if (kc & 0x4000) {
      const mask = kc & 0x3FF, cond = mask && ((kc & 0x8000) ? (pressed & mask) === mask : (pressed & mask) !== 0);
      if (cond && !this.keyHeld) this.raise(0x1000);
      this.keyHeld = !!cond;
    }
  }

  /* ---------- timers ---------- */
  timerCtl(i, v) {
    if (this.tAcc) this.timerFlush(); // aplica o tempo pendente com a configuração antiga
    const t = this.timers[i], was = t.on;
    t.on = (v & 0x80) !== 0; t.cascade = (v & 4) !== 0 && i > 0; t.irq = (v & 0x40) !== 0; t.div = [1, 64, 256, 1024][v & 3];
    if (!was && t.on) { t.counter = t.reload; t.acc = 0; }
    this.timersOn = this.timers[0].on || this.timers[1].on || this.timers[2].on || this.timers[3].on;
    this.timerSchedule();
  }
  /* Os timers só são avançados quando algo pode mudar: estouro, leitura ou escrita dos registradores. */
  timerSchedule() {
    let n = 0x7FFFFFFF;
    for (let i = 0; i < 4; i++) { const t = this.timers[i]; if (t.on && !t.cascade) { const need = (0x10000 - t.counter) * t.div - t.acc; if (need < n) n = need; } }
    this.tNext = n;
  }
  timerStep(c) { this.tAcc += c; if (this.tAcc >= this.tNext) this.timerFlush(); }
  timerFlush() { const c = this.tAcc; this.tAcc = 0; if (c) this.timerTick(c); this.timerSchedule(); }
  timerTick(c) {
    for (let i = 0; i < 4; i++) {
      const t = this.timers[i];
      if (!t.on || t.cascade) continue;
      t.acc += c;
      if (t.acc >= t.div) { const inc = (t.acc / t.div) | 0; t.acc -= inc * t.div; this.timerAdd(i, inc); }
    }
  }
  timerAdd(i, inc) {
    const t = this.timers[i];
    let cn = t.counter + inc, ov = 0;
    while (cn > 0xFFFF) { ov++; cn = cn - 0x10000 + t.reload; }
    t.counter = cn;
    if (ov) {
      if (i < 2) this.apu.timerOverflow(i, ov);
      if (t.irq) this.raise(1 << (3 + i));
      const nx = this.timers[i + 1];
      if (nx && nx.on && nx.cascade) this.timerAdd(i + 1, ov);
    }
  }

  /* ---------- DMA ---------- */
  dmaCount(ch) {
    let n = this.bus.io.u16[(0xB8 + ch * 12) >> 1];
    if (ch !== 3) n &= 0x3FFF;
    return n === 0 ? (ch === 3 ? 0x10000 : 0x4000) : n;
  }
  dmaCtl(ch, v) {
    const was = this.dmaOn[ch], on = (v & 0x8000) !== 0;
    this.dmaOn[ch] = on;
    if (!on || was) return;
    const u32 = this.bus.io.u32, base = (0xB0 + ch * 12) >> 2, d = this.dma[ch];
    d.src = (u32[base] & (ch === 0 ? 0x07FFFFFF : 0x0FFFFFFF)) >>> 0;
    d.dst = (u32[base + 1] & (ch === 3 ? 0x0FFFFFFF : 0x07FFFFFF)) >>> 0;
    d.count = this.dmaCount(ch);
    if (ch === 3 && (d.dst >>> 24) === 13) this.bus.eeDetect(d.count);
    if (((v >> 12) & 3) === 0) this.dmaRun(ch);
  }
  dmaRun(ch) {
    const d = this.dma[ch], bus = this.bus, io16 = bus.io.u16, ci = (0xBA + ch * 12) >> 1, ctl = io16[ci];
    const word = (ctl & 0x400) !== 0, step = word ? 4 : 2, sc = (ctl >> 7) & 3, dc = (ctl >> 5) & 3;
    const si = sc === 1 ? -step : sc === 2 ? 0 : step, di = dc === 1 ? -step : dc === 2 ? 0 : step;
    let src = d.src, dst = d.dst;
    if (word) { src &= ~3; dst &= ~3; for (let i = d.count; i > 0; i--) { bus.write32(dst, bus.read32(src)); src += si; dst += di; } }
    else { src &= ~1; dst &= ~1; for (let i = d.count; i > 0; i--) { bus.write16(dst, bus.read16(src)); src += si; dst += di; } }
    d.src = src >>> 0; d.dst = dst >>> 0;
    const timing = (ctl >> 12) & 3;
    if ((ctl & 0x200) && timing !== 0) {
      d.count = this.dmaCount(ch);
      if (dc === 3) d.dst = (bus.io.u32[(0xB0 + ch * 12 + 4) >> 2] & (ch === 3 ? 0x0FFFFFFF : 0x07FFFFFF)) >>> 0;
    } else { io16[ci] = ctl & ~0x8000; this.dmaOn[ch] = false; }
    if (ctl & 0x4000) this.raise(0x100 << ch);
  }
  dmaFifo(i) {
    const dstAddr = 0x040000A0 + i * 4;
    for (let ch = 1; ch <= 2; ch++) {
      const d = this.dma[ch], ctl = this.bus.io.u16[(0xBA + ch * 12) >> 1];
      if (!this.dmaOn[ch] || ((ctl >> 12) & 3) !== 3 || d.dst !== dstAddr) continue;
      const sc = (ctl >> 7) & 3, si = sc === 1 ? -4 : sc === 2 ? 0 : 4;
      let src = d.src & ~3;
      for (let k = 0; k < 4; k++) { this.bus.write32(dstAddr, this.bus.read32(src)); src += si; }
      d.src = src >>> 0;
      if (ctl & 0x4000) this.raise(0x100 << ch);
      return;
    }
  }
  dmaTrigger(timing) {
    const io16 = this.bus.io.u16;
    let any = false;
    for (let ch = 0; ch < 4; ch++) {
      if (this.dmaOn[ch] && ((io16[(0xBA + ch * 12) >> 1] >> 12) & 3) === timing) {
        if (!any) { this.bus.cycles = 0; any = true; }
        this.dmaRun(ch);
      }
    }
    if (any) { this.apu.run(this.bus.cycles); if (this.timersOn) this.timerStep(this.bus.cycles); }
  }

  /* ---------- relógio ---------- */
  runSegment(n) {
    const cpu = this.cpu;
    let left = n - this.carry; this.carry = 0;
    const start = left;
    while (left > 0) {
      if (cpu.halted) {
        const c = left < 16 ? left : 16;
        if (this.timersOn) this.timerStep(c);
        left -= c; this.updateIrq();
        continue;
      }
      const c = cpu.step();
      if (this.timersOn) this.timerStep(c);
      left -= c;
    }
    this.apu.run(start - left); // som em lote por segmento (até 1232 ciclos), não por instrução
    this.carry = -left;
  }
  runFrame() {
    this.frameDone = false;
    while (!this.frameDone) {
      this.runSegment(960);
      this.beginHblank();
      this.runSegment(272);
      this.endLine();
    }
  }
  beginHblank() {
    const line = this.line;
    if (line < 160 && !this.skipVideo) { this.ppu.renderLine(line); this.ppu.advanceRefs(); }
    this.hblank = true;
    if (this.bus.io.u16[2] & 0x10) this.raise(2);
    if (line < 160) this.dmaTrigger(2);
  }
  endLine() {
    this.hblank = false;
    this.line = this.line === 227 ? 0 : this.line + 1;
    if (this.line === 0) { this.ppu.latchRef(0); this.ppu.latchRef(1); }
    const ds = this.bus.io.u16[2];
    if (this.line === ((ds >> 8) & 0xFF) && (ds & 0x20)) this.raise(4);
    if (this.line === 160) {
      if (ds & 8) this.raise(1);
      this.dmaTrigger(1);
      this.frameDone = true;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GBASystem };
