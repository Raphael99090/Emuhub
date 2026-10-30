// Testes do Master System / Game Gear: Z80, VDP, PSG, mapeadores, cheats e estados.
// ZEX=/caminho/para/z80/roms roda também prelim, zexdoc e zexall (demora vários minutos).
const fs = require('fs'), path = require('path');
const files = ['shared/state', 'sms/z80', 'sms/vdp', 'sms/psg', 'sms/sms', 'sms/core'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'cores', f + '.js'), 'utf8'));
const { Z80, SMS, SMSCore, GGCore } = new Function('module', files.join('\nvar __d=0;\n') + '\nreturn {Z80, SMS, SMSCore, GGCore};')({});

let fails = 0, total = 0;
const eq = (got, want, msg) => { total++; if (got !== want) { fails++; console.log('FALHOU:', msg, '- obtido 0x' + (got >>> 0).toString(16) + ', esperado 0x' + (want >>> 0).toString(16)); } else console.log('ok:', msg); };
const ok = (c, msg) => eq(!!c, true, msg);

// ---- mini montador de ROM de teste ----
function build(fn, size) {
  const rom = new Uint8Array(size || 0x8000); let pc = 0;
  const A = { org: a => { pc = a; }, emit: (...b) => { for (const x of b) rom[pc++] = x; }, get pc() { return pc; } };
  A.vreg = (r, v) => A.emit(0x3E, v, 0xD3, 0xBF, 0x3E, 0x80 | r, 0xD3, 0xBF);
  A.vaddr = (a, code) => A.emit(0x3E, a & 255, 0xD3, 0xBF, 0x3E, (a >> 8) | (code << 6), 0xD3, 0xBF);
  A.vdata = (...b) => { for (const x of b) A.emit(0x3E, x, 0xD3, 0xBE); };
  A.out = (p, v) => A.emit(0x3E, v, 0xD3, p);
  // vetor de reset + IRQ (conta quadros em C000) + NMI (conta em C001)
  A.org(0); A.emit(0xF3, 0xED, 0x56, 0xC3, 0x00, 0x01);
  A.org(0x38); A.emit(0xF5, 0xDB, 0xBF, 0x3A, 0x00, 0xC0, 0x3C, 0x32, 0x00, 0xC0, 0xF1, 0xFB, 0xED, 0x4D);
  A.org(0x66); A.emit(0xF5, 0x3A, 0x01, 0xC0, 0x3C, 0x32, 0x01, 0xC0, 0xF1, 0xED, 0x45);
  A.org(0x100); A.emit(0x31, 0xF0, 0xDF);
  fn(A);
  A.emit(0xFB, 0x76, 0x18, 0xFD); // EI; HALT; JR -3
  return rom;
}
const clearVram = () => {}; // a VRAM já começa zerada (limpar em laço gasta ~11 quadros)
function scene(A, extra) {
  A.vreg(0, 0x04); A.vreg(1, 0x00); A.vreg(2, 0xFF); A.vreg(5, 0xFF); A.vreg(6, 0xFB); A.vreg(7, 0x00); A.vreg(8, 0); A.vreg(9, 0); A.vreg(10, 0xFF);
  A.vaddr(0, 1); clearVram(A);
  A.vaddr(0, 3); A.vdata(0x00, 0x3F, 0x03, 0x30); // cores 0..3: preto, branco, vermelho, azul
  A.vaddr(17, 3); A.vdata(0x0C);                  // sprite: cor 1 = verde
  const solid = (c) => { const r = []; for (let i = 0; i < 8; i++) r.push((c & 1) ? 255 : 0, (c & 2) ? 255 : 0, 0, 0); return r; };
  A.vaddr(32, 1); A.vdata(...solid(1), ...solid(2), ...solid(3)); // tiles 1, 2, 3
  A.vaddr(0x3800, 1); A.vdata(1, 0, 2, 0, 3, 0);                  // 3 primeiros tiles da linha 0
  A.vaddr(0x3F00, 1); A.vdata(63, 0xD0);                          // sprite 0 em y=64
  A.vaddr(0x3F80, 1); A.vdata(100, 1);                            // x=100, tile 1
  if (extra) extra(A);
  A.vreg(1, 0x60);
  A.out(0x7F, 0x8E); A.out(0x7F, 0x0F); A.out(0x7F, 0x90);        // PSG: tom no canal 0, volume máximo
}
const W = 0xFFFFFFFF, RED = 0xFF0000FF, BLUE = 0xFFFF0000, GREEN = 0xFF00FF00;

