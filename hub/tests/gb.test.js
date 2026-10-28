// Testes do Game Boy / Game Boy Color: CPU, temporizador, vídeo, som, cartuchos, cheats e estados
const fs = require('fs'), path = require('path');
const files = ['shared/state', 'gb/cpu', 'gb/apu', 'gb/ppu', 'gb/gb', 'gb/core'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'cores', f + '.js'), 'utf8'));
const { GB, GBCore } = new Function('module', files.join('\n') + '\nreturn {GB, GBCore};')({});

let fails = 0, total = 0;
const eq = (got, want, msg) => {
  total++;
  if (got !== want) { fails++; console.log('FALHOU:', msg, '- obtido 0x' + (got >>> 0).toString(16) + ', esperado 0x' + (want >>> 0).toString(16)); }
  else console.log('ok:', msg);
};
const ok = (c, msg) => eq(!!c, true, msg);

function makeRom(code, opts) {
  opts = opts || {};
  const rom = new Uint8Array(opts.size || 0x8000);
  rom.set(code, 0x100);
  const t = 'TESTE'; for (let i = 0; i < t.length; i++) rom[0x134 + i] = t.charCodeAt(i);
  rom[0x143] = opts.cgb || 0; rom[0x147] = opts.type || 0; rom[0x148] = opts.romCode || 0; rom[0x149] = opts.ram || 0;
  let sum = 0; for (let i = 0x134; i <= 0x14C; i++) sum = (sum - rom[i] - 1) & 255; rom[0x14D] = sum;
  return rom;
}
function run(code, frames, opts) { const g = new GB(); g.load(makeRom(code, opts)); for (let i = 0; i < (frames || 1); i++) g.runFrame(); return g; }
const loop = [0x18, 0xFE]; // JR -2

// ---- CPU ----
let g = run([0x3E, 0x15, 0xC6, 0x27, 0x27, 0x18, 0xFE], 1); // LD A,15; ADD 27; DAA -> 42 (BCD)
eq(g.cpu.a, 0x42, 'DAA após ADD em BCD');
g = run([0x3E, 0xFF, 0x3C, 0x18, 0xFE], 1); // INC A -> 0, Z e H
eq(g.cpu.a, 0, 'INC A estoura'); eq(g.cpu.z, 1, 'INC A liga Z'); eq(g.cpu.hc, 1, 'INC A liga H');
g = run([0x31, 0xF0, 0xFF, 0x01, 0x34, 0x12, 0xC5, 0xD1, 0x18, 0xFE], 1); // PUSH BC; POP DE
eq((g.cpu.d << 8) | g.cpu.e, 0x1234, 'PUSH/POP');
g = run([0x3E, 0x80, 0xCB, 0x07, 0x18, 0xFE], 1); // RLC A
eq(g.cpu.a, 1, 'RLC A'); eq(g.cpu.cy, 1, 'RLC A carry');
g = run([0xCD, 0x08, 0x01, 0x18, 0xFE, 0, 0, 0, 0x3E, 0x77, 0xC9], 1); // CALL; LD A,77; RET
eq(g.cpu.a, 0x77, 'CALL/RET');

// ---- timer e interrupções ----
const tr = makeRom([0xFB, 0x76, 0x18, 0xFE]); tr[0x50] = 0x18; tr[0x51] = 0xFE;
g = new GB(); g.load(tr); // EI; HALT; tratador em 0x50 = JR -2
g.write(0xFF06, 0xF0); g.write(0xFF07, 0x05); g.write(0xFF05, 0xFF); g.write(0xFFFF, 4);
for (let i = 0; i < 20; i++) g.runFrame();
ok(g.cpu.pc >= 0x50 && g.cpu.pc < 0x58, 'interrupção do timer desvia para 0x0050');

// ---- vídeo: LY avança e VBlank dispara ----
g = new GB(); g.load(makeRom(loop));
g.ppu.reset(); g.ifl = 0; g.runFrame();
ok(g.ifl & 1, 'VBlank solicitado ao fim do quadro');
eq(g.ppu.ly, 144, 'LY = 144 no início do VBlank');
// tile 1 todo cor 3, BG apontando para ele
g = new GB(); g.load(makeRom(loop));
for (let i = 0; i < 16; i++) g.ppu.vram[0x10 + i] = 0xFF;
for (let i = 0; i < 32 * 32; i++) g.ppu.vram[0x1800 + i] = 1;
g.runFrame(); g.runFrame();
eq(g.ppu.frame[0], 0xFF201808, 'tile de fundo na cor 3 do DMG');
// janela e sprite
g.ppu.oam[0] = 16 + 8; g.ppu.oam[1] = 8 + 8; g.ppu.oam[2] = 1; g.ppu.oam[3] = 0;
g.ppu.vram[0x10 + 0] = 0x00; for (let i = 0; i < 16; i++) g.ppu.vram[0x10 + i] = 0xFF;
g.write(0xFF40, 0x93); g.write(0xFF48, 0x00); g.runFrame(); g.runFrame();
eq(g.ppu.frame[8 * 160 + 8], 0xFFD0F8E0, 'sprite com OBP0 = claro sobre o fundo');

