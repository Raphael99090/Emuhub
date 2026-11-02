// Pacote Pokémon FireRed: todas as condições valem e uma partida simulada desbloqueia as certas
const A = require('../src/achievements.js');
const fs = require('fs'), path = require('path');
const ACH_PACKS = new Function(fs.readFileSync(path.join(__dirname, '..', 'src/data/packs.js'), 'utf8') + '\nreturn ACH_PACKS;')();
let fails = 0, total = 0;
const eq = (g, w, m) => { total++; if (g !== w) { fails++; console.log('FALHOU:', m, '- obtido', g, 'esperado', w); } else console.log('ok:', m); };
const rom = new Uint8Array(0x100); rom.set(Buffer.from('BPRE'), 0xAC);
const defs = ACH_PACKS.for('gba', rom);
eq(defs.length > 40, true, 'pacote tem mais de 40 conquistas (' + defs.length + ')');
eq(ACH_PACKS.for('gba', new Uint8Array(0x100)).length, 0, 'ROM desconhecida não recebe pacote');
let bad = 0; for (const d of defs) { try { A.parse(d.cond); } catch (e) { bad++; console.log(d.title, e.message); } } eq(bad, 0, 'todas as condições compilam');
eq(new Set(defs.map(d => d.id)).size, defs.length, 'ids únicos');
// memória simulada do GBA
const mem = new Map(); const w = (a, v, n) => { for (let i = 0; i < (n || 1); i++) mem.set(a + i, (v >>> (8 * i)) & 255); };
const core = { peek: a => mem.get(a >>> 0) || 0 };
const SB1 = 0x02025000, SB2 = 0x02024000; w(0x03005008, SB1, 4); w(0x0300500C, SB2, 4);
const e = new A.Engine(), got = []; e.onUnlock = d => got.push(d.title); e.setup(core, defs, {});
e.tick(); eq(got.length, 0, 'jogo novo não desbloqueia nada');
w(SB1 + 0x234, 1); w(SB1 + 0x238 + 0x54, 6); e.tick();
eq(got.includes('Primeiro parceiro'), true, 'primeiro parceiro');
w(SB1 + 0xEE0 + 0x104, 1); e.tick(); eq(got.includes('Insígnia Pedra'), true, 'insígnia da Pedra (bit 0 do byte 0xFE4)');
eq(got.includes('Insígnia Cascata'), false, 'não desbloqueia a próxima insígnia');
w(SB1 + 0xEE0 + 0x104, 255); e.tick(); eq(got.includes('Colecionador de insígnias'), true, '8 insígnias');
w(SB1 + 0x238 + 0x54, 52); e.tick(); eq(got.includes('Nível 50') && !got.includes('Nível 70'), true, 'nível 50 sim, 70 não');
w(SB2 + 0x28, 0xFF); w(SB2 + 0x29, 0x03); e.tick(); eq(got.includes('10 Pokémon capturados') && !got.includes('25 Pokémon capturados'), true, 'Pokédex 10 capturados');
w(SB1 + 4, 3); w(SB1 + 5, 2); for (let i = 0; i < 62; i++) e.tick(); eq(got.includes('Visitou Pewter City'), true, 'visitou Pewter');
w(SB1 + 0xEE0 + 0x105, 0x10); e.tick(); eq(got.includes('Campeão da Liga'), true, 'Hall da Fama');
w(SB2 + 0x0E, 6, 2); e.tick(); eq(got.includes('5 horas de aventura'), true, 'tempo de jogo');
console.log(fails ? fails + ' de ' + total + ' falharam' : 'Todos os ' + total + ' testes passaram'); process.exit(fails ? 1 : 0);
