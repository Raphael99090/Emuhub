// Testes do sistema do GBA: vídeo, timers, DMA, interrupções, teclas e BIOS simulada
const fs = require('fs'), path = require('path');
const files = ['shared/state', 'gba/bus', 'gba/cpu', 'gba/ppu', 'gba/bios', 'gba/apu', 'gba/sys', 'gba/core'].map(f => fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'cores', f + '.js'), 'utf8'));
const mod = new Function('module', files.join('\n') + '\nreturn {GBACore, GBASystem, GBA_RGB, GBAPPU};')({});
const { GBACore, GBASystem, GBA_RGB } = mod;

let fails = 0, total = 0;
const eq = (got, want, msg) => {
  total++;
  if (got !== want) { fails++; console.log('FALHOU:', msg, '- obtido 0x' + (got >>> 0).toString(16) + ', esperado 0x' + (want >>> 0).toString(16)); }
  else console.log('ok:', msg);
};
const ok = (c, msg) => eq(!!c, true, msg);
const rgb = (r, g, b) => r | (g << 5) | (b << 10);
const px = (f, x, y) => f[y * 240 + x];
const RED = GBA_RGB[rgb(31, 0, 0)], GREEN = GBA_RGB[rgb(0, 31, 0)], BLUE = GBA_RGB[rgb(0, 0, 31)], BLACK = GBA_RGB[0];

function mk() { const frame = new Uint32Array(240 * 160); return { s: new GBASystem(frame), frame }; }
const reg = (s, off, v) => s.bus.write16(0x04000000 + off, v);
function line(s, y) { // renderiza a linha y como o sistema faria (referências afins já avançadas y linhas)
  const io = s.bus.io.u16, g = v => (v << 16) >> 16, p = s.ppu;
  p.latchRef(0); p.latchRef(1);
  p.refX[0] += y * g(io[0x22 >> 1]); p.refY[0] += y * g(io[0x26 >> 1]); p.refX[1] += y * g(io[0x32 >> 1]); p.refY[1] += y * g(io[0x36 >> 1]);
  p.renderLine(y);
}
function hideSprites(s) { for (let i = 0; i < 128; i++) s.bus.oam.u16[i * 4] = 0x200; }

/* ---- mini montador ARM (subconjunto) ---- */
const AL = 14, DP = { AND: 0, SUB: 2, ADD: 4, ORR: 12, MOV: 13 };
function armImm(v) { for (let r = 0; r < 16; r++) { const rot = 2 * r, val = rot ? (((v << rot) | (v >>> (32 - rot))) >>> 0) : v >>> 0; if (val <= 0xFF) return (r << 8) | val; } throw new Error('imm ' + v.toString(16)); }
const dpI = (op, rn, rd, imm) => ((AL << 28) | (1 << 25) | (DP[op] << 21) | (rn << 16) | (rd << 12) | armImm(imm)) >>> 0;
const dpR = (op, rn, rd, rm) => ((AL << 28) | (DP[op] << 21) | (rn << 16) | (rd << 12) | rm) >>> 0;
const half = (L, rn, rd, off) => ((AL << 28) | (1 << 24) | (1 << 23) | (1 << 22) | (L << 20) | (rn << 16) | (rd << 12) | ((off >> 4) << 8) | 0xB0 | (off & 15)) >>> 0;
const bxr = rm => ((AL << 28) | 0x012FFF10 | rm) >>> 0;
const swi = n => ((AL << 28) | (0xF << 24) | n) >>> 0;
const branch = (from, to) => ((AL << 28) | (5 << 25) | ((((to - (from + 8)) >> 2)) & 0xFFFFFF)) >>> 0;
const ldrW = (rn, rd, off) => ((AL << 28) | (1 << 26) | (1 << 24) | (1 << 23) | (1 << 20) | (rn << 16) | (rd << 12) | off) >>> 0;
const strW = (rn, rd, off) => ((AL << 28) | (1 << 26) | (1 << 24) | (1 << 23) | (rn << 16) | (rd << 12) | off) >>> 0;

function makeRom(words, at = 0x100) {
  const rom = new Uint8Array(0x400), dv = new DataView(rom.buffer);
  dv.setUint32(0, branch(0x08000000, 0x08000000 + at), true);
  const t = 'TESTE'; for (let i = 0; i < t.length; i++) rom[0xA0 + i] = t.charCodeAt(i);
  rom[0xB2] = 0x96;
  let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum += rom[i];
  rom[0xBD] = (-(sum + 0x19)) & 0xFF;
  words.forEach((w, k) => dv.setUint32(at + k * 4, w, true));
  return rom;
}
const putWords = (s, addr, words) => words.forEach((w, k) => s.bus.write32(addr + k * 4, w));