// ---- 1. quadros, IRQ, vídeo e sprites ----
let m = new SMS(false); m.load(build(A => scene(A)));
for (let i = 0; i < 5; i++) m.runFrame();
const f = m.vdp.frame;
ok(m.ram[0] >= 4 && m.ram[0] <= 5, 'interrupção de quadro roda uma vez por quadro (' + m.ram[0] + ')');
eq(f[2 * 256 + 4], W, 'tile 1 (cor 1 = branco) na coluna 0');
eq(f[2 * 256 + 12], RED, 'tile 2 (cor 2 = vermelho) na coluna 1');
eq(f[2 * 256 + 20], BLUE, 'tile 3 (cor 3 = azul) na coluna 2');
eq(f[66 * 256 + 104], GREEN, 'sprite 8x8 verde em (100,64)');
eq(f[63 * 256 + 104] === GREEN, false, 'sprite não aparece uma linha acima');
eq(f[72 * 256 + 104] === GREEN, false, 'sprite tem só 8 linhas');
let buf = new Float32Array(2048), any = false; m.psg.fill(buf); for (const v of buf) if (Math.abs(v) > 0.01) any = true;
ok(any, 'PSG gera som no canal 0');

// ---- 2. rolagem horizontal e máscara da 1ª coluna ----
m = new SMS(false); m.load(build(A => scene(A, A2 => A2.vreg(8, 8))));
for (let i = 0; i < 3; i++) m.runFrame();
eq(m.vdp.frame[2 * 256 + 4], 0xFF000000, 'rolagem X=8: coluna 0 mostra o fim do mapa (vazio)');
eq(m.vdp.frame[2 * 256 + 12], W, 'rolagem X=8: tile 1 vai para a coluna 1');
m = new SMS(false); m.load(build(A => scene(A, A2 => A2.vreg(0, 0x24))));
for (let i = 0; i < 3; i++) m.runFrame();
eq(m.vdp.frame[2 * 256 + 4], 0xFF000000, 'R0 bit5 esconde a coluna 0 (cor de fundo)');
eq(m.vdp.frame[2 * 256 + 12], RED, '...mas as outras colunas continuam');

// ---- 3. rolagem vertical ----
m = new SMS(false); m.load(build(A => scene(A, A2 => { A2.vaddr(0x3800 + 64, 1); A2.vdata(3, 0); A2.vreg(9, 8); })));
for (let i = 0; i < 3; i++) m.runFrame();
eq(m.vdp.frame[0 * 256 + 4], BLUE, 'rolagem Y=8: a linha 1 do mapa sobe para o topo');

// ---- 4. interrupção de linha: R10=15 => 12 por quadro ----
m = new SMS(false); m.load(build(A => scene(A, A2 => { A2.vreg(10, 15); A2.vreg(0, 0x14); })));
m.runFrame();
const c0 = m.ram[0]; m.runFrame(); m.runFrame();
const per = (m.ram[0] - c0) / 2;
ok(per >= 12 && per <= 13.5, 'IRQ de linha com R10=15 dispara ~12 vezes por quadro (' + per + ')');

// ---- 5. pausa = NMI ----
m = new SMS(false); m.load(build(A => scene(A)));
m.runFrame(); m.setButtons(8); m.runFrame(); m.setButtons(0); m.runFrame(); m.setButtons(8); m.runFrame();
eq(m.ram[1], 2, 'botão Pause dispara NMI uma vez por aperto');

// ---- 6. joystick ----
m = new SMS(false); m.load(build(A => scene(A)));
m.setButtons(16 | 1); eq(m.portIn(0xDC) & 0x3F, 0x3F & ~(1 | 16), 'porta DC: cima e botão 1 ficam em zero');
m.setButtons(0); eq(m.portIn(0xDC) & 0x3F, 0x3F, 'porta DC solta = 1');

