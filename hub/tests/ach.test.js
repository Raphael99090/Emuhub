// Testes do motor de conquistas
const A = require('../src/achievements.js');
let fails = 0, total = 0;
const eq = (g, w, m) => { total++; if (g !== w) { fails++; console.log('FALHOU:', m, '- obtido', g, 'esperado', w); } else console.log('ok:', m); };
const mem = new Uint8Array(0x10000);
const core = { peek: a => mem[a & 0xFFFF] };
function run(cond, steps) {
  const e = new A.Engine(), got = []; e.onUnlock = d => got.push(d.id);
  e.setup(core, [{ id: 'x', title: 't', cond }], {});
  mem.fill(0); let f = 0;
  for (const s of steps) { s(); e.tick(); f++; if (got.length) return f; }
  return 0;
}
eq(run('m8:0x10 >= 9', [() => {}, () => { mem[0x10] = 9; }]), 2, 'valor atinge o mínimo');
eq(run('m16:0x20 == 0x1234', [() => { mem[0x20] = 0x34; mem[0x21] = 0x12; }]), 1, '16 bits little-endian');
eq(run('m8:0x10 == 1 && m8:0x11 == 2', [() => { mem[0x10] = 1; }, () => { mem[0x11] = 2; }]), 2, 'E entre condições');
eq(run('m8:0x10 == 1 || m8:0x11 == 2', [() => {}, () => { mem[0x11] = 2; }]), 2, 'OU entre grupos');
eq(run('bit(m8:0x30,3) == 1', [() => { mem[0x30] = 7; }, () => { mem[0x30] = 8; }]), 2, 'bit');
eq(run('prev(m8:0x40) < m8:0x40', [() => { mem[0x40] = 5; }, () => {}, () => { mem[0x40] = 6; }]), 3, 'prev detecta subida');
eq(run('m8:0x50 == 1 for 3', [() => { mem[0x50] = 1; }, () => {}, () => {}, () => {}]), 4, 'mantido por N quadros');
eq(run('m8:0x50 == 1 for 3', [() => { mem[0x50] = 1; }, () => {}, () => { mem[0x50] = 0; }, () => { mem[0x50] = 1; }, () => {}]), 0, 'for zera quando falha');
let err = ''; try { A.parse('abc'); } catch (e) { err = e.message; } eq(err.startsWith('Condição inválida'), true, 'erro de sintaxe');
err = ''; try { A.parse('foo >= 1'); } catch (e) { err = e.message; } eq(err.startsWith('Não entendi'), true, 'operando inválido');
{ const e = new A.Engine(); let n = 0; e.onUnlock = () => n++; mem.fill(0); mem[1] = 1; e.setup(core, [{ id: 'a', cond: 'm8:1 == 1' }], {}); e.tick(); e.tick(); e.tick(); eq(n, 1, 'desbloqueia uma vez só'); }
{ const e = new A.Engine(); let n = 0; e.onUnlock = () => n++; mem[1] = 1; e.setup(core, [{ id: 'a', cond: 'm8:1 == 1' }], { a: 123 }); e.tick(); eq(n, 0, 'já desbloqueada não dispara'); }
{ const c2 = { peek: a => (a >= 0xC000 && a < 0xE000 ? mem[a - 0xC000] : 0) }; mem.fill(0); mem[0] = 5; mem[0x100] = 5; mem[0x105] = 7;
  const s = new A.Search(c2, 'gb'); s.step('eq', 5); eq(s.count, 2, 'busca por valor exato');
  mem[0] = 6; eq(s.step('ch'), 1, 'busca: mudou'); eq(s.list(3)[0].addr, 0xC000, 'busca: endereço certo'); }
console.log(fails ? fails + ' de ' + total + ' falharam' : 'Todos os ' + total + ' testes passaram'); process.exit(fails ? 1 : 0);