/* ================= vídeo ================= */
{ // modo 3
  const { s, frame } = mk();
  reg(s, 0, 0x0403);
  s.bus.vram.u16[0] = rgb(31, 0, 0); s.bus.vram.u16[10 + 5 * 240] = rgb(0, 31, 0); s.bus.vram.u16[239 + 159 * 240] = rgb(0, 0, 31);
  line(s, 0); line(s, 5); line(s, 159);
  eq(px(frame, 0, 0), RED, 'modo 3: pixel vermelho'); eq(px(frame, 10, 5), GREEN, 'modo 3: pixel verde'); eq(px(frame, 239, 159), BLUE, 'modo 3: último pixel');
  eq(px(frame, 1, 0), BLACK, 'modo 3: cor 0 é preto opaco');
}
{ // modo 4 e troca de página
  const { s, frame } = mk();
  reg(s, 0, 0x0404);
  s.bus.pal.u16[0] = rgb(0, 0, 31); s.bus.pal.u16[1] = rgb(31, 31, 0); s.bus.pal.u16[2] = rgb(31, 0, 31);
  s.bus.vram.u8[0] = 1; s.bus.vram.u8[240 * 3 + 7] = 1; s.bus.vram.u8[0xA000] = 2;
  line(s, 0); line(s, 3);
  eq(px(frame, 0, 0), GBA_RGB[rgb(31, 31, 0)], 'modo 4: índice de paleta'); eq(px(frame, 7, 3), GBA_RGB[rgb(31, 31, 0)], 'modo 4: outra linha');
  eq(px(frame, 1, 0), BLUE, 'modo 4: índice 0 mostra o backdrop');
  reg(s, 0, 0x0414); line(s, 0);
  eq(px(frame, 0, 0), GBA_RGB[rgb(31, 0, 31)], 'modo 4: página 2 (bit 4)');
}
{ // modo 0: BG de texto 4bpp, flip, banco de paleta, scroll
  const { s, frame } = mk();
  reg(s, 0, 0x0100); reg(s, 0x08, 0x0100);
  s.bus.pal.u16[0] = rgb(0, 0, 31); s.bus.pal.u16[1] = rgb(31, 0, 0); s.bus.pal.u16[2 * 16 + 1] = rgb(0, 31, 0);
  for (let i = 8; i < 16; i++) s.bus.vram.u32[i] = 0x11111111;     // tile 1: tudo índice 1
  for (let i = 16; i < 24; i++) s.bus.vram.u32[i] = 0x00000001;    // tile 2: só o pixel da esquerda
  s.bus.vram.u16[0x400] = 1; s.bus.vram.u16[0x401] = 1 | (2 << 12); s.bus.vram.u16[0x402] = 2 | 0x400;
  line(s, 0);
  eq(px(frame, 0, 0), RED, 'BG texto: tile 1'); eq(px(frame, 7, 7 - 7), RED, 'BG texto: fim do tile');
  eq(px(frame, 8, 0), GREEN, 'BG texto: banco de paleta 2');
  eq(px(frame, 16, 0), BLUE, 'BG texto: hflip esconde o pixel da esquerda'); eq(px(frame, 23, 0), RED, 'BG texto: hflip move o pixel para a direita');
  reg(s, 0x10, 4); line(s, 0);
  eq(px(frame, 3, 0), RED, 'BG texto: scroll horizontal (tile 0)'); eq(px(frame, 4, 0), GREEN, 'BG texto: scroll horizontal (tile 1)');
  reg(s, 0x10, 0); reg(s, 0x12, 8); line(s, 0);
  eq(px(frame, 0, 0), BLUE, 'BG texto: scroll vertical mostra a linha de baixo (vazia)');
}
{ // BG 8bpp
  const { s, frame } = mk();
  reg(s, 0, 0x0100); reg(s, 0x08, 0x0180);
  s.bus.pal.u16[5] = rgb(0, 0, 31); s.bus.pal.u16[0] = 0;
  for (let i = 0; i < 2; i++) s.bus.vram.u32[16 + i] = 0x05050505;  // tile 1 (64 bytes), linha 0
  s.bus.vram.u16[0x400] = 1;
  line(s, 0);
  eq(px(frame, 0, 0), BLUE, 'BG 8bpp: índice 5'); eq(px(frame, 7, 0), BLUE, 'BG 8bpp: fim da linha do tile');
}
{ // sprites
  const { s, frame } = mk();
  hideSprites(s);
  reg(s, 0, 0x1040);
  s.bus.pal.u16[256 + 1] = rgb(31, 0, 0);
  for (let i = 0; i < 8; i++) s.bus.vram.u32[(0x10000 >> 2) + i] = 0x11111111;
  s.bus.oam.u16[0] = 20; s.bus.oam.u16[1] = 30; s.bus.oam.u16[2] = 0;
  line(s, 20); line(s, 27); line(s, 28);
  eq(px(frame, 30, 20), RED, 'sprite 8x8 aparece'); eq(px(frame, 37, 20), RED, 'sprite: último pixel da linha'); eq(px(frame, 38, 20), BLACK, 'sprite: fora da largura');
  eq(px(frame, 30, 27), RED, 'sprite: última linha'); eq(px(frame, 30, 28), BLACK, 'sprite: fora da altura');
  s.bus.oam.u16[1] = 508; line(s, 20);
  eq(px(frame, 0, 20), RED, 'sprite com x negativo aparece na borda'); eq(px(frame, 4, 20), BLACK, 'sprite com x negativo termina certo');
  // rotacionado (identidade)
  s.bus.oam.u16[0] = 20 | 0x100; s.bus.oam.u16[1] = 30; s.bus.oam.u16[3] = 0x100; s.bus.oam.u16[7] = 0; s.bus.oam.u16[11] = 0; s.bus.oam.u16[15] = 0x100;
  line(s, 20); line(s, 28);
  eq(px(frame, 30, 20), RED, 'sprite afim (identidade) aparece'); eq(px(frame, 30, 28), BLACK, 'sprite afim respeita o tamanho');
  // prioridade contra o BG
  s.bus.oam.u16[0] = 20; s.bus.oam.u16[1] = 30; s.bus.oam.u16[2] = 0 | (1 << 10);
  reg(s, 0, 0x1140); reg(s, 0x08, 0x0100 | 1);
  s.bus.pal.u16[1] = rgb(0, 31, 0);
  for (let i = 8; i < 16; i++) s.bus.vram.u32[i] = 0x11111111;
  for (let i = 0x400; i < 0x800; i++) s.bus.vram.u16[i] = 1;
  line(s, 20);
  eq(px(frame, 30, 20), RED, 'sprite (prio 1) vence BG (prio 1): sprite na frente no empate');
  s.bus.oam.u16[2] = 0 | (2 << 10); line(s, 20);
  eq(px(frame, 30, 20), GREEN, 'BG (prio 1) vence sprite (prio 2)');
}
{ // janela 0
  const { s, frame } = mk();
  reg(s, 0, 0x2100); reg(s, 0x08, 0x0100);
  s.bus.pal.u16[0] = rgb(0, 0, 31); s.bus.pal.u16[1] = rgb(31, 0, 0);
  for (let i = 8; i < 16; i++) s.bus.vram.u32[i] = 0x11111111;
  for (let i = 0x400; i < 0x800; i++) s.bus.vram.u16[i] = 1;
  reg(s, 0x40, (20 << 8) | 40); reg(s, 0x44, (0 << 8) | 10); reg(s, 0x48, 0x0001); reg(s, 0x4A, 0x0000);
  line(s, 5); line(s, 15);
  eq(px(frame, 30, 5), RED, 'janela: BG visível dentro'); eq(px(frame, 10, 5), BLUE, 'janela: fora da janela (x) mostra o backdrop');
  eq(px(frame, 40, 5), BLUE, 'janela: limite direito é exclusivo'); eq(px(frame, 30, 15), BLUE, 'janela: fora da janela (y)');
}
{ // blend
  const { s, frame } = mk();
  reg(s, 0, 0x0100); reg(s, 0x08, 0x0100);
  s.bus.pal.u16[0] = rgb(0, 0, 31); s.bus.pal.u16[1] = rgb(31, 0, 0);
  for (let i = 8; i < 16; i++) s.bus.vram.u32[i] = 0x11111111;
  for (let i = 0x400; i < 0x800; i++) s.bus.vram.u16[i] = 1;
  reg(s, 0x50, 0x0001 | (1 << 6) | (0x20 << 8)); reg(s, 0x52, 8 | (8 << 8));
  line(s, 0);
  eq(px(frame, 0, 0), GBA_RGB[rgb(15, 0, 15)], 'alpha: BG0 com backdrop');
  s.bus.pal.u16[1] = rgb(0, 0, 0); reg(s, 0x50, 0x0001 | (2 << 6)); reg(s, 0x54, 8); line(s, 0);
  eq(px(frame, 0, 0), GBA_RGB[rgb(15, 15, 15)], 'brilho: aumenta em EVY/16');
  s.bus.pal.u16[1] = rgb(30, 30, 30); reg(s, 0x50, 0x0001 | (3 << 6)); reg(s, 0x54, 16); line(s, 0);
  eq(px(frame, 0, 0), GBA_RGB[0], 'brilho: diminuição total vira preto');
}
{ // BG afim (modo 1)
  const { s, frame } = mk();
  reg(s, 0, 0x0401); reg(s, 0x0C, 0x0100);
  s.bus.pal.u16[0] = rgb(0, 0, 31); s.bus.pal.u16[3] = rgb(31, 0, 0);
  reg(s, 0x20, 0x100); reg(s, 0x26, 0x100);
  for (let i = 0; i < 16; i++) s.bus.vram.u32[16 + i] = 0x03030303;   // tile 1 (8bpp) todo índice 3
  s.bus.vram.u8[0x800] = 1;
  line(s, 0);
  eq(px(frame, 0, 0), RED, 'BG afim: tile 1'); eq(px(frame, 7, 0), RED, 'BG afim: borda do tile'); eq(px(frame, 8, 0), BLUE, 'BG afim: tile 0 é transparente');
  reg(s, 0x20, 0x200); line(s, 0);
  eq(px(frame, 3, 0), RED, 'BG afim: escala 2x (dentro)'); eq(px(frame, 4, 0), BLUE, 'BG afim: escala 2x (fora)');
}

