// Paridade do sistema SNES (barramento, DMA/HDMA, IRQ/NMI, joypad) com PPU/APU de mentira determinísticos.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../../src/cores/snes/');
const src = ['cpu', 'snes'].map(f => fs.readFileSync(root + f + '.js', 'utf8')).join('\n');
const stubs = `
class SNESPPU { constructor(){ this.h=1; this.regs=new Uint8Array(0x100); this.setini=0; }
  reset(){ this.h=1; this.regs.fill(0); this.setini=0; }
  readReg(a){ return (this.h>>>3)&255; }
  writeReg(a,v){ this.regs[a&255]=v; if((a&255)===0x33)this.setini=v; this.h=(Math.imul(this.h,31)+a*257+v)>>>0; }
  renderLine(y){ this.h=(Math.imul(this.h,17)+y)>>>0; } beginFrame(){ this.h=(this.h^0x1234)>>>0; } finishFrame(){ this.h=(this.h^0x4321)>>>0; } }
class SNESAPU { constructor(){ this.inPorts=new Uint8Array(4); this.outPorts=new Uint8Array(4); this.h=7; this.clock=0; this.portClock=0; }
  reset(){ this.inPorts.fill(0); this.h=7; }
  sync(cyc,line){ if(line) this.h=(this.h^cyc)>>>0; for(let i=0;i<4;i++) this.outPorts[i]=(this.inPorts[i]+(cyc>>4))&255; } }`;
const { SNES } = new Function('module', stubs + '\n' + src + '\nreturn {SNES};')({});
const seed = +process.argv[2], frames = +process.argv[3], hi = +process.argv[4] || 0;
const rom = new Uint8Array(1 << 17); let s = seed >>> 0;
for (let i = 0; i < rom.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; rom[i] = s >>> 24; if (rom[i] === 0xDB) rom[i] = 0xEA; }
const pro = [0xA9,0xB1,0x8D,0x00,0x42, 0xA9,0x40,0x8D,0x09,0x42, 0xA9,0x90,0x8D,0x07,0x42, 0xA9,0x01,0x8D,0x0D,0x42,
  0xA9,0x02,0x8D,0x00,0x43, 0xA9,0x26,0x8D,0x01,0x43, 0xA9,0x00,0x8D,0x02,0x43, 0xA9,0x90,0x8D,0x03,0x43, 0xA9,0x00,0x8D,0x04,0x43,
  0xA9,0x01,0x8D,0x10,0x43, 0xA9,0x18,0x8D,0x11,0x43, 0xA9,0x00,0x8D,0x12,0x43, 0xA9,0x91,0x8D,0x13,0x43, 0xA9,0x00,0x8D,0x14,0x43,
  0xA9,0x20,0x8D,0x15,0x43, 0xA9,0x00,0x8D,0x16,0x43, 0xA9,0x02,0x8D,0x0B,0x42, 0xA9,0x01,0x8D,0x0C,0x42, 0x58];
rom.set(pro, 0); // início do banco 0 (LoROM: $8000; HiROM: bancos 00-3F mapeiam rom[off] em 8000-FFFF => usar $8000)
if (hi) { rom.fill(0xEA, 0, pro.length); rom.set(pro, 0x8000); rom[0xFFFC] = 0x00; rom[0xFFFD] = 0x80; }
else { rom[0x7FFC] = 0x00; rom[0x7FFD] = 0x80; }
const g = new SNES(); g.load(rom, !!hi, 0x2000);
let tog = 0;
for (let f = 0; f < frames; f++) { g.setButtons((f * 0x155) & 0xFFF); g.runFrame(); }
const hash = a => { let h = 0x811c9dc5; for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619) >>> 0; return h; };
const c = g.cpu;
console.log([g.cyc, g.line, hash(g.wram), hash(g.sram), g.ppu.h, g.apu.h, c.a, c.x, c.y, c.s, c.d, c.db, c.pb, c.pc, c.p, c.e, g.rdnmi, g.timeup, g.nmitimen].join(' '));