// ---- CGB: paleta e atributos ----
g = new GB(); g.load(makeRom(loop, { cgb: 0x80 }));
ok(g.cgb, 'cabeçalho 0x80 liga o modo Color');
g.write(0xFF68, 0x80); g.write(0xFF69, 0x1F); g.write(0xFF69, 0x00); // cor 0 da paleta 0 = vermelho
g.runFrame(); g.runFrame();
eq(g.ppu.frame[0], 0xFF2E00C9, 'paleta CGB: vermelho (5 bits) convertido para a tela');
g.write(0xFF4F, 1); g.write(0xFF4F, 0);
eq(g.read(0xFF4F) & 1, 0, 'VBK alterna o banco de VRAM');
g.write(0xFF70, 3); eq(g.read(0xFF70) & 7, 3, 'SVBK seleciona banco da WRAM');

// ---- som ----
g = new GB(); g.load(makeRom(loop));
g.write(0xFF26, 0x80); g.write(0xFF25, 0xFF); g.write(0xFF24, 0x77);
g.write(0xFF12, 0xF0); g.write(0xFF11, 0x80); g.write(0xFF13, 0x00); g.write(0xFF14, 0x87);
for (let i = 0; i < 4; i++) g.runFrame();
const buf = new Float32Array(2048); g.apu.fill(buf);
let mx = 0; for (const v of buf) mx = Math.max(mx, Math.abs(v));
ok(mx > 0.01, 'canal quadrado produz áudio (pico ' + mx.toFixed(3) + ')');
eq(g.read(0xFF26) & 1, 1, 'NR52 mostra o canal 1 ligado');

// ---- cartucho MBC1 / SRAM / estados ----
const big = makeRom([0x18, 0xFE], { type: 3, size: 0x20000, romCode: 2, ram: 2 });
for (let b = 0; b < 8; b++) big[b * 0x4000 + 0x3FFF] = b; // marca cada banco no último byte
g = new GB(); g.load(big);
g.write(0x2000, 3); eq(g.read(0x7FFF), 3, 'MBC1: banco 3 em 4000-7FFF');
g.write(0x2000, 0); eq(g.read(0x7FFF), 1, 'MBC1: banco 0 vira 1');
g.write(0x0000, 0x0A); g.write(0xA000, 0x5A); eq(g.read(0xA000), 0x5A, 'MBC1: RAM externa');
const core = new GBCore(); core.load(big);
ok(core.sramKey() && core.sramKey().startsWith('gb_'), 'cartucho com bateria tem chave de save');
core.gb.write(0x0000, 0x0A); core.gb.write(0xA010, 0x77);
const sv = core.sramData().slice(); eq(sv[0x10], 0x77, 'sramData reflete a RAM');
const core2 = new GBCore(); core2.load(big); core2.sramRestore(sv); core2.gb.write(0x0000, 0x0A);
eq(core2.gb.read(0xA010), 0x77, 'sramRestore devolve a RAM');
for (let i = 0; i < 5; i++) core.runFrame();
const st = core.saveState(), pc = core.gb.cpu.pc, a = core.gb.cpu.a;
core.gb.cpu.pc = 0x1234; core.gb.cpu.a = 9;
core.loadState(st);
eq(core.gb.cpu.pc, pc, 'save state restaura PC'); eq(core.gb.cpu.a, a, 'save state restaura A');

// ---- cheats ----
const cc = new GBCore(); cc.load(makeRom(loop));
cc.setCheats(cc.parseCheat('01FF34C0')); cc.runFrame();
eq(cc.gb.read(0xC034), 0xFF, 'GameShark escreve na RAM');
const gg = cc.parseCheat('00A-17B-C49');
eq(gg[0].t, 'gg', 'Game Genie de 9 dígitos reconhecido');
let bad = false; try { cc.parseCheat('ZZ'); } catch (e) { bad = true; } ok(bad, 'código inválido é recusado');
cc.setCheats([{ t: 'gg', addr: 0x0100, val: 0x99, cmp: -1 }]); eq(cc.gb.read(0x0100), 0x99, 'Game Genie altera a leitura da ROM');

// ---- ROM real opcional (Blargg) ----
const dir = process.env.GB_TEST_ROMS;
if (dir && fs.existsSync(path.join(dir, 'cpu_instrs', 'cpu_instrs.gb'))) {
  const r = new GB(); r.load(new Uint8Array(fs.readFileSync(path.join(dir, 'cpu_instrs', 'cpu_instrs.gb'))));
  for (let i = 0; i < 2500 && !/Passed|Failed/.test(r.serialOut); i++) r.runFrame();
  ok(/Passed/.test(r.serialOut), 'cpu_instrs do Blargg: ' + r.serialOut.replace(/\s+/g, ' ').slice(-40));
}
console.log('\n' + (total - fails) + '/' + total + ' testes passaram');
process.exit(fails ? 1 : 0);