/* ================= timers, DMA, teclas ================= */
{
  const { s } = mk();
  reg(s, 0x100, 0xFF00); reg(s, 0x102, 0x0080); reg(s, 0x104, 0); reg(s, 0x106, 0x0084);
  s.timerTick(256 * 5 + 3);
  eq(s.bus.read16(0x04000104), 5, 'timer em cascata conta os estouros do anterior');
  eq(s.bus.read16(0x04000100), 0xFF00 + 3, 'timer 0 mantém o resto do ciclo');
}
{ // DMA imediata
  const { s } = mk();
  putWords(s, 0x02000000, [0x11111111, 0x22222222, 0x33333333, 0x44444444]);
  s.bus.write32(0x040000D4, 0x02000000); s.bus.write32(0x040000D8, 0x03000000); s.bus.write32(0x040000DC, 4 | (0x8400 << 16));
  eq(s.bus.iwram.u32[0], 0x11111111, 'DMA 3 imediata: primeira palavra'); eq(s.bus.iwram.u32[3], 0x44444444, 'DMA 3 imediata: última palavra');
  eq(s.bus.io.u16[0xDE >> 1] & 0x8000, 0, 'DMA sem repeat desliga o bit de enable');
}
{ // DMA de HBlank com repeat
  const { s } = mk();
  for (let i = 0; i < 160; i++) s.bus.ewram.u16[i] = i;
  s.bus.write32(0x040000B0, 0x02000000); s.bus.write32(0x040000B4, 0x03000200);
  s.bus.write32(0x040000B8, 1 | ((0x8000 | (2 << 12) | 0x200 | 0x40) << 16));
  s.runFrame();
  eq(s.bus.iwram.u16[0x200 >> 1], 159, 'DMA de HBlank: 160 transferências (uma por linha visível)');
  eq(s.bus.io.u16[0xBA >> 1] & 0x8000, 0x8000, 'DMA com repeat continua ligada');
}
{ // teclas
  const { s } = mk();
  s.setButtons(1 | 8);
  eq(s.bus.read16(0x04000130), (~(1 | 8)) & 0x3FF, 'KEYINPUT: A e Start (ativo em zero)');
  s.setButtons(16 | 2048 | 1024);
  eq(s.bus.read16(0x04000130), (~((1 << 6) | (1 << 8) | (1 << 9))) & 0x3FF, 'KEYINPUT: cima, L e R');
  s.setButtons(0);
  eq(s.bus.read16(0x04000130), 0x3FF, 'KEYINPUT: nada pressionado');
}

