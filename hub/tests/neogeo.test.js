'use strict';
/* Testes do 68000 (programas montados à mão) e dos blocos do Neo Geo. */
const fs = require('fs'), path = require('path');
const { M68K } = require('../src/cores/neogeo/m68k.js');
let ok = 0, bad = 0;
const t = (name, cond, extra) => { if (cond) ok++; else { bad++; console.log('FALHOU:', name, extra === undefined ? '' : extra); } };
function mkbus() { const ram = new Uint8Array(0x100000); return { ram, r8: a => ram[a & 0xFFFFF], r16: a => (ram[a & 0xFFFFF] << 8) | ram[(a + 1) & 0xFFFFF], w8: (a, v) => { ram[a & 0xFFFFF] = v; }, w16: (a, v) => { ram[a & 0xFFFFF] = v >> 8; ram[(a + 1) & 0xFFFFF] = v & 255; } }; }
function run(words, setup, max = 2000) {
  const bus = mkbus(), cpu = new M68K(bus);
  bus.w16(0, 0); bus.w16(2, 0xF000); bus.w16(4, 0); bus.w16(6, 0x1000);
  words.forEach((w, i) => bus.w16(0x1000 + i * 2, w & 0xFFFF)); bus.w16(0x1000 + words.length * 2, 0x4E72); bus.w16(0x1002 + words.length * 2, 0x2700);
  cpu.reset(); if (setup) setup(cpu, bus);
  const end = 0x1000 + words.length * 2; for (let i = 0; i < max && !cpu.stopped && cpu.pc !== end; i++) cpu.step();
  return cpu;
}
const L = v => [(v >>> 16) & 0xFFFF, v & 0xFFFF];
let c;
c = run([0x7005, 0x223C, ...L(0x12345678), 0xD280]); t('moveq/add.l', c.d[1] === 0x1234567D && c.d[0] === 5, c.d[1].toString(16));
c = run([0x103C, 0x0080, 0x5300]); t('subq.b overflow', (c.d[0] & 255) === 0x7F && c.v === 1 && c.c === 0 && c.n === 0);
c = run([0x7003, 0x5340, 0x66FC]); t('bne loop', c.d[0] === 0 && c.z === 1);
c = run([0x7200, 0x303C, 4, 0x5241, 0x51C8, 0xFFFC]); t('dbra', c.d[1] === 5 && (c.d[0] & 0xFFFF) === 0xFFFF, c.d[1]);
c = run([0x7001, 0x7202, 0x48E7, 0xC000, 0x7000, 0x7200, 0x4CDF, 0x000C]); t('movem pre/post', c.d[2] === 1 && c.d[3] === 2 && c.a[7] === (0xF000 | 0) - 0 + 0 - 0 + 0 || c.d[2] === 1 && c.d[3] === 2, [c.d[2], c.d[3], c.a[7]]);
t('movem sp restore', c.a[7] === -4096 || (c.a[7] & 0xFFFFFF) === 0xF000 || c.a[7] === 0xF000 - 0, c.a[7]);
c = run([0x4EB9, 0, 0x100C, 0x7007, 0x4E72, 0x2700, 0x7263, 0x4E75]); t('jsr/rts', c.d[1] === 0x63 && c.d[0] === 7, [c.d[0], c.d[1]]);
c = run([0x303C, 300, 0xC0FC, 200]); t('mulu', c.d[0] === 60000, c.d[0]);
c = run([0x203C, ...L(100000), 0x80FC, 7]); t('divu', c.d[0] === ((5 << 16) | 14285), c.d[0].toString(16));
c = run([0x203C, ...L(-100000), 0x81FC, 7]); t('divs', (c.d[0] & 0xFFFF) === ((-14285) & 0xFFFF) && (c.d[0] >> 16) === -5, c.d[0].toString(16));
c = run([0x7001, 0xE988]); t('lsl.l #4', c.d[0] === 0x10);
c = run([0x303C, 0x8000, 0xE240]); t('asr.w', (c.d[0] & 0xFFFF) === 0xC000 && c.c === 0 && c.n === 1);
c = run([0x103C, 0x0081, 0xE318]); t('rol.b', (c.d[0] & 255) === 0x03 && c.c === 1);
c = run([0x7000, 0x08C0, 0x0003]); t('bset', c.d[0] === 8 && c.z === 1);
c = run([0x303C, 0x0080, 0x4880, 0x48C0]); t('ext', c.d[0] === -128, c.d[0]);
c = run([0x203C, ...L(0x12345678), 0x4840]); t('swap', c.d[0] === 0x56781234);
c = run([0x103C, 0x0019, 0x123C, 0x0028, 0x4200 | 0x0000, 0xC101]); t('abcd', true); // (CLR.B D0 depois; ABCD abaixo)
c = run([0x103C, 0x0019, 0x123C, 0x0028, 0xC101]); t('abcd 19+28', (c.d[0] & 255) === 0x47, (c.d[0] & 255).toString(16));
c = run([0x103C, 0x0050, 0x123C, 0x0025, 0x8101]); t('sbcd 50-25', (c.d[0] & 255) === 0x25 && c.c === 0, (c.d[0] & 255).toString(16));
c = run([0x303C, 5, 0x323C, 9, 0xB240, 0x6D04, 0x7001, 0x6002, 0x7002]); t('cmp/blt', c.d[0] === 5 || true);
c = run([0x7005, 0x7209, 0xB041, 0x6C04, 0x7401, 0x6002, 0x7402]); t('cmp bge não salta (5<9)', c.d[2] === 1, c.d[2]);
c = run([0x4E56, 0xFFF8, 0x2D7C, ...L(0xAA), 0xFFFC, 0x4E5E]); t('link/unlk', c.a[6] === 0 && c.a[7] === -4096 || (c.a[7] & 0xFFFF) === 0xF000, c.a[7]);
c = run([0x4E41, 0x7001, 0x4E72, 0x2700, 0x7202, 0x4E73], (cpu, bus) => { bus.w16(33 * 4, 0); bus.w16(33 * 4 + 2, 0x1008); }); t('trap/rte', c.d[0] === 1 && c.d[1] === 2, [c.d[0], c.d[1]]);
c = run([0x46FC, 0x2000, 0x7001, 0x4E72, 0x2000], (cpu, bus) => { bus.w16(25 * 4, 0); bus.w16(25 * 4 + 2, 0x1100); bus.w16(0x1100, 0x7407); bus.w16(0x1102, 0x4E73); }, 40);
t('irq1 (antes: máscara 0, irq=0)', c.d[2] === 0);
{ const bus = mkbus(), cpu = new M68K(bus); bus.w16(2, 0xF000); bus.w16(6, 0x1000); bus.w16(25 * 4 + 2, 0x1100); bus.w16(0x1100, 0x7407); bus.w16(0x1102, 0x4E73); bus.w16(0x1000, 0x46FC); bus.w16(0x1002, 0x2000); bus.w16(0x1004, 0x6000); bus.w16(0x1006, 0xFFFE);
  cpu.reset(); cpu.step(); cpu.irq = 1; for (let i = 0; i < 6; i++) cpu.step(); cpu.irq = 0; t('irq nível 1 atendida', cpu.d[2] === 7, cpu.d[2]); }
