// Testes do SNES: CPU 65816 (todos os opcodes), vídeo, handshake do SPC700, save state
const fs = require('fs'), path = require('path');
const files = ['shared/state', 'snes/cpu', 'snes/spc', 'snes/gsu', 'snes/ppu', 'snes/snes', 'snes/core'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'cores', f + '.js'), 'utf8'));
const { SNES, SNESCore, parseSnesHeader, GSU } = new Function('module', files.join('\n') + '\nreturn {SNES, SNESCore, parseSnesHeader, GSU};')({});

let fails = 0, total = 0;
const eq = (got, want, msg) => {
  total++;
  if (got !== want) { fails++; console.log('FALHOU:', msg, '- obtido 0x' + (got >>> 0).toString(16) + ', esperado 0x' + (want >>> 0).toString(16)); }
  else console.log('ok:', msg);
};
const ok = (c, msg) => eq(!!c, true, msg);

function makeRom(code, title) {
  const rom = new Uint8Array(0x8000);
  rom.set(code, 0);
  const t = (title || 'TESTE').padEnd(21, ' ');
  for (let i = 0; i < 21; i++) rom[0x7FC0 + i] = t.charCodeAt(i);
  rom[0x7FD5] = 0x20; rom[0x7FD7] = 0x08; rom[0x7FDC] = 0xFF; rom[0x7FDD] = 0xFF; rom[0x7FDE] = 0; rom[0x7FDF] = 0;
  rom[0x7FFC] = 0x00; rom[0x7FFD] = 0x80;
  return rom;
}
function machine(code) { const s = new SNES(); s.load(makeRom(code), false, 0); s.reset(); return s; }
function runCode(code, n) { const s = machine(code); for (let i = 0; i < n; i++) s.cpu.step(); return s; }

// ---- cabeçalho ----
const h = parseSnesHeader(makeRom([0xEA]));
eq(h.map, 'LoROM', 'cabeçalho: LoROM detectada');
eq(h.title, 'TESTE', 'cabeçalho: título');

// ---- semântica da CPU ----
let s = runCode([0x18, 0xFB, 0x18, 0xC2, 0x30, 0xA9, 0x34, 0x12, 0x69, 0x11, 0x11], 6); // CLC XCE REP#30 LDA#1234 ADC#1111
eq(s.cpu.a, 0x2345, 'ADC 16 bits');
s = runCode([0x18, 0xFB, 0xE2, 0x20, 0xF8, 0xA9, 0x19, 0x18, 0x69, 0x01], 8); // SEP#20 SED LDA#19 CLC ADC#01
eq(s.cpu.a & 0xFF, 0x20, 'ADC decimal (BCD)');
s = runCode([0x18, 0xFB, 0xC2, 0x30, 0xA9, 0x00, 0x80, 0x0A], 5); // ASL A em 0x8000
eq(s.cpu.a, 0, 'ASL A 16 bits zera 0x8000');
eq(s.cpu.p & 1, 1, 'ASL A 16 bits deixa carry');
s = runCode([0x18, 0xFB, 0xC2, 0x30, 0xA9, 0xCD, 0xAB, 0x48, 0xA9, 0, 0, 0x68], 7); // PHA, LDA#0, PLA
eq(s.cpu.a, 0xABCD, 'PHA/PLA 16 bits');
s = runCode([0x18, 0xFB, 0x20, 0x08, 0x80, 0xEA, 0xEA, 0xEA, 0xA9, 0x77, 0x60], 5); // JSR; LDA; RTS
eq(s.cpu.pc, 0x8005, 'JSR/RTS volta para a instrução seguinte');
s = runCode([0x18, 0xFB, 0x18, 0xE2, 0x20, 0xA9, 0x05, 0xE9, 0x03], 6); // SBC com carry=0 => 5-3-1
eq(s.cpu.a & 0xFF, 1, 'SBC 8 bits com carry limpo');
s = runCode([0x18, 0xFB, 0xC2, 0x30, 0xA9, 0x00, 0x01, 0xAA, 0xE2, 0x10], 6); // TAX, depois SEP #10 corta X
eq(s.cpu.x, 0, 'SEP #$10 zera o byte alto de X');