// ---- 7. mapeador Sega ----
const big = new Uint8Array(0x10000); for (let p = 0; p < 4; p++) big.fill(p + 1, p * 0x4000, p * 0x4000 + 0x4000);
big[0x100] = 0xC3; big[0x101] = 0; big[0x102] = 0x01;
m = new SMS(false); m.load(big);
eq(m.read(0x0500), 1, 'slot 0 começa no banco 0');
eq(m.read(0x4000), 2, 'slot 1 começa no banco 1'); eq(m.read(0x8000), 3, 'slot 2 começa no banco 2');
m.write(0xFFFF, 3); eq(m.read(0x8000), 4, 'FFFF troca o slot 2');
m.write(0xFFFE, 0); eq(m.read(0x4000), 1, 'FFFE troca o slot 1');
m.write(0xFFFD, 3); eq(m.read(0x0500), 4, 'FFFD troca o slot 0'); eq(m.read(0x0010), 1, 'o 1º KB do slot 0 é sempre do banco 0');
m.write(0xFFFC, 8); m.write(0x8123, 0x77); eq(m.read(0x8123), 0x77, 'RAM do cartucho no slot 2'); eq(m.cartRam[0x123], 0x77, '...guardada em cartRam');
m.write(0xC010, 9); eq(m.read(0xE010), 9, 'RAM espelhada em E000');

// ---- 8. Game Gear: janela 160x144 e paleta de 12 bits ----
const gg = new GGCore();
const ggRom = build(A => {
  A.vreg(0, 0x04); A.vreg(1, 0x00); A.vreg(2, 0xFF); A.vreg(7, 0);
  A.vaddr(0, 1); clearVram(A);
  A.vaddr(2, 3); A.vdata(0xF0, 0x0F); // cor 1 = 0x0FF0 (verde+azul 15, vermelho 0)
  const r = []; for (let i = 0; i < 8; i++) r.push(255, 0, 0, 0);
  A.vaddr(32, 1); A.vdata(...r);
  A.vaddr(0x3800 + 6 * 64 + 6 * 2, 1); A.vdata(1, 0); // linha 6 do mapa, coluna 6 (dentro da janela do GG: x 48.., y 24..)
  A.vreg(1, 0x60);
});
gg.load(ggRom); for (let i = 0; i < 3; i++) gg.runFrame();
eq(gg.width, 160, 'GG: largura 160'); eq(gg.height, 144, 'GG: altura 144'); eq(gg.frame.length, 160 * 144, 'GG: quadro de 160x144');
eq(gg.frame[(48 - 24) * 160 + 2] >>> 0, 0xFFFFFF00, 'GG: tile na posição certa (x=48,y=48) com cor de 12 bits');
eq(gg.m.portIn(0x00) & 0x80, 0x80, 'GG: Start solto'); gg.setButtons(8); eq(gg.m.portIn(0x00) & 0x80, 0, 'GG: Start apertado vira 0 na porta 0');

// ---- 9. cheats, estado e save ----
const core = new SMSCore(false); core.load(build(A => scene(A)));
for (let i = 0; i < 3; i++) core.runFrame();
core.setCheats(core.parseCheat('C123:42')); core.runFrame(); eq(core.m.ram[0x123], 0x42, 'cheat endereço:valor escreve na RAM');
core.setCheats(core.parseCheat('00C12477')); core.runFrame(); eq(core.m.ram[0x124], 0x77, 'cheat Action Replay 00AAAAVV');
let bad = false; try { core.parseCheat('1234:56'); } catch (e) { bad = true; } ok(bad, 'cheat fora da RAM é recusado');
core.setCheats([]);
const st = core.saveState(); const cnt = core.m.ram[0];
for (let i = 0; i < 4; i++) core.runFrame(); ok(core.m.ram[0] !== cnt, 'contador anda');
core.loadState(st); eq(core.m.ram[0], cnt, 'estado restaura a RAM');
core.runFrame(); eq(core.m.vdp.frame[2 * 256 + 4], W, 'vídeo continua certo depois de carregar o estado');