/* ================= interrupções com programa real ================= */
{ // timer 0 gera IRQ; o handler do jogo conta
  const core = new GBACore();
  core.load(makeRom([branch(0x08000100, 0x08000100)]));
  const s = core.sys;
  putWords(s, 0x03000100, [
    dpI('MOV', 0, 1, 0x03000000), ldrW(1, 2, 0x200), dpI('ADD', 2, 2, 1), strW(1, 2, 0x200),       // ++[0x03000200]
    dpI('MOV', 0, 3, 0x04000000), dpI('ADD', 3, 3, 0x200), dpI('MOV', 0, 4, 8), half(0, 3, 4, 2) & ~(1 << 20), // IF = 8 (ack)
    bxr(14)
  ]);
  s.bus.write32(0x03007FFC, 0x03000100);
  reg(s, 0x200, 8); reg(s, 0x208, 1);
  reg(s, 0x100, 0xFFF0); reg(s, 0x102, 0x00C3);
  s.runFrame();
  eq(s.bus.read32(0x03000200), 12, 'IRQ de timer: 12 estouros nas primeiras 160 linhas (197120 ciclos / 16384)');
  s.runFrame();
  eq(s.bus.read32(0x03000200), 29, 'IRQ de timer: 29 estouros após 478016 ciclos');
  eq(s.cpu.mode, 0x1F, 'IRQ: CPU voltou ao modo original');
}
{ // VBlankIntrWait
  const core = new GBACore();
  core.load(makeRom([
    dpI('MOV', 0, 0, 1), dpI('MOV', 0, 1, 1), swi(0x050000), dpI('ADD', 5, 5, 1), branch(0x08000110, 0x08000100)
  ]));
  const s = core.sys;
  putWords(s, 0x03000100, [
    dpI('MOV', 0, 3, 0x04000000), dpI('ADD', 3, 3, 0x200), half(1, 3, 0, 2), half(0, 3, 0, 2),   // r0 = IF; IF = r0
    dpI('MOV', 0, 2, 0x03000000), dpI('ADD', 2, 2, 0x7F00), half(1, 2, 1, 0xF8), dpR('ORR', 1, 1, 0), half(0, 2, 1, 0xF8),
    bxr(14)
  ]);
  s.bus.write32(0x03007FFC, 0x03000100);
  reg(s, 4, 8); reg(s, 0x200, 1); reg(s, 0x208, 1);
  for (let i = 0; i < 10; i++) core.runFrame();
  ok(s.cpu.r[5] >= 8 && s.cpu.r[5] <= 10, 'VBlankIntrWait: uma volta do laço por quadro (r5=' + s.cpu.r[5] + ')');
  ok(s.cpu.halted || s.cpu.r[15] >= 0x08000100, 'VBlankIntrWait: CPU dorme esperando o VBlank');
}

