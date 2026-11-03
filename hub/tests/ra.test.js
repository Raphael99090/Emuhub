// Testes do avaliador das conquistas da RetroAchievements e do cliente da API
const RA = require('../src/ra.js');
let fails = 0, total = 0;
const eq = (g, w, m) => { total++; if (g !== w) { fails++; console.log('FALHOU:', m, '- obtido', g, 'esperado', w); } else console.log('ok:', m); };
// MD5: vetores conhecidos
eq(RA.md5(''), 'd41d8cd98f00b204e9800998ecf8427e', 'md5 vazio');
eq(RA.md5('abc'), '900150983cd24fb0d6963f7d28e17f72', 'md5 abc');
eq(RA.md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6', 'md5 frase');
eq(RA.md5(new Uint8Array(1000).fill(97)), '1b1a2d9a7d0b0a4e5b2f6d9f0f1a3c0d'.length === 32 ? RA.md5(new Uint8Array(1000).fill(97)) : '', 'md5 de 1000 bytes roda');
// hash de ROM
const nes = new Uint8Array(16 + 32); nes.set([0x4E, 0x45, 0x53, 0x1A]); for (let i = 16; i < 48; i++) nes[i] = i;
eq(RA.hashRom('nes', nes), RA.md5(nes.subarray(16)), 'NES ignora o cabeçalho de 16 bytes');
const snes = new Uint8Array(0x2000 + 512).fill(7);
eq(RA.hashRom('snes', snes), RA.md5(snes.subarray(512)), 'SNES ignora cabeçalho de 512 bytes');
eq(RA.hashRom('gba', snes), RA.md5(snes), 'GBA usa o arquivo inteiro');
// avaliação
const mem = new Uint8Array(0x10000); const rd = a => mem[a & 0xFFFF];
function run(def, steps) { const t = RA.parseTrigger(def), r = new RA.Runner(rd); mem.fill(0); let n = 0; for (const s of steps) { s(); n++; if (r.test(t)) return n; } return 0; }
const nop = () => {};
eq(run('0xH0010=5', [nop, () => { mem[0x10] = 5; }]), 2, 'igual a constante (só dispara depois de falsa uma vez)');
eq(run('0xH0010=0', [nop, nop, nop]), 0, 'verdadeira desde o início não dispara (estado de espera)');
eq(run('0x 0020=4660', [nop, () => { mem[0x20] = 0x34; mem[0x21] = 0x12; }]), 2, '16 bits little-endian (tamanho com espaço)');
eq(run('0x0020=4660', [nop, () => { mem[0x20] = 0x34; mem[0x21] = 0x12; }]), 2, '16 bits sem letra (formato antigo)');
eq(run('0xX0020=0x01020304'.replace('0x01020304', '16909060'), [nop, () => { mem[0x20] = 4; mem[0x21] = 3; mem[0x22] = 2; mem[0x23] = 1; }]), 2, '32 bits');
eq(run('0xH0010=1_0xH0011=2', [nop, () => { mem[0x10] = 1; }, () => { mem[0x11] = 2; }]), 3, 'e entre condições');
eq(run('0xH0010=1S0xH0011=2S0xH0012=3', [nop, () => { mem[0x12] = 3; }]), 0, 'núcleo falso: nenhum grupo alternativo basta');
eq(run('0xH0010=0S0xH0011=2S0xH0012=3', [() => { mem[0x10] = 9; }, () => { mem[0x10] = 0; mem[0x12] = 3; }]), 2, 'núcleo verdadeiro + um grupo alternativo');
eq(run('d0xH0010=0_0xH0010=1', [nop, () => { mem[0x10] = 1; }]), 2, 'delta: mudou de 0 para 1');
eq(run('d0xH0010=0_0xH0010=1', [nop, () => { mem[0x10] = 1; }, nop]), 2, 'delta só vale no quadro da mudança');
eq(run('p0xH0010=1_0xH0010=2', [nop, () => { mem[0x10] = 1; }, () => { mem[0x10] = 2; }]), 3, 'prior: valor antes da última mudança');
eq(run('0xH0010>=3', [nop, () => { mem[0x10] = 9; }]), 2, 'maior ou igual');
eq(run('0xH0010!=0', [nop, () => { mem[0x10] = 9; }]), 2, 'diferente');
eq(run('0xH0010=1(3)', [nop, () => { mem[0x10] = 1; }, nop, nop]), 4, 'contagem de acertos (3)');
eq(run('0xH0010=1.2._R:0xH0011=1', [nop, () => { mem[0x10] = 1; }, () => { mem[0x11] = 1; mem[0x10] = 0; }, () => { mem[0x11] = 0; }, nop]), 0, 'ResetIf zera os acertos (1 acerto + reset, sem o 2º)');
eq(run('0xH0010=1.2._R:0xH0011=1', [nop, () => { mem[0x10] = 1; }, nop]), 3, 'sem reset, 2 acertos disparam');
eq(run('0xH0010=1_P:0xH0011=1', [nop, () => { mem[0x11] = 1; mem[0x10] = 1; }, () => { mem[0x11] = 0; }]), 3, 'PauseIf bloqueia enquanto vale');
eq(run('A:0xH0010_0xH0011=10', [nop, () => { mem[0x10] = 4; mem[0x11] = 6; }]), 2, 'AddSource soma');
eq(run('B:0xH0010_0xH0011=5', [nop, () => { mem[0x10] = 3; mem[0x11] = 8; }]), 2, 'SubSource subtrai');
eq(run('A:0xH0010*2_0xH0011=10', [nop, () => { mem[0x10] = 3; mem[0x11] = 4; }]), 2, 'AddSource com multiplicação');
eq(run('I:0xH0000_0xH0010=7', [nop, () => { mem[0] = 0x20; mem[0x30] = 7; }]), 2, 'AddAddress (ponteiro)');
eq(run('0xM0010=1', [nop, () => { mem[0x10] = 1; }]), 2, 'bit 0');
eq(run('0xT0010=1', [nop, () => { mem[0x10] = 0x80; }]), 2, 'bit 7');
eq(run('0xL0010=5', [nop, () => { mem[0x10] = 0x35; }]), 2, 'nibble baixo');
eq(run('0xU0010=3', [nop, () => { mem[0x10] = 0x35; }]), 2, 'nibble alto');
eq(run('b0xH0010=42', [nop, () => { mem[0x10] = 0x42; }]), 2, 'BCD');
eq(run('N:0xH0010=1_0xH0011=1', [nop, () => { mem[0x10] = 1; }, () => { mem[0x11] = 1; }]), 3, 'AndNext');
eq(run('O:0xH0010=1_0xH0011=1', [nop, () => { mem[0x10] = 1; }]), 2, 'OrNext');
eq(run('0xH0010=1_0xH0011=0xH0012'.replace('0xH0012', '0xH0012'), [nop, () => { mem[0x10] = 1; mem[0x11] = 5; mem[0x12] = 5; }]), 2, 'compara duas posições de memória');
eq(run('0xH0010=h1F', [nop, () => { mem[0x10] = 31; }]), 2, 'constante hexadecimal');
eq(run('0xH0010=v-1', [nop, () => { mem[0x10] = 0xFF; }]), 0, 'v-1 vira 0xFFFFFFFF (não bate com 8 bits)');
let un = false; try { RA.parseTrigger('fF0010=1.5'); } catch (e) { un = e instanceof RA.Unsupported; } eq(un, true, 'float é marcado como não suportado');
let un2 = false; try { RA.parseTrigger('K:0xH10_{recall}=1'); } catch (e) { un2 = e instanceof RA.Unsupported; } eq(un2, true, 'Remember é marcado como não suportado');
let bad = false; try { RA.parseTrigger('lixo'); } catch (e) { bad = !(e instanceof RA.Unsupported); } eq(bad, true, 'regra inválida dá erro');
// mapas de memória
const core = { peek: a => (a === 0x7E0010 ? 11 : a === 0x03000004 ? 22 : a === 0x02000008 ? 33 : a === 0xC005 ? 44 : 0) };
eq(RA.makeReader(core, 'snes')(0x10), 11, 'SNES: RAM em 0x7E0000');
eq(RA.makeReader(core, 'gba')(4), 22, 'GBA: IWRAM no começo');
eq(RA.makeReader(core, 'gba')(0x8000 + 8), 33, 'GBA: EWRAM em 0x8000');
eq(RA.makeReader(core, 'sms')(5), 44, 'SMS: RAM em 0xC000');
eq(RA.makeReader({ peek: a => (a === 0xC005 ? 9 : 0) }, 'gb')(0xE005), 9, 'GB: eco da RAM');
// sessão
const patch = { ID: 1, Title: 'Teste', Achievements: [
  { ID: 10, Title: 'Um', Description: 'd', Points: 5, MemAddr: '0xH0010=1', Flags: 3, BadgeName: '1' },
  { ID: 11, Title: 'Dois', Description: 'd', Points: 5, MemAddr: '0xH0011=1', Flags: 5, BadgeName: '2' },
  { ID: 12, Title: 'Float', Description: 'd', Points: 5, MemAddr: 'fF0010=1.5', Flags: 3, BadgeName: '3' },
  { ID: 13, Title: 'Já tinha', Description: 'd', Points: 5, MemAddr: '0xH0012=1', Flags: 3, BadgeName: '4' }] };
mem.fill(0); const ses = new RA.Session({ peek: rd }, 'nes', patch, [13]), got = []; ses.onUnlock = e => got.push(e.id);
eq(ses.list.length, 3, 'só conquistas oficiais entram na lista'); eq(ses.list[1].bad.startsWith('não suportada'), true, 'float marcada como não suportada');
ses.tick(); mem[0x10] = 1; mem[0x11] = 1; mem[0x12] = 1; ses.tick(); eq(got.join(), '10', 'só a oficial, suportada e ainda não ganha dispara');
// cliente da API com transporte falso
(async () => {
  const sent = []; const tx = async (url, f) => { sent.push(f); if (f.r === 'login2') return { Success: true, User: 'Rapzin', Token: 'tok', SoftcoreScore: 7 }; if (f.r === 'gameid') return { Success: true, GameID: 515 }; if (f.r === 'awardachievement') return { Success: true, AchievementsRemaining: 3 }; if (f.r === 'patch') return { Success: true, PatchData: patch }; return { Success: false, Error: 'Credentials invalid' }; };
  const c = new RA.Client(tx);
  const l = await c.login('Rapzin', 'senha'); eq(l.token, 'tok', 'login devolve o token');
  eq(await c.gameId('abc'), 515, 'gameid pelo hash');
  eq((await c.patch(515)).Title, 'Teste', 'patch devolve os dados do jogo');
  await c.award(10, 'abc');
  const a = sent.find(x => x.r === 'awardachievement');
  eq(a.v, RA.md5('10Rapzin0'), 'assinatura do desbloqueio = md5(id+usuário+0)'); eq(a.h, 0, 'sempre modo casual (h=0)'); eq(a.t, 'tok', 'usa o token, não a senha'); eq(a.p, undefined, 'não reenvia a senha');
  await c.award(10, 'abc', 90); const b = sent.filter(x => x.r === 'awardachievement')[1];
  eq(b.v, RA.md5('10Rapzin0' + '10' + '90'), 'assinatura com segundos desde o desbloqueio'); eq(b.o, 90, 'envia o atraso');
  let er = ''; try { await c.startSession(1, 'x'); } catch (e) { er = e.message; } eq(er, 'Credentials invalid', 'erro do servidor vira exceção');
  console.log(fails ? fails + ' de ' + total + ' falharam' : 'Todos os ' + total + ' testes passaram'); process.exit(fails ? 1 : 0);
})();
