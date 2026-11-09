// Smoke tests do bundle: NES exige WASM e demais cores seguem carregáveis.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dist = fs.readFileSync(path.join(__dirname, '..', 'dist', 'emu-hub.html'), 'utf8');
const match = dist.match(/<script id="cores">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Bloco de núcleos não encontrado.');
const ctx = vm.createContext({ TextEncoder, TextDecoder });
const Cores = vm.runInContext(match[1] + ';Cores', ctx);
let failed = 0;
function check(ok, label) { console.log(ok ? 'ok:' : 'FALHOU:', label); if (!ok) failed++; }
function errorOf(fn) { try { fn(); } catch (e) { return String(e.message || e); } return ''; }

{
  const nes = Cores.nes.create();
  check(nes.width === 256 && nes.height === 240 && !nes.ready, 'NES: adaptador inicial 256x240');
  check(errorOf(() => nes.load(new Uint8Array(32))).includes('C++/WebAssembly'), 'NES: não permite fallback JavaScript');
  check(!nes.nes && nes.enhancements().length === 0, 'NES: usa somente o adaptador WASM');
}
{
  const rom = new Uint8Array(0x10000), base = 0x7fc0, title = 'TESTE ROM';
  for (let i = 0; i < 21; i++) rom[base + i] = i < title.length ? title.charCodeAt(i) : 0x20;
  rom[base + 0x15] = 0x20; rom[base + 0x16] = 0; rom[base + 0x17] = 7;
  rom[base + 0x18] = 0; rom[base + 0x19] = 1; rom[base + 0x1c] = 0xcb; rom[base + 0x1d] = 0xed;
  rom[base + 0x1e] = 0x34; rom[base + 0x1f] = 0x12;
  const snes = Cores.snes.create(), info = snes.load(rom);
  check(info.title === title && snes.header.map === 'LoROM' && snes.ready, 'SNES: carrega LoROM');
}
{
  const rom = new Uint8Array(0x40000); rom[3] = 0xea;
  const put = (o, s) => { for (let i=0;i<s.length;i++) rom[o+i]=s.charCodeAt(i); };
  put(0xa0,'TESTGAME'); put(0xac,'ATSE'); put(0xb0,'01'); rom[0xb2]=0x96; rom[0xbc]=1;
  let sum=0; for(let i=0xa0;i<=0xbc;i++) sum+=rom[i]; rom[0xbd]=(-(sum+0x19))&0xff;
  const gba=Cores.gba.create(), info=gba.load(rom);
  check(info.title==='TESTGAME' && gba.header.code==='ATSE' && gba.ready, 'GBA: lê cabeçalho e inicializa');
}
console.log(failed ? failed + ' falha(s)' : 'TUDO OK');
process.exit(failed ? 1 : 0);