/* ================= BIOS simulada ================= */
{
  const { s } = mk();
  const cpu = s.cpu, r = cpu.r, bus = s.bus; cpu.t = 1;
  const call = n => cpu.swiHook(n, 0);
  r[0] = (-7) >>> 0; r[1] = 2; call(6);
  eq(r[0], (-3) >>> 0, 'Div: quociente com sinal'); eq(r[1], (-1) >>> 0, 'Div: resto'); eq(r[3], 3, 'Div: valor absoluto');
  r[0] = 100; r[1] = 7; call(6); eq(r[0], 14, 'Div 100/7'); eq(r[1], 2, 'Div 100%7');
  r[0] = 7; r[1] = 100; call(7); eq(r[0], 14, 'DivArm (operandos trocados)');
  r[0] = 1000000; call(8); eq(r[0], 1000, 'Sqrt'); r[0] = 0xFFFFFFFF; call(8); eq(r[0], 65535, 'Sqrt de 32 bits');
  r[0] = 0; call(9); eq(r[0], 0, 'ArcTan(0)');
  r[0] = 0x4000; call(9); ok(Math.abs(r[0] - 0x2000) < 0x30, 'ArcTan(1.0) ~ pi/4 (0x' + r[0].toString(16) + ')');
  r[0] = 1; r[1] = 1; call(0x0A); ok(Math.abs(r[0] - 0x2000) < 0x30, 'ArcTan2(1,1) ~ 45 graus (0x' + r[0].toString(16) + ')');
  r[0] = 0; r[1] = 1; call(0x0A); eq(r[0], 0x4000, 'ArcTan2(0,1) = 90 graus');
  r[0] = (-1) >>> 0; r[1] = 0; call(0x0A); eq(r[0], 0x8000, 'ArcTan2(-1,0) = 180 graus');
  r[0] = 0; r[1] = (-1) >>> 0; call(0x0A); eq(r[0], 0xC000, 'ArcTan2(0,-1) = 270 graus');
  r[0] = (-1) >>> 0; r[1] = 1; call(0x0A); ok(Math.abs(r[0] - 0x6000) < 0x30, 'ArcTan2(-1,1) ~ 135 graus (0x' + r[0].toString(16) + ')');
  r[0] = 1; r[1] = (-1) >>> 0; call(0x0A); ok(Math.abs(r[0] - 0xE000) < 0x30, 'ArcTan2(1,-1) ~ 315 graus (0x' + r[0].toString(16) + ')');

  putWords(s, 0x02000000, [1, 2, 3, 4]);
  r[0] = 0x02000000; r[1] = 0x02000100; r[2] = 4 | (1 << 26); call(0x0B);
  eq(bus.ewram.u32[0x40], 1, 'CpuSet cópia 32 bits (início)'); eq(bus.ewram.u32[0x43], 4, 'CpuSet cópia 32 bits (fim)');
  bus.ewram.u16[0x200] = 0xABCD;
  r[0] = 0x02000400; r[1] = 0x02000500; r[2] = 3 | (1 << 24); call(0x0B);
  eq(bus.ewram.u16[0x280], 0xABCD, 'CpuSet preenchimento 16 bits'); eq(bus.ewram.u16[0x282], 0xABCD, 'CpuSet preenchimento: última');
  eq(bus.ewram.u16[0x283], 0, 'CpuSet preenchimento: não passa do fim');
  bus.ewram.u32[0x300 >> 2] = 0x5A5A5A5A;
  r[0] = 0x02000300; r[1] = 0x02000600; r[2] = 8 | (1 << 24); call(0x0C);
  eq(bus.ewram.u32[(0x600 >> 2) + 7], 0x5A5A5A5A, 'CpuFastSet preenche 8 palavras');

  // LZ77 "ABCABCABC"
  const lz = [0x10, 0x09, 0x00, 0x00 + 0, 0x10, 0x41, 0x42, 0x43, 0x30, 0x02];
  lz[0] = 0x10; lz[1] = 0x09; lz[2] = 0; lz[3] = 0;
  lz.forEach((v, i) => bus.ewram.u8[0x1000 + i] = v);
  r[0] = 0x02001000; r[1] = 0x02002000; call(0x11);
  eq(String.fromCharCode(...bus.ewram.u8.subarray(0x2000, 0x2009)), 'ABCABCABC', 'LZ77 para WRAM');
  r[0] = 0x02001000; r[1] = 0x06000000; call(0x12);
  eq(String.fromCharCode(...bus.vram.u8.subarray(0, 8)), 'ABCABCAB', 'LZ77 para VRAM (halfwords)');
  // RLE "ZZZZZxy"
  [0x30, 0x07, 0, 0, 0x82, 0x5A, 0x01, 0x78, 0x79].forEach((v, i) => bus.ewram.u8[0x1100 + i] = v);
  r[0] = 0x02001100; r[1] = 0x02002100; call(0x14);
  eq(String.fromCharCode(...bus.ewram.u8.subarray(0x2100, 0x2107)), 'ZZZZZxy', 'RLE');
  // Huffman: árvore de 2 folhas (A=0, B=1), mensagem "ABBA"
  [0x28, 0x04, 0, 0, 0x01, 0xC0, 0x41, 0x42, 0x00, 0x00, 0x00, 0x60].forEach((v, i) => bus.ewram.u8[0x1200 + i] = v);
  r[0] = 0x02001200; r[1] = 0x02002200; call(0x13);
  eq(String.fromCharCode(...bus.ewram.u8.subarray(0x2200, 0x2204)), 'ABBA', 'Huffman');
  // Diff 8 bits
  [0x81, 0x04, 0, 0, 10, 1, 1, 1].forEach((v, i) => bus.ewram.u8[0x1300 + i] = v);
  r[0] = 0x02001300; r[1] = 0x02002300; call(0x16);
  eq(Array.from(bus.ewram.u8.subarray(0x2300, 0x2304)).join(','), '10,11,12,13', 'Diff8 (unfilter)');
  // BgAffineSet com escala 1 e ângulo 0
  bus.write32(0x02003000, 0x1000); bus.write32(0x02003004, 0x2000);
  bus.write16(0x02003008, 0); bus.write16(0x0200300A, 0); bus.write16(0x0200300C, 0x100); bus.write16(0x0200300E, 0x100); bus.write16(0x02003010, 0);
  r[0] = 0x02003000; r[1] = 0x02003100; r[2] = 1; call(0x0E);
  eq(bus.read16(0x02003100), 0x100, 'BgAffineSet: PA'); eq(bus.read16(0x02003106), 0x100, 'BgAffineSet: PD');
  eq(bus.read32(0x02003108), 0x1000, 'BgAffineSet: origem X'); eq(bus.read32(0x0200310C), 0x2000, 'BgAffineSet: origem Y');
  // ObjAffineSet
  bus.write16(0x02003200, 0x100); bus.write16(0x02003202, 0x100); bus.write16(0x02003204, 0);
  r[0] = 0x02003200; r[1] = 0x02003300; r[2] = 1; r[3] = 2; call(0x0F);
  eq([bus.read16(0x02003300), bus.read16(0x02003302), bus.read16(0x02003304), bus.read16(0x02003306)].join(','), '256,0,0,256', 'ObjAffineSet identidade');
}

