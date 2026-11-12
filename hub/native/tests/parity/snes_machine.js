// Máquina SNES completa (CPU+sistema+PPU+APU) do JS, para comparar com o módulo nativo.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../../src/cores/snes/');
const src = ['cpu', 'ppu', 'spc', 'snes', 'core'].map(f => fs.readFileSync(root + f + '.js', 'utf8')).join('\n');
const { SNESCore } = new Function('module', 'GSU', 'SA1', 'emuStateSave', 'emuStateLoad', src + '\nreturn {SNESCore};')({}, null, null, null, null);
const rom = new Uint8Array(fs.readFileSync(process.argv[2])), frames = +process.argv[3];
const c = new SNESCore(); c.load(rom); c.audio.setSampleRate(48000);
let H = 0x811c9dc5; const mix = v => { H = Math.imul(H ^ (v >>> 0), 16777619) >>> 0; };
const HS = { v: 0x811c9dc5, a: 0x811c9dc5, w: 0x811c9dc5 }; let cur = 'v'; const mx = v => { HS[cur] = Math.imul(HS[cur] ^ (v >>> 0), 16777619) >>> 0; };
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
for (let f = 0; f < frames; f++) {
  c.setButtons((f * 0x155) & 0xFFF); c.runFrame();
  cur = 'v'; const fr = c.frame; for (let i = 0; i < fr.length; i++) mx(fr[i]); mx(c.width); mx(c.height);
  const n = c.audio.buffered(), out = new Float32Array(Math.min(n, 2048)); c.audio.fill(out);
  cur = 'a'; mx(n); for (let i = 0; i < out.length; i++) { f32[0] = out[i]; mx(u32[0]); }
}
cur = 'w'; const s = c.snes; for (let i = 0; i < s.wram.length; i++) mx(s.wram[i]);
console.log(HS.v, HS.a, HS.w);
