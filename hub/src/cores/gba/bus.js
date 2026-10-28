'use strict';
/* Mapa de memória do GBA. Tudo little-endian; acessos 16/32 bits chegam alinhados do CPU
 * (o bus ainda mascara por segurança). Contabiliza ciclos de espera por região em this.cycles. */

const GBA_WAIT16 = [1, 1, 3, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 5, 5]; // ciclos por acesso de 8/16 bits
const GBA_WAIT32 = [1, 1, 6, 1, 1, 2, 2, 1, 6, 6, 6, 6, 6, 6, 5, 5]; // ciclos por acesso de 32 bits

function gbaRegion(size) {
  const b = new ArrayBuffer(size);
  return { u8: new Uint8Array(b), u16: new Uint16Array(b), u32: new Uint32Array(b) };
}

class GBABus {
  constructor() {
    this.bios = gbaRegion(0x4000);
    this.ewram = gbaRegion(0x40000);
    this.iwram = gbaRegion(0x8000);
    this.io = gbaRegion(0x400);
    this.pal = gbaRegion(0x400);
    this.vram = gbaRegion(0x18000);
    this.oam = gbaRegion(0x400);
    this.sram = new Uint8Array(0x20000).fill(0xFF);
    this.saveType = 'sram';            // 'sram' | 'flash64' | 'flash128' | 'eeprom'
    this.fl = { state: 0, id: false, erase: false, prog: false, bankSw: false, bank: 0 };
    this.ee = { size: 0, data: new Uint8Array(8192).fill(0xFF), bits: 0, buf: new Uint8Array(256), out: new Uint8Array(68), outPos: 68 };
    this.romLen = 0;
    this.rom = gbaRegion(4);
    this.cycles = 0;
  }

  loadRom(u8) {
    this.romLen = u8.length;
    const padded = (u8.length + 3) & ~3;
    const b = new ArrayBuffer(padded);
    const r = { u8: new Uint8Array(b), u16: new Uint16Array(b), u32: new Uint32Array(b) };
    r.u8.set(u8);
    this.rom = r;
  }

  /* ---- ganchos de IO (o núcleo do GBA pode sobrescrever) ---- */
  ioRead16(off) { return this.io.u16[off >> 1]; }
  ioWrite16(off, v) {
    if (off === 0x202) { this.io.u16[0x101] &= ~v; return; } // IF: escrever 1 limpa o bit
    this.io.u16[off >> 1] = v;
  }
  ioWrite8(off, v) {
    if (off === 0x202 || off === 0x203) { this.io.u8[off] &= ~v; return; }
    this.io.u8[off] = v;
  }

  /* ---- ROM (espelhada em 0x08, 0x0A, 0x0C; fora do arquivo devolve "open bus") ---- */
  romRead16(a) {
    const o = a & 0x1FFFFFE;
    if (o >= this.romLen) return (o >>> 1) & 0xFFFF;
    return this.rom.u16[o >> 1];
  }
  romRead32(a) {
    const o = a & 0x1FFFFFC;
    if (o + 4 <= this.romLen) return this.rom.u32[o >> 2];
    return ((this.romRead16(o + 2) << 16) | this.romRead16(o)) >>> 0;
  }
  romRead8(a) {
    const o = a & 0x1FFFFFF;
    if (o >= this.romLen) return ((o >>> 1) >>> ((o & 1) << 3)) & 0xFF;
    return this.rom.u8[o];
  }

  vramOff(a) { const v = a & 0x1FFFF; return v >= 0x18000 ? v - 0x8000 : v; }