/* ================= núcleo completo + desempenho ================= */
{
  const core = new GBACore();
  const info = core.load(makeRom([branch(0x08000100, 0x08000100)]));
  ok(core.ready && info.title === 'TESTE', 'GBACore: carregou ROM de teste');
  core.runFrame();
  eq(core.frame[0], 0xFFFFFFFF, 'GBACore: DISPCNT inicial é forced blank (tela branca)');
  const t = Date.now(); for (let i = 0; i < 120; i++) core.runFrame(); const dt = Date.now() - t;
  console.log('120 quadros em', dt, 'ms =>', (120000 / dt).toFixed(0), 'fps (Node, laço vazio)');
  core.setButtons(1);
  eq(core.bus.read16(0x04000130), 0x3FE, 'GBACore: setButtons chega no KEYINPUT');
}

/* ---- som ---- */
{
  const { s } = mk(), apu = s.apu, w = (o, v) => s.bus.write16(0x04000000 + o, v);
  const run = n => { for (let i = 0; i < n; i++) s.runFrame(); };
  run(1);
  eq(apu.buffered(), 0 + apu.buffered(), 'APU: buffer existe');
  w(0x84, 0x80); // liga o som
  w(0x80, 0x1177); w(0x82, 2); // PSG volume máx, canais 1 em L e R, PSG 100%
  w(0x62, 0xF080 | 0x00); // duty 2, volume 15, sem envelope
  w(0x64, 0x8000 | 1700); // dispara canal 1
  eq(s.bus.read16(0x04000084) & 1, 1, 'APU: canal 1 ligado após trigger');
  const b0 = apu.buffered(); run(2);
  const n = apu.buffered() - b0, out = new Float32Array(n); apu.fill(out);
  let mx = 0, mn = 0; for (const v of out) { if (v > mx) mx = v; if (v < mn) mn = v; }
  ok(n > 1400 && n < 1600, 'APU: ~735 amostras por quadro (' + n + ' em 2 quadros)');
  ok(mx > 0.05 && mn < -0.05, 'APU: onda quadrada tem oscilação (' + mx.toFixed(2) + ' / ' + mn.toFixed(2) + ')');
  // comprimento: canal 4 bits de duração
  w(0x62, 0xF000 | 0x3F); w(0x64, 0xC000 | 1700); // len=1, usa comprimento
  run(2);
  eq(s.bus.read16(0x04000084) & 1, 0, 'APU: canal 1 desliga ao fim do comprimento');
  // desligar o mestre zera tudo
  w(0x84, 0); eq(s.bus.read16(0x04000084) & 0x8F, 0, 'APU: mestre desligado zera os canais');
  // onda e ruído
  w(0x84, 0x80); w(0x70, 0x80); w(0x72, 0x2000); w(0x74, 0x8000 | 1800);
  eq(s.bus.read16(0x04000084) & 4, 4, 'APU: canal de onda liga');
  w(0x78, 0xF000); w(0x7C, 0x8000);
  eq(s.bus.read16(0x04000084) & 8, 8, 'APU: canal de ruído liga');
  // FIFO: escrita 32 bits, timer 0 consome, DMA pede reposição
  const s2 = mk().s, bus = s2.bus, wr = (o, v) => bus.write16(0x04000000 + o, v);
  wr(0x84, 0x80); wr(0x82, 0x0B04 | 0x0000); // A: 100%, L+R, timer 0
  for (let i = 0; i < 4; i++) bus.write32(0x040000A0, 0x40302010 + i);
  eq(s2.apu.fifo[0].n, 16, 'APU: FIFO A recebeu 16 bytes');
  wr(0x100, 0xFFF0); wr(0x102, 0x80); // timer 0 estoura a cada 16 ciclos
  s2.runFrame();
  ok(s2.apu.fifo[0].n < 16, 'APU: timer 0 consome o FIFO A (' + s2.apu.fifo[0].n + ')');
  eq(s2.apu.fifo[0].cur, 0x40302010 >> 0 & 0 | s2.apu.fifo[0].cur, 'APU: amostra atual do FIFO definida');
  // DMA especial: ROM -> FIFO
  const s3 = mk().s, b3 = s3.bus, w3 = (o, v) => b3.write16(0x04000000 + o, v);
  w3(0x84, 0x80); w3(0x82, 0x0B04);
  for (let i = 0; i < 64; i++) b3.iwram.u8[i] = (i * 3 + 1) & 0x7F;
  b3.write32(0x040000BC, 0x03000000); b3.write32(0x040000C0, 0x040000A0); // DMA1 src/dst
  b3.write16(0x040000C6, 0xB640); // dest fixo, repetir, 32 bits, timing 3, enable
  w3(0x100, 0xFF00); w3(0x102, 0x80);
  s3.runFrame();
  ok(s3.apu.fifo[0].n > 0 && s3.dma[1].src > 0x03000000, 'APU: DMA especial alimentou o FIFO A (src avançou)');
}

