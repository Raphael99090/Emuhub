// Paridade da PPU do SNES: VRAM/OAM/CGRAM e registradores aleatórios, por quadro e por linha.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../../src/cores/snes/ppu.js'), 'utf8');
const { SNESPPU } = new Function('module', src + '\nreturn {SNESPPU};')({});
const seed = +process.argv[2], frames = +process.argv[3];
let s = seed >>> 0; const r8 = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
const sys = { cyc: 0, line: 0, mdr: 0 };
const p = new SNESPPU(sys); p.reset();
let H = 0x811c9dc5; const mix = v => { H = Math.imul(H ^ (v >>> 0), 16777619) >>> 0; };
const W = (a, v) => p.writeReg(a, v & 255);
W(0x2115, 0x80); W(0x2116, 0); W(0x2117, 0);
for (let i = 0; i < 32768; i++) { W(0x2118, r8()); W(0x2119, r8()); }
W(0x2102, 0); W(0x2103, 0); for (let i = 0; i < 544; i++) W(0x2104, r8());
W(0x2121, 0); for (let i = 0; i < 512; i++) W(0x2122, r8());
const cfg = [0x2101, 0x2105, 0x2106, 0x2107, 0x2108, 0x2109, 0x210A, 0x210B, 0x210C, 0x210D, 0x210D, 0x210E, 0x210E, 0x210F, 0x210F, 0x2110, 0x2110, 0x2111, 0x2111, 0x2112, 0x2112, 0x2113, 0x2113, 0x2114, 0x2114,
  0x211A, 0x211B, 0x211B, 0x211C, 0x211C, 0x211D, 0x211D, 0x211E, 0x211E, 0x211F, 0x211F, 0x2120, 0x2120, 0x2123, 0x2124, 0x2125, 0x2126, 0x2127, 0x2128, 0x2129, 0x212A, 0x212B, 0x212C, 0x212D, 0x212E, 0x212F, 0x2130, 0x2131, 0x2132, 0x2132, 0x2132];
const fix = a => { let v = r8(); if (a === 0x2100) v &= 0x0F; else if (a === 0x212C || a === 0x212D) v &= 0x1F; else if (a === 0x2133) v &= 0x4F; else if (a === 0x2132) v |= 0xE0 & r8(); return v; };
for (let f = 0; f < frames; f++) {
  W(0x2100, fix(0x2100)); for (const a of cfg) W(a, fix(a)); W(0x2133, fix(0x2133));
  if (f & 1) W(0x2105, (r8() & 0xF8) | (r8() % 8));
  p.beginFrame();
  const lines = (p.setini & 4) ? 239 : 224;
  for (let y = 0; y < lines; y++) {
    if ((y & 15) === 7) { for (let k = 0; k < 4; k++) { const a = cfg[r8() % cfg.length]; W(a, fix(a)); } }
    p.renderLine(y);
  }
  p.finishFrame();
  const fr = p.frame; for (let i = 0; i < fr.length; i++) mix(fr[i]); mix(p.outW); mix(p.outH);
  sys.cyc = (r8() << 4) | 5; sys.line = r8(); sys.mdr = r8();
  for (const a of [0x2137, 0x213C, 0x213C, 0x213D, 0x213D, 0x213E, 0x2134, 0x2135, 0x2136, 0x2138, 0x2138, 0x2139, 0x213A, 0x213B, 0x213B, 0x213F]) mix(p.readReg(a));
}
console.log(H);
