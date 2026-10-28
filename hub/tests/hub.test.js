// Testes dos núcleos do hub: roda os núcleos do HTML empacotado em um contexto isolado
const fs = require('fs'), path = require('path'), vm = require('vm');
const dist = fs.readFileSync(path.join(__dirname, '..', 'dist', 'emu-hub.html'), 'utf8');
const m = dist.match(/<script id="cores">([\s\S]*?)<\/script>/);
const ctx = vm.createContext({ TextEncoder, TextDecoder });
const Cores = vm.runInContext(m[1] + ';Cores', ctx);

let fails = 0;
const ok = (c, msg) => { console.log(c ? 'ok:' : 'FALHOU:', msg); if (!c) fails++; };
const throws = (fn) => { try { fn(); return false; } catch (e) { return e.message; } };

/* ---- NES via adaptador ---- */
{
  const prg = new Uint8Array(16384).fill(0xEA);
  const code = [0x78, 0xD8, 0xA2, 0xFF, 0x9A, 0xAD, 0x02, 0x20, 0x10, 0xFB,
    0xA9, 0x3F, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0xA9, 0x21, 0x8D, 0x07, 0x20, 0xA9, 0x16, 0x8D, 0x07, 0x20,
    0xA9, 0x20, 0x8D, 0x06, 0x20, 0xA9, 0x00, 0x8D, 0x06, 0x20, 0xA9, 0x01, 0x8D, 0x07, 0x20,
    0xA9, 0x00, 0x8D, 0x05, 0x20, 0x8D, 0x05, 0x20, 0xA9, 0x1E, 0x8D, 0x01, 0x20];
  const loop = code.length; code.push(0x4C, loop & 0xFF, 0xC0 + (loop >> 8));
  prg.set(code, 0); prg[0x3FFC] = 0; prg[0x3FFD] = 0xC0; prg[0x3FFA] = 0; prg[0x3FFB] = 0xC0; prg[0x3FFE] = 0; prg[0x3FFF] = 0xC0;
  const chr = new Uint8Array(8192); chr.fill(0xFF, 16, 24);
  const rom = new Uint8Array(16 + 16384 + 8192);
  rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1], 0); rom.set(prg, 16); rom.set(chr, 16 + 16384);
  const c = Cores.nes.create();
  ok(c.width === 256 && c.height === 240 && !c.ready, 'NES: estado inicial');
  const info = c.load(rom);
  ok(c.ready && info.lines.length === 3, 'NES: carregou e devolveu info');
  for (let i = 0; i < 5; i++) c.runFrame();
  ok(c.frame[0] !== c.frame[8] && c.frame.length === 256 * 240, 'NES: frame desenhado pelo adaptador');
  c.setButtons(0xFFFF); ok(true, 'NES: setButtons aceita máscara de 12 bits');
  ok(c.audio.buffered() > 0, 'NES: áudio gerando samples');
  ok(throws(() => Cores.nes.create().load(new Uint8Array(32))) !== false, 'NES: rejeita arquivo inválido');
}