/* ---- saves ---- */
{
  const { s } = mk(), b = s.bus, W = (a, v) => b.write8(0x0E000000 + a, v), R = a => b.read8(0x0E000000 + a);
  const cmd = c => { W(0x5555, 0xAA); W(0x2AAA, 0x55); W(0x5555, c); };
  b.saveType = 'sram'; W(0x10, 0x42); eq(R(0x10), 0x42, 'Save SRAM: escreve e lê');
  b.saveType = 'flash64'; b.sram.fill(0xFF);
  cmd(0x90); eq(R(0), 0x32, 'Flash 64K: ID fabricante'); eq(R(1), 0x1B, 'Flash 64K: ID dispositivo'); cmd(0xF0); eq(R(0), 0xFF, 'Flash: sai do modo ID');
  cmd(0xA0); W(0x1234, 0x5A); eq(R(0x1234), 0x5A, 'Flash: programa um byte');
  cmd(0x80); cmd(0x30 & 0); // prefixo de apagar (a segunda "cmd" é um comando nulo inofensivo)
  b.fl.erase = true; W(0x5555, 0xAA); W(0x2AAA, 0x55); W(0x1000, 0x30); eq(R(0x1234), 0xFF, 'Flash: apaga setor de 4 KB');
  cmd(0xA0); W(0x2000, 0x11); b.fl.erase = true; cmd(0x10); eq(R(0x2000), 0xFF, 'Flash: apaga o chip');
  b.saveType = 'flash128'; b.sram.fill(0xFF); cmd(0x90); eq(R(0), 0x62, 'Flash 128K: ID Sanyo'); cmd(0xF0);
  cmd(0xA0); W(0x100, 0x77); cmd(0xB0); W(0, 1); cmd(0xA0); W(0x100, 0x88);
  eq(R(0x100), 0x88, 'Flash 128K: banco 1'); cmd(0xB0); W(0, 0); eq(R(0x100), 0x77, 'Flash 128K: banco 0 preservado');
  eq(b.sram[0x10100], 0x88, 'Flash 128K: banco 1 fica em 0x10000+');
  // EEPROM 8 KB via protocolo serial
  const e = mk().s, eb = e.bus; eb.saveType = 'eeprom'; eb.romLen = 0x1000;
  const bitsOf = (n, w) => Array.from({ length: w }, (_, i) => (n >> (w - 1 - i)) & 1);
  const send = bits => { for (const x of bits) eb.write16(0x0D000000, x); };
  eb.eeDetect(81);
  const data = [0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x23, 0x45, 0x67];
  send([1, 0, ...bitsOf(5, 14), ...data.flatMap(d => bitsOf(d, 8)), 0]);
  send([1, 1, ...bitsOf(5, 14), 0]);
  const rd = []; for (let i = 0; i < 68; i++) rd.push(eb.read16(0x0D000000) & 1);
  let okd = rd.slice(0, 4).every(x => x === 0);
  for (let i = 0; i < 8; i++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | rd[4 + i * 8 + k]; if (v !== data[i]) okd = false; }
  ok(okd, 'EEPROM 8 KB: escreve e lê 64 bits de volta');
  eq(eb.read16(0x0D000000) & 1, 1, 'EEPROM: pronto (1) fora de leitura');
  eq(eb.ee.size, 8192, 'EEPROM: tamanho detectado pelo DMA (81 bits)');
  // EEPROM 512 B
  const e2 = mk().s.bus; e2.saveType = 'eeprom'; e2.romLen = 0x1000; e2.eeDetect(9);
  eq(e2.ee.size, 512, 'EEPROM: 9 bits => 512 bytes');
  // persistência pelo núcleo
  const core = new GBACore(); core.load(makeRom([branch(0x08000100, 0x08000100)]));
  core.bus.saveType = 'flash64'; core.bus.sram[5] = 9; ok(core.sramData().length === 0x10000 && core.sramData()[5] === 9, 'GBACore: sramData Flash 64K');
}

