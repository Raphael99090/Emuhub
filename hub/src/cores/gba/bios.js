'use strict';
/* BIOS simulada (HLE) do GBA: implementa as chamadas SWI em JavaScript, sem precisar da BIOS real
 * (que não pode ser distribuída). Chamadas de som e MultiBoot viram no-op. */

function gbaPut8(bus, a, v) { // escrita de byte "crua", sem a regra de duplicação da VRAM/paleta
  switch (a >>> 24) {
    case 2: bus.ewram.u8[a & 0x3FFFF] = v; break;
    case 3: bus.iwram.u8[a & 0x7FFF] = v; break;
    case 5: bus.pal.u8[a & 0x3FF] = v; break;
    case 6: bus.vram.u8[bus.vramOff(a)] = v; break;
    case 7: bus.oam.u8[a & 0x3FF] = v; break;
    default: bus.write8(a, v);
  }
}

function gbaArcTan(i) {
  const a = -((i * i) >> 14);
  let b = ((0xA9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91C;
  b = ((b * a) >> 14) + 0xFB6;
  b = ((b * a) >> 14) + 0x16AA;
  b = ((b * a) >> 14) + 0x2081;
  b = ((b * a) >> 14) + 0x3651;
  b = ((b * a) >> 14) + 0xA2F9;
  return (i * b) >> 16;
}
function gbaArcTan2(x, y) {
  if (!y) return x >= 0 ? 0 : 0x8000;
  if (!x) return y >= 0 ? 0x4000 : 0xC000;
  if (y >= 0) {
    if (x >= 0) { if (x >= y) return gbaArcTan(((y << 14) / x) | 0); }
    else if (-x >= y) return gbaArcTan(((y << 14) / x) | 0) + 0x8000;
    return 0x4000 - gbaArcTan(((x << 14) / y) | 0);
  }
  if (x <= 0) { if (-x > -y) return gbaArcTan(((y << 14) / x) | 0) + 0x8000; }
  else if (x >= -y) return gbaArcTan(((y << 14) / x) | 0) + 0x10000;
  return 0xC000 - gbaArcTan(((x << 14) / y) | 0);
}

/* ---- descompressores: devolvem os bytes; quem chama decide como gravar ---- */
function gbaLz77(bus, src) {
  const size = bus.read32(src) >>> 8, out = new Uint8Array(size);
  let sp = src + 4, op = 0;
  while (op < size) {
    const flags = bus.read8(sp++);
    for (let bit = 7; bit >= 0 && op < size; bit--) {
      if (flags & (1 << bit)) {
        const b0 = bus.read8(sp++), b1 = bus.read8(sp++);
        const len = (b0 >> 4) + 3, disp = (((b0 & 15) << 8) | b1) + 1;
        for (let k = 0; k < len && op < size; k++, op++) out[op] = op - disp >= 0 ? out[op - disp] : 0;
      } else out[op++] = bus.read8(sp++);
    }
  }
  return out;
}
function gbaRle(bus, src) {
  const size = bus.read32(src) >>> 8, out = new Uint8Array(size);
  let sp = src + 4, op = 0;
  while (op < size) {
    const f = bus.read8(sp++);
    if (f & 0x80) { const len = (f & 0x7F) + 3, v = bus.read8(sp++); for (let k = 0; k < len && op < size; k++) out[op++] = v; }
    else { const len = (f & 0x7F) + 1; for (let k = 0; k < len && op < size; k++) out[op++] = bus.read8(sp++); }
  }
  return out;
}
function gbaHuff(bus, src) {
  const hdr = bus.read32(src), bits = hdr & 15, size = hdr >>> 8, out = new Uint8Array(size);
  const treeSize = bus.read8(src + 4), root = src + 5;
  let sp = src + 4 + (treeSize + 1) * 2, op = 0, node = root, acc = 0, accBits = 0;
  while (op < size) {
    const word = bus.read32(sp); sp += 4;
    for (let b = 31; b >= 0 && op < size; b--) {
      const bit = (word >>> b) & 1, nb = bus.read8(node);
      const next = (node & ~1) + (nb & 0x3F) * 2 + 2;
      const leaf = bit ? (nb & 0x40) : (nb & 0x80), target = next + bit;
      if (leaf) {
        acc = (acc | (bus.read8(target) << accBits)) >>> 0; accBits += bits; node = root;
        if (accBits >= 32) { for (let k = 0; k < 4 && op < size; k++) out[op++] = (acc >>> (k * 8)) & 0xFF; acc = 0; accBits = 0; }
      } else node = target;
    }
  }
  return out;
}
function gbaStore(bus, dst, data, halfwords) {
  if (halfwords) { for (let i = 0; i < data.length; i += 2) bus.write16(dst + i, data[i] | ((data[i + 1] || 0) << 8)); }
  else for (let i = 0; i < data.length; i++) gbaPut8(bus, dst + i, data[i]);
}

function gbaIntrWait(sys, discard, flags, pc) {
  const cpu = sys.cpu, bus = sys.bus, io = bus.io.u16, bf = bus.iwram.u16;
  io[0x208 >> 1] = 1; sys.updateIrq();
  if (!sys.intrWaiting) { sys.intrWaiting = true; if (discard) bf[0x7FF8 >> 1] &= ~flags; }
  const cur = bf[0x7FF8 >> 1];
  if (cur & flags) { bf[0x7FF8 >> 1] = cur & ~flags; sys.intrWaiting = false; return true; }
  cpu.r[15] = pc; cpu.pcWritten = true; cpu.halted = true; // repete o SWI depois que a interrupção acordar a CPU
  return true;
}

function gbaRamReset(sys, f) {
  const b = sys.bus;
  if (f & 1) b.ewram.u8.fill(0);
  if (f & 2) b.iwram.u8.fill(0, 0, 0x7E00);
  if (f & 4) b.pal.u8.fill(0);
  if (f & 8) b.vram.u8.fill(0);
  if (f & 16) b.oam.u8.fill(0);
  if (f & 0x80) { b.io.u16.fill(0, 0, 0x30); b.io.u16[0] = 0x80; for (const o of [0x20, 0x26, 0x30, 0x36]) b.io.u16[o >> 1] = 0x100; sys.ppu.latchRef(0); sys.ppu.latchRef(1); }
}

function gbaSwi(sys, num, pc) {
  const cpu = sys.cpu, bus = sys.bus, r = cpu.r;
  const n = cpu.t ? (num & 0xFF) : ((num >> 16) & 0xFF);
  switch (n) {
    case 0x00: sys.softReset(); return true;
    case 0x01: gbaRamReset(sys, r[0]); return true;
    case 0x02: case 0x03: cpu.halted = true; return true;
    case 0x04: return gbaIntrWait(sys, r[0] & 1, r[1] & 0xFFFF, pc);
    case 0x05: return gbaIntrWait(sys, 1, 1, pc);
    case 0x06: case 0x07: {
      const num2 = (n === 6 ? r[0] : r[1]) | 0, den = (n === 6 ? r[1] : r[0]) | 0;
      if (den === 0) { r[0] = num2 < 0 ? 0xFFFFFFFF : 1; r[1] = num2 >>> 0; r[3] = 1; return true; }
      const q = (num2 / den) | 0, rem = (num2 - Math.imul(q, den)) | 0;
      r[0] = q >>> 0; r[1] = rem >>> 0; r[3] = Math.abs(q) >>> 0; return true;
    }
    case 0x08: r[0] = Math.floor(Math.sqrt(r[0] >>> 0)) >>> 0; return true;
    case 0x09: r[0] = gbaArcTan(r[0] | 0) >>> 0; return true;
    case 0x0A: r[0] = gbaArcTan2(r[0] | 0, r[1] | 0) & 0xFFFF; return true;
    case 0x0B: case 0x0C: {
      let src = r[0] & ~1, dst = r[1] & ~1, cnt = r[2] & 0x1FFFFF;
      const fill = (r[2] & 0x1000000) !== 0, word = n === 0x0C || (r[2] & 0x4000000) !== 0;
      if (n === 0x0C) cnt = (cnt + 7) & ~7;
      if (word) { src &= ~3; dst &= ~3; const f = fill ? bus.read32(src) : 0; for (let i = 0; i < cnt; i++) { bus.write32(dst, fill ? f : bus.read32(src)); if (!fill) src += 4; dst += 4; } }
      else { const f = fill ? bus.read16(src) : 0; for (let i = 0; i < cnt; i++) { bus.write16(dst, fill ? f : bus.read16(src)); if (!fill) src += 2; dst += 2; } }
      return true;
    }
    case 0x0D: r[0] = 0xBAAE187F; return true;
    case 0x0E: { // BgAffineSet
      let src = r[0], dst = r[1];
      for (let k = 0; k < r[2]; k++, src += 20, dst += 16) {
        const ox = bus.read32(src) | 0, oy = bus.read32(src + 4) | 0;
        const dx = gbaS16(bus.read16(src + 8)), dy = gbaS16(bus.read16(src + 10));
        const sx = gbaS16(bus.read16(src + 12)), sy = gbaS16(bus.read16(src + 14));
        const th = (bus.read16(src + 16) >> 8) / 128 * Math.PI, c = Math.cos(th), s = Math.sin(th);
        const pa = Math.trunc(c * sx), pb = Math.trunc(-s * sx), pc = Math.trunc(s * sy), pd = Math.trunc(c * sy);
        bus.write16(dst, pa & 0xFFFF); bus.write16(dst + 2, pb & 0xFFFF); bus.write16(dst + 4, pc & 0xFFFF); bus.write16(dst + 6, pd & 0xFFFF);
        bus.write32(dst + 8, (ox - (pa * dx + pb * dy)) >>> 0); bus.write32(dst + 12, (oy - (pc * dx + pd * dy)) >>> 0);
      }
      return true;
    }
    case 0x0F: { // ObjAffineSet
      let src = r[0], dst = r[1]; const off = r[3];
      for (let k = 0; k < r[2]; k++, src += 8) {
        const sx = gbaS16(bus.read16(src)), sy = gbaS16(bus.read16(src + 2));
        const th = (bus.read16(src + 4) >> 8) / 128 * Math.PI, c = Math.cos(th), s = Math.sin(th);
        bus.write16(dst, Math.trunc(c * sx) & 0xFFFF); bus.write16(dst + off, Math.trunc(-s * sx) & 0xFFFF);
        bus.write16(dst + off * 2, Math.trunc(s * sy) & 0xFFFF); bus.write16(dst + off * 3, Math.trunc(c * sy) & 0xFFFF);
        dst += off * 4;
      }
      return true;
    }
    case 0x10: { // BitUnPack
      const info = r[2], len = bus.read16(info), sw = bus.read8(info + 2), dw = bus.read8(info + 3), off = bus.read32(info + 4);
      const zero = (off >>> 31) !== 0, offv = off & 0x7FFFFFFF, mask = (1 << sw) - 1;
      let src = r[0], dst = r[1], acc = 0, bits = 0;
      for (let i = 0; i < len; i++) {
        const b = bus.read8(src++);
        for (let k = 0; k < 8; k += sw) {
          let v = (b >> k) & mask; if (v || zero) v += offv;
          acc = (acc | (v << bits)) >>> 0; bits += dw;
          if (bits >= 32) { bus.write32(dst, acc); dst += 4; acc = 0; bits = 0; }
        }
      }
      return true;
    }
    case 0x11: gbaStore(bus, r[1], gbaLz77(bus, r[0]), false); return true;
    case 0x12: gbaStore(bus, r[1], gbaLz77(bus, r[0]), true); return true;
    case 0x13: gbaStore(bus, r[1], gbaHuff(bus, r[0]), false); return true;
    case 0x14: gbaStore(bus, r[1], gbaRle(bus, r[0]), false); return true;
    case 0x15: gbaStore(bus, r[1], gbaRle(bus, r[0]), true); return true;
    case 0x16: case 0x17: { // Diff 8 bits
      const size = bus.read32(r[0]) >>> 8, out = new Uint8Array(size);
      let acc = 0; for (let i = 0; i < size; i++) { acc = (acc + bus.read8(r[0] + 4 + i)) & 0xFF; out[i] = acc; }
      gbaStore(bus, r[1], out, n === 0x17); return true;
    }
    case 0x18: { // Diff 16 bits
      const size = bus.read32(r[0]) >>> 8; let acc = 0;
      for (let i = 0; i < size; i += 2) { acc = (acc + bus.read16(r[0] + 4 + i)) & 0xFFFF; bus.write16(r[1] + i, acc); }
      return true;
    }
    default: return true; // som, MultiBoot, etc.: sem efeito
  }
}

if (typeof module !== 'undefined') module.exports = { gbaSwi, gbaArcTan, gbaArcTan2 };