  /* ---- saves: SRAM / Flash / EEPROM ---- */
  saveRead(a) {
    a &= 0xFFFF;
    if (this.saveType === 'flash64' || this.saveType === 'flash128') {
      const f = this.fl;
      if (f.id && a < 2) { const id = this.saveType === 'flash128' ? [0x62, 0x13] : [0x32, 0x1B]; return id[a]; }
      return this.sram[(f.bank << 16) | a];
    }
    return this.sram[a];
  }
  saveWrite(a, v) {
    a &= 0xFFFF;
    if (this.saveType === 'sram') { this.sram[a] = v; return; }
    if (this.saveType === 'eeprom') return;
    const f = this.fl, base = f.bank << 16;
    if (f.prog) { this.sram[base | a] = v; f.prog = false; return; }
    if (f.bankSw) { if (a === 0 && this.saveType === 'flash128') f.bank = v & 1; f.bankSw = false; return; }
    if (f.state === 0) { if (a === 0x5555 && v === 0xAA) f.state = 1; else if (v === 0xF0) f.id = false; return; }
    if (f.state === 1) { f.state = (a === 0x2AAA && v === 0x55) ? 2 : 0; return; }
    f.state = 0;
    if (a === 0x5555) {
      switch (v) {
        case 0x90: f.id = true; break;
        case 0xF0: f.id = false; break;
        case 0x80: f.erase = true; break;
        case 0x10: if (f.erase) this.sram.fill(0xFF, 0, this.saveType === 'flash128' ? 0x20000 : 0x10000); f.erase = false; break;
        case 0xA0: f.prog = true; break;
        case 0xB0: if (this.saveType === 'flash128') f.bankSw = true; break;
      }
    } else if (f.erase && v === 0x30) { this.sram.fill(0xFF, base | (a & 0xF000), (base | (a & 0xF000)) + 0x1000); f.erase = false; }
  }
  eeActive(a) { return this.saveType === 'eeprom' && (this.romLen <= 0x1000000 || (a & 0x1FFFFFF) >= 0x1FFFF00); }
  eeDetect(n) {
    const e = this.ee;
    if (e.size) return;
    if (n === 9 || n === 73) e.size = 512; else if (n === 17 || n === 81) e.size = 8192;
  }
  eeRead() { const e = this.ee; return e.outPos < 68 ? e.out[e.outPos++] : 1; }
  eeWrite(v) {
    const e = this.ee; e.outPos = 68;
    if (!e.size) return;
    e.buf[e.bits++] = v & 1;
    const ab = e.size === 512 ? 6 : 14;
    if (e.bits < 2 + ab + 1) return;
    const rd = e.buf[0] === 1 && e.buf[1] === 1, wr = e.buf[0] === 1 && e.buf[1] === 0;
    if (!rd && !wr) { e.bits = 0; return; }
    let addr = 0; for (let i = 0; i < ab; i++) addr = (addr << 1) | e.buf[2 + i];
    addr &= (e.size >> 3) - 1;
    if (rd && e.bits === 3 + ab) {
      e.out.fill(0, 0, 4);
      for (let i = 0; i < 64; i++) e.out[4 + i] = (e.data[addr * 8 + (i >> 3)] >> (7 - (i & 7))) & 1;
      e.outPos = 0; e.bits = 0;
    } else if (wr && e.bits === 3 + ab + 64) {
      for (let i = 0; i < 8; i++) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | e.buf[2 + ab + i * 8 + k]; e.data[addr * 8 + i] = b; }
      e.bits = 0;
    }
  }

  /* ---- leituras ---- */
  read32(a) {
    a >>>= 0; const r = a >>> 24;
    this.cycles += GBA_WAIT32[r & 15];
    switch (r) {
      case 0: return a < 0x4000 ? this.bios.u32[a >> 2] : 0;
      case 2: return this.ewram.u32[(a & 0x3FFFF) >> 2];
      case 3: return this.iwram.u32[(a & 0x7FFF) >> 2];
      case 4: { const o = a & 0x3FC; return ((this.ioRead16(o + 2) << 16) | this.ioRead16(o)) >>> 0; }
      case 5: return this.pal.u32[(a & 0x3FF) >> 2];
      case 6: return this.vram.u32[this.vramOff(a) >> 2];
      case 7: return this.oam.u32[(a & 0x3FF) >> 2];
      case 8: case 9: case 10: case 11: case 12: return this.romRead32(a);
      case 13: return this.eeActive(a) ? this.eeRead() * 0x10001 : this.romRead32(a);
      case 14: case 15: return (this.saveRead(a) * 0x01010101) >>> 0;
      default: return 0;
    }
  }
  read16(a) {
    a >>>= 0; const r = a >>> 24;
    this.cycles += GBA_WAIT16[r & 15];
    switch (r) {
      case 0: return a < 0x4000 ? this.bios.u16[(a & 0x3FFF) >> 1] : 0;
      case 2: return this.ewram.u16[(a & 0x3FFFF) >> 1];
      case 3: return this.iwram.u16[(a & 0x7FFF) >> 1];
      case 4: return this.ioRead16(a & 0x3FE);
      case 5: return this.pal.u16[(a & 0x3FF) >> 1];
      case 6: return this.vram.u16[this.vramOff(a) >> 1];
      case 7: return this.oam.u16[(a & 0x3FF) >> 1];
      case 8: case 9: case 10: case 11: case 12: return this.romRead16(a);
      case 13: return this.eeActive(a) ? this.eeRead() : this.romRead16(a);
      case 14: case 15: return this.saveRead(a) * 0x0101;
      default: return 0;
    }
  }
  read8(a) {
    a >>>= 0; const r = a >>> 24;
    this.cycles += GBA_WAIT16[r & 15];
    switch (r) {
      case 0: return a < 0x4000 ? this.bios.u8[a] : 0;
      case 2: return this.ewram.u8[a & 0x3FFFF];
      case 3: return this.iwram.u8[a & 0x7FFF];
      case 4: return (this.ioRead16(a & 0x3FE) >>> ((a & 1) << 3)) & 0xFF;
      case 5: return this.pal.u8[a & 0x3FF];
      case 6: return this.vram.u8[this.vramOff(a)];
      case 7: return this.oam.u8[a & 0x3FF];
      case 8: case 9: case 10: case 11: case 12: return this.romRead8(a);
      case 13: return this.eeActive(a) ? this.eeRead() & 0xFF : this.romRead8(a);
      case 14: case 15: return this.saveRead(a);
      default: return 0;
    }
  }

  /* ---- escritas ---- */
  write32(a, v) {
    a >>>= 0; const r = a >>> 24;
    this.cycles += GBA_WAIT32[r & 15];
    switch (r) {
      case 2: this.ewram.u32[(a & 0x3FFFF) >> 2] = v; break;
      case 3: this.iwram.u32[(a & 0x7FFF) >> 2] = v; break;
      case 4: { const o = a & 0x3FC; this.ioWrite16(o, v & 0xFFFF); this.ioWrite16(o + 2, v >>> 16); break; }
      case 5: this.pal.u32[(a & 0x3FF) >> 2] = v; break;
      case 6: this.vram.u32[this.vramOff(a) >> 2] = v; break;
      case 7: this.oam.u32[(a & 0x3FF) >> 2] = v; break;
      case 13: if (this.eeActive(a)) this.eeWrite(v); break;
      case 14: case 15: this.saveWrite(a, v & 0xFF); break;
    }
  }
  write16(a, v) {
    a >>>= 0; const r = a >>> 24;
    this.cycles += GBA_WAIT16[r & 15];
    switch (r) {
      case 2: this.ewram.u16[(a & 0x3FFFF) >> 1] = v; break;
      case 3: this.iwram.u16[(a & 0x7FFF) >> 1] = v; break;
      case 4: this.ioWrite16(a & 0x3FE, v & 0xFFFF); break;
      case 5: this.pal.u16[(a & 0x3FF) >> 1] = v; break;
      case 6: this.vram.u16[this.vramOff(a) >> 1] = v; break;
      case 7: this.oam.u16[(a & 0x3FF) >> 1] = v; break;
      case 13: if (this.eeActive(a)) this.eeWrite(v); break;
      case 14: case 15: this.saveWrite(a, v & 0xFF); break;
    }
  }
  write8(a, v) {
    a >>>= 0; const r = a >>> 24; v &= 0xFF;
    this.cycles += GBA_WAIT16[r & 15];
    switch (r) {
      case 2: this.ewram.u8[a & 0x3FFFF] = v; break;
      case 3: this.iwram.u8[a & 0x7FFF] = v; break;
      case 4: this.ioWrite8(a & 0x3FF, v); break;
      case 5: this.pal.u16[(a & 0x3FF) >> 1] = v * 0x0101; break;               // byte duplicado nos dois lados
      case 6: { const o = this.vramOff(a); if (o < 0x10000) this.vram.u16[o >> 1] = v * 0x0101; break; } // só região de BG
      case 13: if (this.eeActive(a)) this.eeWrite(v); break;
      case 14: case 15: this.saveWrite(a, v); break;
      // OAM: escrita de 8 bits é ignorada
    }
  }
}

if (typeof module !== 'undefined') module.exports = { GBABus };