// ---- todos os opcodes executam sem exceção ----
for (const mode of [0, 1]) {
  let bad = [];
  for (let op = 0; op < 256; op++) {
    const pre = mode ? [0x18, 0xFB, 0xC2, 0x30] : [0x18, 0xFB, 0xE2, 0x30];
    const code = pre.concat([op, 0x10, 0x00, 0x00, 0xEA, 0xEA, 0xEA]);
    try { const m = machine(code); for (let i = 0; i < 6; i++) m.cpu.step(); } catch (e) { bad.push(op.toString(16) + ' ' + e.message); }
  }
  eq(bad.length, 0, 'opcodes 65816 sem exceção (' + (mode ? '16' : '8') + ' bits)' + (bad.length ? ' ' + bad.slice(0, 4).join('; ') : ''));
}

// ---- vídeo: cor de fundo via CGRAM ----
// forced blank off, BG desligados; cor 0 = verde (0x03E0)
s = machine([0x18, 0xFB, 0xE2, 0x30, 0xA9, 0x00, 0x8D, 0x21, 0x21, 0xA9, 0xE0, 0x8D, 0x22, 0x21, 0xA9, 0x03, 0x8D, 0x22, 0x21, 0xA9, 0x0F, 0x8D, 0x00, 0x21, 0x4C, 0x18, 0x80]);
for (let i = 0; i < 3; i++) s.runFrame();
const f = s.ppu.frame;
eq(f[0], (0xFF000000 | (0xFF << 8)) >>> 0, 'backdrop verde renderizado');
eq(f[100 * 256 + 128], f[0], 'backdrop uniforme');

// ---- SPC700: o IPL anuncia $AA/$BB ----
s = machine([0x80, 0xFE]);
s.runFrame();
eq(s.apu.outPorts[0], 0xAA, 'SPC: porta 0 = $AA');
eq(s.apu.outPorts[1], 0xBB, 'SPC: porta 1 = $BB');

// ---- adaptador e save state ----
const core = new SNESCore();
core.load(makeRom([0x80, 0xFE]));
for (let i = 0; i < 5; i++) core.runFrame();
const st = core.saveState();
const pc = core.snes.cpu.pc, line = core.snes.line;
for (let i = 0; i < 3; i++) core.runFrame();
core.loadState(st);
eq(core.snes.cpu.pc, pc, 'save state restaura o PC');
ok(core.sramKey() === null, 'sem SRAM: sem chave');
const buf = new Float32Array(1024);
core.audio.setSampleRate(44100);
let thrown = false; try { core.audio.fill(buf); } catch (e) { thrown = true; }
ok(!thrown, 'audio.fill não quebra');

// ---- SRAM (save da bateria) ----
{
  const rom = makeRom([0x18, 0xFB, 0xE2, 0x30, 0xA9, 0x5A, 0x8F, 0x00, 0x00, 0x70, 0xA9, 0xA5, 0x8F, 0xFF, 0x07, 0x70, 0x80, 0xFE]);
  rom[0x7FD8] = 1; // 2 KB
  const a = new SNESCore(); a.load(rom);
  for (let i = 0; i < 3; i++) a.runFrame();
  eq(a.sramData()[0], 0x5A, 'SRAM: escrita em 70:0000');
  eq(a.sramData()[0x7FF], 0xA5, 'SRAM: última posição de 2 KB');
  ok(a.sramKey() && a.sramKey().startsWith('snes_'), 'SRAM: chave de save');
  const saved = a.sramData().slice();
  const c = new SNESCore(); const r2 = makeRom([0x80, 0xFE]); r2[0x7FD8] = 1; c.load(r2); c.sramRestore(saved);
  eq(c.sramData()[0], 0x5A, 'SRAM: restaurar dados');
  eq(c.snes.rawRead(0x700000), 0x5A, 'SRAM: visível no mapa de memória');
}

// ---- cheats ----
{
  const c = new SNESCore(); c.load(makeRom([0x80, 0xFE]));
  c.setCheats(c.parseCheat('7E0010:55'));
  c.runFrame();
  eq(c.snes.wram[0x10], 0x55, 'cheat de RAM (Action Replay)');
  const gg = c.parseCheat('C2A4-6F0D');
  eq(gg[0].t, 'gg', 'Game Genie reconhecido');
  eq(gg[0].val, 0xAD, 'Game Genie: valor decodificado');
  let bad = false; try { c.parseCheat('ZZZZ-1111'); } catch (e) { bad = true; }
  ok(bad, 'Game Genie inválido é recusado');
  bad = false; try { c.parseCheat('008000:01'); } catch (e) { bad = true; }
  ok(bad, 'Action Replay fora da RAM é recusado');
  // Game Genie num endereço de ROM LoROM
  c.setCheats([{ t: 'gg', addr: 0x008002, val: 0x77 }]);
  eq(c.snes.rom[2], 0x77, 'Game Genie: patch na ROM');
  c.setCheats([]);
  eq(c.snes.rom[2], 0, 'Game Genie: desfeito ao desligar');
}