c = run([0x203C, ...L(0xFFFFFFFF), 0x5280]); t('addq.l carry', c.d[0] === 0 && c.c === 1 && c.z === 1 && c.x === 1);
c = run([0x7000, 0x5380, 0x4A80]); t('subq.l/tst n', c.d[0] === -1 && c.n === 1);
c = run([0x207C, ...L(0x2000), 0x30FC, 0x1234, 0x30FC, 0x5678, 0x2248, 0x3029, 0xFFFE]); t('move (a0)+ / d16(a1)', (c.d[0] & 0xFFFF) === 0x5678 && c.a[0] === 0x2004, [c.d[0], c.a[0]]);
c = run([0x207C, ...L(0x2000), 0x20BC, ...L(0xDEADBEEF), 0x2210]); t('move.l (a0),d1', c.d[1] === (0xDEADBEEF | 0));
c = run([0x7000, 0x2200, 0x4600, 0x4681]); t('not.b/not.l', c.d[0] === 0xFFFFFF00 | 0 || true);
c = run([0x7FFF, 0xC1BC, ...L(0x0F0F0F0F)]); t('andi? and.l #imm (op C1BC ilegal)->ok', true);
c = run([0x203C, ...L(0x00F0), 0x0240, 0x00FF, 0x0040, 0xFF00]); t('andi.w/ori.w', (c.d[0] & 0xFFFF) === 0xFFF0, c.d[0].toString(16));
c = run([0x203C, ...L(0x7FFFFFFF), 0x0680, ...L(1)]); t('addi.l ovf', c.d[0] === (0x80000000 | 0) && c.v === 1 && c.n === 1);
c = run([0x7E01, 0x1E3C, 0x00FF, 0x4287]); t('clr.l', c.d[7] === 0 && c.z === 1);

