// Paridade Neo Geo: BIOS sintética com código aleatório (68000 + escritas em LSPC/paleta/sistema) e M1 com escritas no YM2610.
// Uso: node neogeo.js semente quadros botoes dir   (grava os arquivos em dir; o C++ lê a mesma pasta)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../../src/cores/');
const rd = f => fs.readFileSync(root + f + '.js', 'utf8');
const { NeoGeo } = new Function('module', ['shared/state', 'neogeo/m68k', 'neogeo/ym2610', 'sms/z80', 'neogeo/neogeo'].map(rd).join('\nvar __d=0;\n') + '\nreturn {NeoGeo};')({});
const seed = +process.argv[2], frames = +process.argv[3], btn = +process.argv[4], dir = process.argv[5];
let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; };
const fill = n => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = rnd() & 255; return a; };
const bios = new Uint8Array(0x20000); for (let i = 0x2000; i < 0x20000; i++) bios[i] = rnd() & 255;
const W = (a, ws) => ws.forEach((w, i) => { bios[a + i * 2] = (w >> 8) & 255; bios[a + i * 2 + 1] = w & 255; });
const L = v => [(v >>> 16) & 0xFFFF, v & 0xFFFF];
W(0, [0x0010, 0xF300, 0x00C0, 0x0402]);                                        // SP=10F300 PC=C00402
const ih = 0xC00300; for (const v of [25, 26, 27]) W(v * 4, L(ih)); W(0x300, [0x33FC, 7, ...L(0x3C000C), 0x4E73]);   // IRQ: ack + RTE
const prog = [0x46FC, 0x2000];                                                  // SR = 2000 (IRQs ligadas)
const wr = [0x3C0000, 0x3C0002, 0x3C0002, 0x3C0004, 0x3C0006, 0x3C0008, 0x3C000A, 0x400000 + 2 * (rnd() & 0xFF), 0x400000 + 2 * (rnd() & 0xFFF), 0x3A0001, 0x3A0003, 0x3A000B, 0x3A001B, 0x3A0011, 0x3A001D, 0x3A000D, 0x3A000F, 0x3A0007, 0x3A0005, 0x3A0015, 0x300001, 0x320000, 0x3C000C];
const rr = [0x3C0000, 0x3C0002, 0x3C0006, 0x300000, 0x340000, 0x380000, 0x100000, 0x000100, 0x200000, 0x400000, 0x3C0004, 0x3C0008, 0x3C000A, 0xC00100, 0xD00000];
const dn = () => rnd() & 7;
for (let k = 0; k < 700; k++) {
  const x = dn(), y = dn(), n = rnd();
  switch (rnd() % 20) {
    case 0: case 1: case 2: { const a = wr[rnd() % wr.length]; let v = rnd() & 0xFFFF; if (a === 0x3C000C) v = 7; if (a === 0x3C0000) v = rnd() % 3 ? (0x8000 + ((rnd() & 3) << 9) + (rnd() & 0x1FF)) : v & 0x7FFF;
      if (a === 0x3C0004) v = rnd() & 0xFF; prog.push(0x33FC, v, ...L(a)); break; }
    case 3: prog.push(0x3039 | (x << 9), ...L(rr[rnd() % rr.length])); break;
    case 4: prog.push(0x7000 | (x << 9) | (n & 255)); break;
    case 5: prog.push(0xD080 | (x << 9) | y); break;
    case 6: prog.push(0x9040 | (x << 9) | y); break;
    case 7: prog.push(0xB180 | (x << 9) | y); break;
    case 8: prog.push(0xC040 | (x << 9) | y); break;
    case 9: prog.push(0x8080 | (x << 9) | y); break;
    case 10: prog.push(0xE148 | ((n & 7) << 9) | y); break;
    case 11: prog.push(0xE098 | ((n & 7) << 9) | y); break;
    case 12: prog.push(0x4840 | y); break;
    case 13: prog.push(0x4880 | y); break;
    case 14: prog.push(0x4480 | y); break;
    case 15: prog.push(0x0640 | y, rnd() & 0xFFFF); break;                        // addi.w #imm,Dy
    case 16: prog.push(0xC0FC | (x << 9), rnd() & 0xFFFF); break;                  // mulu
    case 17: prog.push(0x80FC | (x << 9), (rnd() & 0xFFFF) | 1); break;            // divu (divisor != 0)
    case 18: prog.push(0xB080 | (x << 9) | y, 0x6700 | 2); prog.push(0x5280 | y); break;   // cmp.l; beq +2; addq.l #1,Dy
    case 19: prog.push(0x203C | (x << 9), ...L(rnd() << 8 ^ rnd())); break;        // move.l #imm,Dx
  }
}
const base = 0xC00402, here = base + prog.length * 2; prog.push(0x6000, (0x402 + 2 - (here - 0xC00000 + 2) + 0) & 0xFFFF);
W(0x402, prog);
// branch de volta ao início do laço (depois do move #2000,SR)
{ const target = 0xC00406, at = 0xC00402 + (prog.length - 2) * 2; const d = target - (at + 2); W(0x402 + (prog.length - 1) * 2, [d & 0xFFFF]); }
const p = fill(0x100000), sfix = fill(0x20000), v = fill(0x20000), c1 = fill(0x10000), c2 = fill(0x10000), m1 = new Uint8Array(0x10000);
const z = [0x31, 0xFF, 0xFF, 0xED, 0x56, 0xFB]; let zp = 0x100; m1.set([0xC3, 0x00, 0x01], 0);
m1.set(z, zp); zp += z.length;
for (let k = 0; k < 600; k++) { const pt = [4, 5, 6, 7, 4, 5, 0x0C, 0x08, 0x18, 0x00][rnd() % 10]; const o = rnd() % 4;
  if (o === 0) { m1.set([0xDB, pt], zp); zp += 2; } else { m1.set([0x3E, rnd() & 255, 0xD3, pt], zp); zp += 4; } }