// ---- Super FX ----
{
  // programa: IBT R1,#5 / IBT R2,#7 / FROM R1 / ADD R2 -> R0 / STOP
  const rom = new Uint8Array(0x8000); const prog = [0xA1, 5, 0xA2, 7, 0xB1, 0x52, 0x00, 0x01];
  rom.set(prog, 0x100);
  const fake = { gsuIrq: false };
  const g = new GSU(fake, rom, 0x8000);
  g.write(0x3034, 0); g.write(0x301E, 0x00); g.write(0x301F, 0x81); // R15 = $8100 (LoROM) e GO
  ok(g.running, 'GSU: escrever R15 liga o chip');
  g.run(2000);
  ok(!g.running, 'GSU: STOP desliga o chip');
  eq(g.r[0], 12, 'GSU: FROM R1 / ADD R2 soma 5+7');
  ok(fake.gsuIrq, 'GSU: STOP levanta o IRQ');
  eq(g.read(0x3031) & 0x80, 0x80, 'GSU: SFR alto mostra IRQ');
  ok(!fake.gsuIrq, 'GSU: ler o SFR limpa o IRQ');
  // atraso de desvio: BRA +2 executa a instrução seguinte antes de saltar
  const rom2 = new Uint8Array(0x8000); rom2.set([0x05, 0x02, 0xD1, 0xD1, 0xD1, 0x00, 0x01], 0x200);
  const g2 = new GSU({}, rom2, 0x8000); g2.write(0x301E, 0x00); g2.write(0x301F, 0x82); g2.run(2000);
  eq(g2.r[1], 2, 'GSU: BRA executa o slot de atraso e pula a instrução seguinte');
  // PLOT 8bpp em (3,2) com cor 5: planos 0 e 2
  const rom3 = new Uint8Array(0x8000); rom3.set([0xA1, 3, 0xA2, 2, 0xA0, 5, 0x4E, 0x4C, 0x00, 0x01], 0x300);
  const g3 = new GSU({}, rom3, 0x8000); g3.write(0x303A, 0x03); g3.write(0x301E, 0x00); g3.write(0x301F, 0x83); g3.run(2000);
  eq(g3.ram[4], 0x10, 'GSU: PLOT grava o plano 0'); eq(g3.ram[20], 0x10, 'GSU: PLOT grava o plano 2'); eq(g3.ram[5], 0, 'GSU: PLOT não mexe no plano 1');
}
// ---- Alta resolução ----
{
  const c = new SNESCore(); const rom = new Uint8Array(0x8000);
  const t = 'HIRES TEST'; for (let i = 0; i < t.length; i++) rom[0x7FC0 + i] = t.charCodeAt(i);
  rom[0x7FD5] = 0x20; rom[0x7FD7] = 0x08; rom[0x7FDC] = 0xFF; rom[0x7FDD] = 0xFF; rom[0x7FDE] = 0; rom[0x7FDF] = 0;
  c.load(rom); const p = c.snes.ppu;
  p.setini = 0; c.runFrame(); eq(c.width + 'x' + c.height, '256x224', 'vídeo normal: 256x224');
  p.bgmode = 5; p.tm = 1; p.setini = 0; p.renderLine(0); p.finishFrame(); eq(c.width, 512, 'modo 5: largura 512');
  p.bgmode = 1; p.setini = 1; p.field = 0; for (let y = 0; y < 224; y++) p.renderLine(y); p.finishFrame(); eq(c.height, 448, 'entrelaçado: altura 448');
  p.setini = 4; p.field = 0; for (let y = 0; y < 239; y++) p.renderLine(y); p.finishFrame(); eq(c.height, 239, 'overscan: 239 linhas');
}

// ---- ROM real opcional (se existir) ----
const real = process.env.SNES_ROM;
if (real && fs.existsSync(real)) {
  const c = new SNESCore(); c.load(new Uint8Array(fs.readFileSync(real)));
  for (let i = 0; i < 400; i++) c.runFrame();
  const colors = new Set(c.frame); ok(colors.size > 8, 'ROM real desenha a tela (' + colors.size + ' cores)');
}

console.log('\n' + (total - fails) + '/' + total + ' testes passaram');
process.exit(fails ? 1 : 0);