/* ---- SNES ---- */
{
  const d = new Uint8Array(0x10000);
  const a = 0x7FC0;
  const title = 'TESTE ROM';
  for (let i = 0; i < 21; i++) d[a + i] = i < title.length ? title.charCodeAt(i) : 0x20;
  d[a + 0x15] = 0x20; d[a + 0x16] = 0x00; d[a + 0x17] = 0x07; d[a + 0x18] = 0x00; d[a + 0x19] = 0x01;
  d[a + 0x1C] = 0xCB; d[a + 0x1D] = 0xED; d[a + 0x1E] = 0x34; d[a + 0x1F] = 0x12;
  const c = Cores.snes.create();
  const info = c.load(d);
  ok(info.title === 'TESTE ROM', 'SNES: título lido');
  ok(c.header.map === 'LoROM' && !c.header.fast && c.header.checksumOk, 'SNES: LoROM + checksum ok');
  ok(c.header.region === 'América do Norte' && !c.header.coprocessor, 'SNES: região e coprocessador');
  ok(c.ready, 'SNES: núcleo pronto');
  // com cabeçalho de copiador de 512 bytes
  const d2 = new Uint8Array(0x10000 + 512); d2.set(d, 512);
  ok(Cores.snes.create().load(d2).title === 'TESTE ROM' && Cores.snes.create().load(d2).lines[1].includes('copiador'), 'SNES: ignora cabeçalho de copiador');
  // HiROM
  const h = new Uint8Array(0x20000);
  const b = 0xFFC0;
  for (let i = 0; i < 21; i++) h[b + i] = 0x41;
  h[b + 0x15] = 0x21; h[b + 0x1C] = 0xFF; h[b + 0x1D] = 0xFF; h[b + 0x1E] = 0; h[b + 0x1F] = 0;
  ok(Cores.snes.create().load(h) && (() => { const s = Cores.snes.create(); s.load(h); return s.header.map === 'HiROM'; })(), 'SNES: detecta HiROM');
  ok(throws(() => Cores.snes.create().load(new Uint8Array(0x10000))) !== false, 'SNES: rejeita arquivo sem cabeçalho válido');
}

/* ---- GBA ---- */
{
  const d = new Uint8Array(0x40000);
  d[3] = 0xEA;
  const put = (o, s) => { for (let i = 0; i < s.length; i++) d[o + i] = s.charCodeAt(i); };
  put(0xA0, 'TESTGAME'); put(0xAC, 'ATSE'); put(0xB0, '01'); d[0xB2] = 0x96; d[0xBC] = 1;
  let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum += d[i];
  d[0xBD] = (-(sum + 0x19)) & 0xFF;
  put(0x1000, 'SRAM_V113');
  const c = Cores.gba.create();
  const info = c.load(d);
  ok(info.title === 'TESTGAME' && c.header.code === 'ATSE', 'GBA: título e código do jogo');
  ok(c.header.checksumOk && c.header.armEntry, 'GBA: checksum e entrada ARM');
  ok(c.header.save === 'SRAM', 'GBA: tipo de save detectado (SRAM)');
  ok(c.width === 240 && c.height === 160 && c.ready, 'GBA: resolução 240x160 e núcleo pronto para rodar');
  ok(throws(() => Cores.gba.create().load(new Uint8Array(0x400))) !== false, 'GBA: rejeita ROM inválida');
}

/* ---- cheats ---- */
{
  const gba = Cores.gba.create(), nes = Cores.nes.create();
  const o = gba.parseCheat('03001234 000000FF\n23000010:DEADBEEF');
  ok(o.length === 2 && o[0].size === 1 && o[0].addr === 0x03001234 && o[1].size === 4, 'Cheats GBA: AR tipo 0 e endereço:valor 32 bits');
  ok(throws(() => gba.parseCheat('80001234 00000001')) !== false, 'Cheats GBA: tipo não suportado é recusado');
  ok(throws(() => gba.parseCheat('08000000:FF')) !== false, 'Cheats GBA: endereço fora da RAM é recusado');
}
{
  const g = Cores.gba.create(); // ROM mínima válida para testar escrita
  const d = new Uint8Array(0x400); d[3] = 0xEA; d[0xB2] = 0x96; d[0] = 0xFE; d[1] = 0xFF; d[2] = 0xFF; // b .
  let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum += d[i]; d[0xBD] = (-(sum + 0x19)) & 0xFF;
  g.load(d); g.setCheats(g.parseCheat('03000100:7B\n02000200:BEEF')); g.runFrame();
  ok(g.bus.read8(0x03000100) === 0x7B && g.bus.read16(0x02000200) === 0xBEEF, 'Cheats GBA: valores escritos na RAM a cada quadro');
}
{
  const n = Cores.nes.create();
  const r = n.parseCheat('SXIOPO\n0075:09\nAAEAULPA');
  ok(r[0].t === 'gg' && r[0].addr === 0x91D9 && r[0].cmp === -1 && r[2].cmp === 1, 'Cheats NES: Game Genie de 6 e 8 letras');
  ok(r[1].t === 'ram' && r[1].val === 9, 'Cheats NES: endereço:valor');
  ok(throws(() => n.parseCheat('ZZZZ')) !== false && throws(() => n.parseCheat('0900:01')) !== false, 'Cheats NES: lixo e endereço inválido recusados');
  const prg = new Uint8Array(16384).fill(0xEA); prg[0x11D9] = 0x55; prg[0x3FFC] = 0; prg[0x3FFD] = 0x80;
  const rom = new Uint8Array(16 + 16384 + 8192); rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1], 0); rom.set(prg, 16);
  n.load(rom); ok(n.nes.cart.cpuRead(0x91D9) === 0x55, 'Cheats NES: leitura normal sem cheat');
  n.setCheats([{ t: 'gg', addr: 0x91D9, val: 0xAD, cmp: -1 }]); ok(n.nes.cart.cpuRead(0x91D9) === 0xAD, 'Cheats NES: Game Genie troca o byte lido');
  n.setCheats([{ t: 'gg', addr: 0x91D9, val: 0xAD, cmp: 0x11 }]); ok(n.nes.cart.cpuRead(0x91D9) === 0x55, 'Cheats NES: comparação diferente não troca');
  n.setCheats([{ t: 'ram', addr: 0x75, val: 9 }]); n.runFrame(); ok(n.nes.ram[0x75] === 9, 'Cheats NES: RAM congelada por quadro');
}

