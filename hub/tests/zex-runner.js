// roda prelim/zexdoc/zexall (CP/M) no Z80 do hub
const fs=require('fs');
const {Z80}=require(require('path').join(__dirname,'..','src','cores','sms','z80.js'));
const file=process.argv[2], limit=+process.argv[3]||1e12;
const mem=new Uint8Array(65536);
const rom=fs.readFileSync(file); mem.set(rom,0x100);
let out='',done=false;
const bus={read:a=>mem[a],write:(a,v)=>{mem[a]=v},portIn:p=>0,portOut:(p,v)=>{}};
const cpu=new Z80(bus);
cpu.pc=0x100;cpu.sp=0xF000;
let total=0,lastPrint=Date.now();
function bdos(){
  const c=cpu.R[1];
  if(c===2){out+=String.fromCharCode(cpu.R[3]);process.stdout.write(String.fromCharCode(cpu.R[3]));}
  else if(c===9){let a=cpu.de;while(mem[a]!==0x24){process.stdout.write(String.fromCharCode(mem[a]));a++;}}
}
while(!done&&total<limit){
  if(cpu.pc===0){done=true;break;}
  if(cpu.pc===5){bdos();cpu.pc=cpu.pop();continue;}
  total+=cpu.step();
}
console.log('\n[fim] ciclos',total);
