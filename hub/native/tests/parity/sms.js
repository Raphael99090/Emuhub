// Paridade SMS/GG: ROM pseudoaleatória (escritas aleatórias no VDP/PSG + código aleatório), compara quadro, registradores e áudio.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../../src/cores/');
const files = ['shared/state', 'sms/z80', 'sms/vdp', 'sms/psg', 'sms/sms'].map(f => fs.readFileSync(root + f + '.js', 'utf8'));
const { SMS } = new Function('module', files.join('\nvar __d=0;\n') + '\nreturn {SMS};')({});
function rom(seed) {
  const r = new Uint8Array(0x8000); let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
  for (let i = 0x100; i < 0x8000; i++) r[i] = rnd();
  r.set([0xF3, 0xED, 0x56, 0xC3, 0x00, 0x01], 0);                              // DI; IM 1; JP 0100
  r.set([0xF5, 0xDB, 0xBF, 0xF1, 0xFB, 0xED, 0x4D], 0x38);                     // IRQ: lê o status; RETI
  r.set([0xED, 0x45], 0x66);                                                    // NMI: RETN
  let pc = 0x100; r.set([0x31, 0xF0, 0xDF], pc); pc += 3;                       // LD SP,DFF0
  for (let k = 0; k < 900; k++) {                                               // LD A,n; OUT (porta),A
    const p = [0xBF, 0xBE, 0xBE, 0x7F][rnd() & 3]; r.set([0x3E, rnd(), 0xD3, p], pc); pc += 4;
  }
  r.set([0xFB, 0x76, 0x18, 0xFD], pc);                                          // EI; HALT; JR -3
  return r;
}
const seed = +process.argv[2], frames = +process.argv[3], gg = +process.argv[4] ? true : false, btn = +(process.argv[5] || 0);
const m = new SMS(gg); m.load(rom(seed)); m.psg.setSampleRate(44100); m.setButtons(btn);
let h = 0x811c9dc5 >>> 0;
for (let f = 0; f < frames; f++) {
  m.runFrame(); const fr = m.vdp.frame;
  if (gg) { for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) h = Math.imul(h ^ fr[(y + 24) * 256 + x + 48], 16777619) >>> 0; }   // janela do Game Gear
  else for (let i = 0; i < fr.length; i++) h = Math.imul(h ^ fr[i], 16777619) >>> 0;
}
let a = 0x811c9dc5 >>> 0; const n = m.psg.buffered(), buf = new Float32Array(n); m.psg.fill(buf);
const u = new Uint32Array(buf.buffer); for (let i = 0; i < n; i++) a = Math.imul(a ^ u[i], 16777619) >>> 0;
const c = m.cpu;
console.log(h, a, n, c.pc, c.sp, c.R[7], c.f, c.R[0], c.R[1], c.R[2], c.R[3], c.R[4], c.R[5], c.ix, c.iy);