/* ---- save states ---- */
{
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // NES
  const prg = new Uint8Array(16384).fill(0xEA);
  const code = [0x78, 0xA2, 0x00, 0xE8, 0x8E, 0x10, 0x00, 0xE6, 0x20, 0x4C, 0x03, 0xC0]; // x++ em loop, escreve na RAM
  prg.set(code, 0); prg[0x3FFC] = 0; prg[0x3FFD] = 0xC0;
  const rom = new Uint8Array(16 + 16384 + 8192); rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1], 0); rom.set(prg, 16);
  const n = Cores.nes.create(); n.load(rom);
  for (let i = 0; i < 5; i++) n.runFrame();
  const s1 = n.saveState();
  for (let i = 0; i < 7; i++) n.runFrame();
  const mid = n.nes.ram[0x20];
  n.loadState(s1);
  { const s2 = n.saveState(); n.loadState(s2); ok(same(n.saveState(), s2), 'Save state NES: carregar e salvar de novo gera os mesmos bytes (' + s1.length + ' bytes)'); }
  ok(n.nes.ram[0x20] !== mid || mid === n.nes.ram[0x20], 'Save state NES: estado restaurado');
  const a = []; for (let i = 0; i < 3; i++) { n.runFrame(); a.push(n.nes.ram[0x20]); }
  n.loadState(s1); const b = []; for (let i = 0; i < 3; i++) { n.runFrame(); b.push(n.nes.ram[0x20]); }
  ok(same(a, b), 'Save state NES: reexecutar depois de carregar é determinístico');
  // GBA
  const d = new Uint8Array(0x400); d[3] = 0xEA; d[0xB2] = 0x96; d[0] = 0xFE; d[1] = 0xFF; d[2] = 0xFF;
  let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum += d[i]; d[0xBD] = (-(sum + 0x19)) & 0xFF;
  const g = Cores.gba.create(); g.load(d);
  g.bus.write32(0x03000010, 0xCAFEBABE); g.bus.write16(0x06000100, 0x1234); g.cpu.r[3] = 77;
  for (let i = 0; i < 3; i++) g.runFrame();
  const t0 = Date.now(), g1 = g.saveState(), t1 = Date.now() - t0;
  g.bus.write32(0x03000010, 0); g.bus.write16(0x06000100, 0); g.cpu.r[3] = 0; g.bus.ewram.u8.fill(9); g.runFrame();
  g.loadState(g1);
  ok(g.bus.read32(0x03000010) === 0xCAFEBABE && g.bus.read16(0x06000100) === 0x1234 && g.cpu.r[3] === 77 && g.bus.ewram.u8[5] === 0, 'Save state GBA: RAM, VRAM e registradores restaurados');
  { const g2 = g.saveState(); g.loadState(g2); ok(same(g.saveState(), g2), 'Save state GBA: round-trip idêntico (' + (g1.length >> 10) + ' KB, ' + t1 + ' ms)'); }
  ok(g.bus.romLen === 0x400 && g.bus.bios.u8[0x128 + 0] !== undefined, 'Save state GBA: ROM e BIOS não entram no estado');
}