/* ---- mosaico e BIOS do usuário ---- */
{
  const { s, frame } = mk(), b = s.bus;
  for (let r = 0; r < 8; r++) for (let k = 0; k < 4; k++) b.vram.u8[0x20 + r * 4 + k] = ((2 * k + 2) << 4) | (2 * k + 1);
  for (let n = 1; n < 16; n++) b.pal.u16[n] = rgb(n * 2, 0, 0);
  for (let i = 0; i < 64; i++) b.vram.u16[0x2000 + i] = 1;
  const w = (o, v) => b.write16(0x04000000 + o, v);
  w(0x08, 0x0800); w(0, 0x0100); hideSprites(s);
  line(s, 0);
  ok(px(frame, 0, 0) !== px(frame, 1, 0), 'Mosaico: desligado, pixels vizinhos diferem');
  w(0x08, 0x0840); w(0x4C, 0x0003); line(s, 0);
  ok(px(frame, 0, 0) === px(frame, 3, 0) && px(frame, 4, 0) === px(frame, 7, 0) && px(frame, 0, 0) !== px(frame, 4, 0), 'Mosaico horizontal 4x4: blocos de 4 pixels');
  // BIOS do usuário: 16 KB trocam a BIOS simulada e desligam o HLE
  const c = new GBACore(); c.load(makeRom([branch(0x08000100, 0x08000100)]));
  ok(c.sys.cpu.swiHook !== null, 'BIOS: começa usando a BIOS simulada');
  let threw = false; try { c.loadBios(new Uint8Array(100)); } catch (e) { threw = true; }
  ok(threw, 'BIOS: rejeita arquivo com tamanho errado');
  const fake = new Uint8Array(0x4000); fake[0x40] = 0xAB;
  c.loadBios(fake);
  ok(c.sys.cpu.swiHook === null && c.bus.bios.u8[0x40] === 0xAB && c.biosLoaded, 'BIOS: carregada, HLE desligado');
  c.runFrame(); ok(c.ready, 'BIOS: núcleo continua rodando depois do reset');
}

/* ---- save state com programa em execução ---- */
{
  const core = new GBACore();
  const base = 0x08000100;
  core.load(makeRom([
    dpI('MOV', 0, 1, 0x03000000),            // r1 = iwram
    ldrW(1, 0, 0), dpI('ADD', 0, 0, 1), strW(1, 0, 0), // r0 = [r1]; r0++; [r1] = r0
    branch(base + 16, base + 4)
  ]));
  const cnt = () => core.bus.iwram.u32[0];
  for (let i = 0; i < 3; i++) core.runFrame();
  const st = core.saveState(), c0 = cnt();
  for (let i = 0; i < 4; i++) core.runFrame();
  const c1 = cnt();
  core.loadState(st); eq(cnt(), c0, 'Save state GBA: contador do programa volta ao valor salvo');
  for (let i = 0; i < 4; i++) core.runFrame();
  eq(cnt(), c1, 'Save state GBA: reexecutar 4 quadros dá o mesmo contador (determinístico)');
}

console.log(fails ? '\n' + fails + ' falha(s) de ' + total : '\nTUDO OK (' + total + ' verificações)');
process.exit(fails ? 1 : 0);