m1.set([0x18, 0xFE], zp);
m1.set([0xDB, 0x00, 0xD3, 0x0C, 0xED, 0x45], 0x66); m1.set([0xF5, 0xDB, 0x04, 0xF1, 0xFB, 0xED, 0x4D], 0x38);
fs.mkdirSync(dir, { recursive: true });
for (const [n, d] of [['bios', bios], ['p', p], ['s', fill(0x8000)], ['v', v], ['c1', c1], ['c2', c2], ['m1', m1], ['sfix', sfix]]) fs.writeFileSync(path.join(dir, n + '.bin'), d);
const g = new NeoGeo(); g.setBios({ bios, sfix }); g.loadSet({ p, s: fs.readFileSync(path.join(dir, 's.bin')), m1, v, c1, c2 });
g.ym.setSampleRate(44100); g.buttons[0] = btn; g.buttons[1] = (btn & 1024) ? 8 : 0;
let h = 0x811c9dc5 >>> 0;
for (let f = 0; f < frames; f++) { g.runFrame(); const fr = g.frame; for (let i = 0; i < fr.length; i++) h = Math.imul(h ^ fr[i], 16777619) >>> 0; }
let a = 0x811c9dc5 >>> 0; const n = g.ym.buffered(), buf = new Float32Array(n); g.ym.fill(buf);
const u = new Uint32Array(buf.buffer); for (let i = 0; i < n; i++) a = Math.imul(a ^ u[i], 16777619) >>> 0;
let m = 0x811c9dc5 >>> 0; for (let i = 0; i < 0x10000; i++) m = Math.imul(m ^ g.wram[i], 16777619) >>> 0;
for (let i = 0; i < 0x8800; i++) m = Math.imul(m ^ g.vram[i], 16777619) >>> 0;
const c = g.cpu, zc = g.z80;
console.log(h, a, n, m, c.pc | 0, ...c.d.map(x => x | 0), c.a[7] | 0, c.x, c.n, c.z, c.v, c.c, zc.pc, zc.sp, zc.R[7], zc.f);