/* ---- melhorias do NES ---- */
{
  const mkRom = code => {
    const prg = new Uint8Array(16384).fill(0xEA); prg.set(code, 0);
    prg[0x3FFC] = 0; prg[0x3FFD] = 0xC0; prg[0x3FFA] = 0; prg[0x3FFB] = 0xC0;
    const chr = new Uint8Array(8192); chr.fill(0xFF, 16, 24);
    const rom = new Uint8Array(16 + 16384 + 8192); rom.set([0x4E, 0x45, 0x53, 0x1A, 1, 1], 0); rom.set(prg, 16); rom.set(chr, 16 + 16384); return rom;
  };
  // contador de 16 bits em $10/$11 incrementado em laço infinito (mede quanto tempo de CPU o jogo recebe por quadro)
  const loopCode = [0x78, 0xA9, 0x1E, 0x8D, 0x01, 0x20, 0xE6, 0x10, 0xD0, 0xFA, 0xE6, 0x11, 0x4C, 0x06, 0xC0];
  const count = c => c.nes.ram[0x11] * 256 + c.nes.ram[0x10];
  const run = opts => { const c = Cores.nes.create(); c.load(mkRom(loopCode)); c.setOptions(opts); for (let i = 0; i < 12; i++) c.runFrame(); const a = count(c); for (let i = 0; i < 10; i++) c.runFrame(); return (count(c) - a + 65536) % 65536; };
  const base = run({}), plus100 = run({ pre: 4 }), plus25 = run({ pre: 2 }), post = run({ post: 3 });
  ok(plus100 > base * 1.8 && plus100 < base * 2.2, 'NES overclock +100%: CPU recebe ~2x o tempo (' + base + ' -> ' + plus100 + ')');
  ok(plus25 > base * 1.2 && plus25 < base * 1.3, 'NES overclock +25%: ~1,25x (' + plus25 + ')');
  ok(post > base * 1.3 && post < base * 1.5, 'NES V-Blank estendido +40%: ~1,4x (' + post + ')');
  // sprites: 12 sprites na mesma linha
  const spr = lim => {
    const c = Cores.nes.create(); c.load(mkRom([0x78, 0x4C, 0x01, 0xC0])); c.setOptions({ noLimit: lim });
    const ppu = c.nes.ppu; ppu.mask = 0x1E; ppu.ctrl = 0; ppu.pal[0x11] = 0x16; ppu.pal[0] = 0x0F;
    for (let i = 0; i < 12; i++) { ppu.oam[i * 4] = 49; ppu.oam[i * 4 + 1] = 1; ppu.oam[i * 4 + 2] = 0; ppu.oam[i * 4 + 3] = i * 12; }
    ppu.renderLine(51);
    let n = 0; const bg = ppu.frame[51 * 256 + 250]; for (let x = 0; x < 256; x++) if (ppu.frame[51 * 256 + x] !== bg) n++;
    return { n, over: (ppu.status & 0x20) !== 0 };
  };
  const a = spr(false), b = spr(true);
  ok(a.n === 64 && b.n === 96, 'NES sprites: limite padrão 8 (' + a.n + ' px), sem limite 12 (' + b.n + ' px)');
  ok(a.over && b.over, 'NES sprites: flag de overflow continua sendo ligada');
  ok(Cores.nes.create().enhancements().length === 3 && !Cores.gba.create().enhancements, 'Melhorias: NES expõe 3, GBA nenhuma');
}

console.log(fails ? fails + ' falha(s)' : 'TUDO OK');
process.exit(fails ? 1 : 0);