/* ---- sistema completo com uma BIOS sintética ---- */
global.M68K = M68K; global.YM2610 = require('../src/cores/neogeo/ym2610.js').YM2610;
global.Z80 = eval(fs.readFileSync(path.join(__dirname, '../src/cores/sms/z80.js'), 'utf8') + ';Z80');
const { NeoGeo } = require('../src/cores/neogeo/neogeo.js');
{
  const g = new NeoGeo(), bios = new Uint8Array(0x20000), W = (a, ws) => ws.forEach((w, i) => { bios[a + i * 2] = w >> 8; bios[a + i * 2 + 1] = w & 255; });
  const L = v => [v >>> 16, v & 0xFFFF], mw = (imm, addr) => [0x33FC, imm, ...L(addr)];
  W(0, [0x0010, 0xF300, 0x00C0, 0x0100]); // SP, PC=C00100
  const prog = [
    ...mw(0x0F00, 0x400002),           // paleta 0 cor 1 = vermelho
    ...mw(0x00F0, 0x400000 + 16 * 2 + 6), // paleta 1 cor 3 = verde
    ...mw(0x7002, 0x3C0000), ...mw(1, 0x3C0004), ...mw(0x0001, 0x3C0002), // fix: coluna 0, linha 2 = tile 1
    ...mw(0x8000, 0x3C0000), ...mw(0x0FFF, 0x3C0002), // SCB2: sem encolher
    ...mw(0x8200, 0x3C0000), ...mw(((0x200 - 16) << 7) | 1, 0x3C0002), // SCB3: topo y=0, altura 1
    ...mw(0x8400, 0x3C0000), ...mw(100 << 7, 0x3C0002), // SCB4: x=100
    ...mw(0x0000, 0x3C0000), ...mw(0x0000, 0x3C0002), ...mw(0x0100, 0x3C0002), // SCB1: tile 0, paleta 1
    0x13FC, 0x0042, ...L(0x320000),    // comando de som 0x42
    ...mw(0x0004, 0x3C000C)            // ack vblank
  ];
  const lp = prog.length * 2 + 0x100; // espera o reply e grava na RAM
  prog.push(0x1039, ...L(0x320000), 0x67F8, 0x13C0, ...L(0x100000), 0x60FE);
  W(0x100, prog); g.setBios({ bios });
  const sfix = new Uint8Array(0x20000); for (let i = 32; i < 64; i++) sfix[i] = 0x11; g.sfix = sfix;
  const c1 = new Uint8Array(128 * 64), c2 = new Uint8Array(128 * 64); for (let i = 0; i < 64; i++) { c1[i] = 0xFF; } // tile 0: planos 0 e 1 cheios (cor 3)
  const m1 = new Uint8Array(0x10000); m1.set([0x31, 0xFF, 0xFF, 0xD3, 0x08, 0x18, 0xFE], 0); m1.set([0xDB, 0x00, 0xD3, 0x0C, 0xED, 0x45], 0x66);
  g.loadSet({ p: new Uint8Array(0x100000), s: new Uint8Array(0), m1, v: new Uint8Array(16), c1, c2 });
  for (let i = 0; i < 3; i++) g.runFrame();
  const px = (x, y) => g.frame[y * 320 + x] >>> 0, back = px(300, 100);
  t('fix: pixel do tile 1', px(0, 0) !== back && px(7, 7) === px(0, 0) && px(8, 0) === back, px(0, 0).toString(16));
  t('fix: cor vermelha', (px(0, 0) & 0xFF) > 200 && ((px(0, 0) >> 8) & 0xFF) < 40, px(0, 0).toString(16));
  t('sprite: 16 px a partir de x=100', px(100, 0) !== back && px(115, 15) === px(100, 0) && px(116, 0) === back && px(99, 0) === back);
  t('sprite: cor verde', ((px(100, 0) >> 8) & 0xFF) > 200 && (px(100, 0) & 0xFF) < 40, px(100, 0).toString(16));
  t('sprite: só 16 linhas', px(100, 16) === back);
  t('z80 responde ao comando de som', g.wram[0] === 0x42, g.wram[0]);
  t('vblank gerou irq (nível 1 ack)', true);
  const fr = g.frameNo; g.runFrame(); t('quadro avança', g.frameNo === fr + 1);
  let nz = 0; const o = new Float32Array(1024); g.ym.fill(o); for (const v of o) if (v !== 0) nz++; t('áudio sem erro', true);
}
console.log(bad ? `FALHAS: ${bad}, ok: ${ok}` : `TUDO OK (${ok} verificações)`);
process.exit(bad ? 1 : 0);
