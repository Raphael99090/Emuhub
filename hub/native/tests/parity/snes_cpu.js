const fs=require('fs');
const src=fs.readFileSync(''+require('path').join(__dirname,'../../../src/cores/')+'snes/cpu.js','utf8');
const {CPU65816}=new Function('module',src+'\nreturn {CPU65816};')({});
const seed=+process.argv[2],steps=+process.argv[3];
const mem=new Uint8Array(1<<20);let s=seed>>>0;for(let i=0;i<mem.length;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;mem[i]=s>>>24;if(mem[i]===0xDB)mem[i]=0xEA;}
const bus={nmiPending:false,irqLine:false,gsuIrq:false,cyc:0,read(a){this.cyc+=6;return mem[a&0xFFFFF];},write(a,v){this.cyc+=6;mem[a&0xFFFFF]=v;},idle(n){this.cyc+=6*n;}};
const c=new CPU65816(bus);c.reset();let bad=-1,n=0;
for(;n<steps;n++){ if(n%37===36)bus.nmiPending=true; bus.irqLine=(n%91)>60;
  try{c.step();}catch(e){bad=parseInt(e.message.split(': ')[1],16);break;} }
let h=0x811c9dc5;for(let i=0;i<mem.length;i++)h=Math.imul(h^mem[i],16777619)>>>0;
console.log([n,bad,bus.cyc,h,c.a,c.x,c.y,c.s,c.d,c.db,c.pb,c.pc,c.p,c.e,c.wai?1:0,c.stp?1:0].join(' '));
