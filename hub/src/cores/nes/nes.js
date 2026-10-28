'use strict';
/* Sistema NES: junta cartucho, CPU, PPU e APU */
/* ================================ NES ================================= */
class NES {
  constructor() {
    this.ram = new Uint8Array(2048);
    this.cart = null; this.nmi = false;
    this.noLimit = false; this.xPre = 0; this.xPost = 0; // melhorias opcionais (desligadas = comportamento original)
    this.buttons = 0; this.shift = 0; this.strobe = 0;
    this.cpu = new CPU(this); this.ppu = new PPU(this); this.apu = new APU(this);
  }
  load(buf) { this.cart = new Cartridge(buf); this.reset(); }
  reset() {
    this.ram.fill(0); this.nmi = false; this.shift = 0; this.strobe = 0;
    this.cart.reset(); this.ppu.reset(); this.apu.reset(); this.cpu.reset();
  }
  irqLine() { return this.cart.irq || this.apu.irq; }
  setButtons(mask) { this.buttons = mask; }

  cpuRead(a) {
    if (a < 0x2000) return this.ram[a & 0x7FF];
    if (a < 0x4000) return this.ppu.readReg(a & 7);
    if (a >= 0x6000) return this.cart.cpuRead(a);
    if (a === 0x4015) return this.apu.read(a);
    if (a === 0x4016) {
      if (this.strobe) this.shift = this.buttons;
      const v = this.shift & 1; this.shift = (this.shift >> 1) | 0x80; return v | 0x40;
    }
    if (a === 0x4017) return 0x40;
    return 0;
  }
  cpuWrite(a, v) {
    if (a < 0x2000) this.ram[a & 0x7FF] = v;
    else if (a < 0x4000) this.ppu.writeReg(a & 7, v);
    else if (a === 0x4014) {
      const base = v << 8, ppu = this.ppu;
      for (let i = 0; i < 256; i++) ppu.oam[(ppu.oamAddr + i) & 0xFF] = this.cpuRead(base + i);
      this.cpu.stall += 513;
    } else if (a === 0x4016) { this.strobe = v & 1; if (this.strobe) this.shift = this.buttons; }
    else if (a < 0x4018) this.apu.write(a, v);
    else if (a >= 0x4020) this.cart.cpuWrite(a, v);
  }
  runFrame() {
    const ppu = this.ppu, cpu = this.cpu, apu = this.apu;
    ppu.frameDone = false;
    while (!ppu.frameDone) {
      const c = cpu.step();
      ppu.advance(c * 3);
      apu.run(c);
    }
  }
}

if (typeof module !== 'undefined') module.exports = { NES, Cartridge, PAL32 };