// ---- 10. Codemasters ----
const cm = new Uint8Array(0x10000); for (let p = 0; p < 4; p++) cm.fill(p + 1, p * 0x4000, p * 0x4000 + 0x4000);
cm[0x7FE6] = 0x34; cm[0x7FE7] = 0x12; cm[0x7FE8] = 0xCC; cm[0x7FE9] = 0xED; // soma = 0x10000
m = new SMS(false); m.load(cm); eq(m.mapper, 'codemasters', 'detecta mapeador Codemasters');
m.write(0x8000, 3); eq(m.read(0x8000), 4, 'Codemasters: escrita em 8000 troca o slot 2');
m.write(0x4000, 2); eq(m.read(0x4000), 3, 'Codemasters: escrita em 4000 troca o slot 1');

// ---- 11. cabeçalho de 512 bytes (cópia) e tamanho ----
const withHdr = new Uint8Array(512 + 0x8000); withHdr.fill(9, 512); m = new SMS(false); m.load(withHdr); eq(m.read(0x100), 9, 'remove cabeçalho de 512 bytes');
let threw = false; try { new SMSCore(false).load(new Uint8Array(100)); } catch (e) { threw = true; } ok(threw, 'ROM minúscula é recusada');

// ---- 12. Z80: instruções e flags básicas ----
function cpuRun(bytes, n) {
  const mem = new Uint8Array(65536); mem.set(bytes);
  const bus = { read: a => mem[a], write: (a, v) => { mem[a] = v; }, portIn: () => 0xFF, portOut: () => {} };
  const c = new Z80(bus); c.sp = 0xF000; for (let i = 0; i < n; i++) c.step(); return c;
}
let c = cpuRun([0x3E, 0x15, 0xC6, 0x27, 0x27], 3); eq(c.R[7], 0x42, 'DAA após ADD em BCD');
c = cpuRun([0x3E, 0x7F, 0xC6, 0x01], 2); eq(c.f & 0x84, 0x84, 'ADD 7F+1 liga S e P/V (overflow)');
c = cpuRun([0x3E, 0x00, 0xD6, 0x01], 2); eq(c.R[7], 0xFF, 'SUB 0-1 = FF'); eq(c.f & 0x03, 0x03, 'SUB liga N e C');
c = cpuRun([0xB7, 0x21, 0x00, 0x80, 0x01, 0x00, 0x80, 0xED, 0x42], 4); eq(c.f & 0x40, 0x40, 'SBC HL,BC com valores iguais dá zero');
c = cpuRun([0xDD, 0x21, 0x00, 0x10, 0xDD, 0x36, 0x05, 0x99, 0xDD, 0x7E, 0x05], 3); eq(c.R[7], 0x99, 'LD (IX+5),n e LD A,(IX+5)');
c = cpuRun([0x01, 0x03, 0x00, 0x21, 0x00, 0x20, 0x11, 0x00, 0x30, 0xED, 0xB0], 4 + 3); eq(c.bc, 0, 'LDIR copia BC bytes');
c = cpuRun([0xCB, 0x37, 0x3E, 0x80, 0xCB, 0x27], 3); eq(c.R[7], 0, 'SLA A de 0x80 vira 0 com carry');
let cyc = 0; { const mem = new Uint8Array(65536); mem.set([0x00, 0x3E, 0x01, 0xC3, 0x00, 0x00]); const cp = new Z80({ read: a => mem[a], write() {}, portIn: () => 0, portOut() {} }); cyc = cp.step() + cp.step() + cp.step(); } eq(cyc, 4 + 7 + 10, 'ciclos: NOP + LD A,n + JP');

// ---- 13. suítes ZEX (opcional) ----
if (process.env.ZEX) {
  const { execFileSync } = require('child_process');
  const runner = path.join(__dirname, 'zex-runner.js');
  for (const f of ['prelim.com', 'zexdoc.cim']) {
    const out = execFileSync('node', [runner, path.join(process.env.ZEX, f)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    ok(!/ERROR/.test(out) && /complete/i.test(out), f + ' passou');
  }
}

console.log(fails ? '\n' + fails + ' de ' + total + ' falharam' : '\n' + total + '/' + total + ' testes passaram');
process.exit(fails ? 1 : 0);
