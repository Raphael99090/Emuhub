// Paridade GBA: ROM pseudoaleatória (modo 0: configura vídeo/som/DMA/IRQ e entra em loop; modo 1: depois executa código aleatório).
// Compara quadro, áudio, registradores e memória. Uso: node gba.js <semente> <modo> <quadros> <botões> [saida.gba]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../../src/cores/');
const files = ['shared/state', 'gba/cpu', 'gba/bus', 'gba/ppu', 'gba/apu', 'gba/bios', 'gba/sys', 'gba/core'].map(f => fs.readFileSync(root + f + '.js', 'utf8'));
const { GBACore } = new Function('module', files.join('\nvar __d=0;\n') + '\nreturn {GBACore};')({});
function rom(seed, mode) {
  const r = new Uint8Array(0x10000); let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
  for (let i = 0; i < r.length; i++) r[i] = rnd() & 255;
  const dv = new DataView(r.buffer);
  const w = (a, v) => dv.setUint32(a, v >>> 0, true);
  w(0, 0xEA00002E);
  r.set([0x54, 0x45, 0x53, 0x54, 0x52, 0x4F, 0x4D, 0], 0xA0); r[0xB2] = 0x96;
  let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum += r[i]; r[0xBD] = (-(sum + 0x19)) & 255;
  // handler de IRQ em 0x100
  [0xE3A00301, 0xE2800C02, 0xE1D010B2, 0xE1C010B2, 0xE3A02403, 0xE3822C7F, 0xE28220F8, 0xE1D230B0, 0xE1833001, 0xE1C230B0, 0xE12FFF1E].forEach((v, i) => w(0x100 + i * 4, v));
  let pc = 0xC0;
  const emit = v => { w(pc, v); pc += 4; };
  emit(0xE3A00301);                       // mov r0,#0x04000000
  const store = (off, val) => { emit(0xE59F1000); emit(0xEA000000); emit(val); emit(0xE5801000 | off); };   // ldr r1,=val; str r1,[r0,#off]
  const storeAbs = (addr, val) => { emit(0xE59F1000); emit(0xE59F2000); emit(0xEA000001); emit(val); emit(addr); emit(0xE5821000); };
  storeAbs(0x03007FFC, 0x08000100);
  const modeN = rnd() % 6;
  // DMA3: ROM aleatória -> paleta, VRAM e OAM
  const dma = (src, dst, cnt) => { store(0xD4, src); store(0xD8, dst); store(0xDC, ((0x8400 << 16) | cnt) >>> 0); };
  dma(0x08002000, 0x05000000, 0x100); dma(0x08003000, 0x06000000, 0x2000); dma(0x08007000, 0x06010000, 0x1000); dma(0x08009000, 0x07000000, 0x100);
  const dispcnt = (modeN | (rnd() & 0x7F40 & ~0x80) | 0x1F00 & (rnd() | 0x400) ) & ~0x80;
  store(0x00, dispcnt & 0xFFFF);
  for (let o = 8; o <= 0x1E; o += 4) store(o, rnd() | 0);
  for (let o = 0x20; o <= 0x3C; o += 4) store(o, rnd() & 0x00FF0FFF);
  for (let o = 0x40; o <= 0x4C; o += 4) store(o, rnd() | 0);
  for (let o = 0x50; o <= 0x54; o += 4) store(o, rnd() & 0x1F3F3FFF);
  store(0x60, rnd() & 0x007F007F); store(0x64, rnd()); store(0x68, rnd()); store(0x6C, rnd()); store(0x70, rnd()); store(0x74, rnd());
  store(0x78, rnd()); store(0x7C, rnd()); store(0x80, rnd() | 0x77000000); store(0x84, 0x80);
  for (let o = 0x90; o < 0xA0; o += 4) store(o, rnd());
  store(0xA0, rnd()); store(0x100, (rnd() & 0xFFFF) | ((0x80 | (rnd() & 0x43)) << 16)); store(0x104, (0xFF00) | (0xC0 << 16));
  if (rnd() & 1) store(0xBC, 0x08004000), store(0xC0, 0x040000A0), store(0xC4, (0xB600 << 16) | 4);
  store(0x04, 0x38 | (rnd() & 0xFF00));
  store(0x200, 0x3FFF); store(0x208, 1);
  if (mode === 0) { w(pc, 0xEF050000); w(pc + 4, 0xEAFFFFFD); }        // swi 5; b -3
  else { w(pc, 0xE51FF004); w(pc + 4, 0x08008000 + 0x400); }            // ldr pc,[pc,#-4]; salta para código aleatório (ARM)
  return r;
}
const seed = +process.argv[2], mode = +process.argv[3], frames = +process.argv[4], btn = +(process.argv[5] || 0), outf = process.argv[6];
const bytes = rom(seed, mode);
if (outf) fs.writeFileSync(outf, bytes);
const g = new GBACore(); g.load(bytes); g.audio.setSampleRate(44100); g.setButtons(btn);
const fnv = (h, v) => Math.imul(h ^ v, 16777619) >>> 0;
let h = 0x811c9dc5 >>> 0;
for (let f = 0; f < frames; f++) { g.runFrame(); const fr = g.frame; for (let i = 0; i < fr.length; i++) h = fnv(h, fr[i]); }
let a = 0x811c9dc5 >>> 0; const n = g.audio.buffered(), buf = new Float32Array(n); g.audio.fill(buf);
const u = new Uint32Array(buf.buffer); for (let i = 0; i < n; i++) a = fnv(a, u[i]);
let m = 0x811c9dc5 >>> 0;
for (const b of [g.bus.ewram.u8, g.bus.iwram.u8, g.bus.io.u8, g.bus.vram.u8, g.bus.pal.u8, g.bus.oam.u8]) for (let i = 0; i < b.length; i++) m = fnv(m, b[i]);
const c = g.cpu;
console.log(h, a, n, m, Array.from(c.r).join(' '), c.getCpsr());
