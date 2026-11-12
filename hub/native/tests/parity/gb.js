const fs=require('fs'),path=require('path');
const root=''+require('path').join(__dirname,'../../../src/cores/')+'';
const files=['shared/state','gb/cpu','gb/apu','gb/ppu','gb/gb'].map(f=>fs.readFileSync(root+f+'.js','utf8'));
const {GB}=new Function('module',files.join('\n')+'\nreturn {GB};')({});
function rom(seed){const r=new Uint8Array(0x8000);let s=seed>>>0;for(let i=0x150;i<0x8000;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;r[i]=s>>>24;}
 // jump from entry to 0x150, keep header zero
 r.set([0xC3,0x50,0x01],0x100);return r;}
const seed=+process.argv[2],frames=+process.argv[3];
const g=new GB();g.load(rom(seed));let h=0x811c9dc5>>>0;
for(let f=0;f<frames;f++){g.runFrame();const fr=g.ppu.frame;for(let i=0;i<fr.length;i++)h=Math.imul(h^fr[i],16777619)>>>0;}
const c=g.cpu;console.log(h,c.pc,c.sp,c.a,c.b,c.c,c.d,c.e,c.h,c.l);
