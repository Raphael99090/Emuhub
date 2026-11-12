// Paridade do APU do SNES (SPC700 + DSP): RAM/DSP aleatórios, sincronização por linha, saída de áudio.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../../src/cores/snes/spc.js'), 'utf8');
const { SNESAPU } = new Function('module', src + '\nreturn {SNESAPU};')({});
const seed = +process.argv[2], frames = +process.argv[3];
let s = seed >>> 0; const r8 = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
const a = new SNESAPU({}); a.reset(); a.setSampleRate(48000);
for (let i = 0; i < 65536; i++) { let b = r8(); if (i >= 0x200 && (b === 0xEF || b === 0xFF)) b = 0; a.ram[i] = b; }
for (let r = 0; r < 128; r++) {
  let v = r8();
  if (r === 0x6C) v &= 0x3F; if (r === 0x7D) v &= 3; if (r === 0x7C) continue;
  if ((r & 15) === 5 && (r8() & 1)) v |= 0x80;
  if (r === 0x4C || r === 0x5C) continue;
  a.dsp[r] = v;
}
a.dspWrite(0x4C, r8() | 1);
a.pc = 0x200; a.sp = 0xEF; a.x = 0; a.running = true;
let H = 0x811c9dc5; const mix = v => { H = Math.imul(H ^ (v >>> 0), 16777619) >>> 0; };
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
let cyc = 0;
for (let f = 0; f < frames; f++) {
  for (let line = 0; line < 262; line++) {
    cyc += 1364; const t = 1364 + (r8() & 15);
    if ((line & 31) === 5) { a.sync(t); a.inPorts[r8() & 3] = r8(); a.portClock = a.clock; }
    if ((line & 31) === 9) { a.sync(t); mix(a.outPorts[r8() & 3]); }
    if ((line & 63) === 11) a.dspWrite(0x4C, r8());
    if ((line & 63) === 40) a.dspWrite(0x5C, r8());
    a.sync(t, true);
  }
  const n = a.buffered(); mix(n);
  const out = new Float32Array(Math.min(n, 1200)); a.fill(out);
  for (let i = 0; i < out.length; i++) { f32[0] = out[i]; mix(u32[0]); }
}
for (let i = 0; i < 65536; i++) mix(a.ram[i]);
for (let i = 0; i < 128; i++) mix(a.dsp[i]);
[a.a, a.x, a.y, a.sp, a.pc, a.psw(), a.running ? 1 : 0].forEach(mix);
console.log(H);
