'use strict';
/* CPU 6502 com tabela de opcodes e ciclos */
/* ================================ CPU ================================= */
const OPTEXT = `
00 BRK imp 7
01 ORA izx 6
05 ORA zp 3
06 ASL zp 5
08 PHP imp 3
09 ORA imm 2
0A ASL acc 2
0D ORA abs 4
0E ASL abs 6
10 BPL rel 2
11 ORA izy 5
15 ORA zpx 4
16 ASL zpx 6
18 CLC imp 2
19 ORA aby 4
1D ORA abx 4
1E ASL abx 7
20 JSR abs 6
21 AND izx 6
24 BIT zp 3
25 AND zp 3
26 ROL zp 5
28 PLP imp 4
29 AND imm 2
2A ROL acc 2
2C BIT abs 4
2D AND abs 4
2E ROL abs 6
30 BMI rel 2
31 AND izy 5
35 AND zpx 4
36 ROL zpx 6
38 SEC imp 2
39 AND aby 4
3D AND abx 4
3E ROL abx 7
40 RTI imp 6
41 EOR izx 6
45 EOR zp 3
46 LSR zp 5
48 PHA imp 3
49 EOR imm 2
4A LSR acc 2
4C JMP abs 3
4D EOR abs 4
4E LSR abs 6
50 BVC rel 2
51 EOR izy 5
55 EOR zpx 4
56 LSR zpx 6
58 CLI imp 2
59 EOR aby 4
5D EOR abx 4
5E LSR abx 7
60 RTS imp 6
61 ADC izx 6
65 ADC zp 3
66 ROR zp 5
68 PLA imp 4
69 ADC imm 2
6A ROR acc 2
6C JMP ind 5
6D ADC abs 4
6E ROR abs 6
70 BVS rel 2
71 ADC izy 5
75 ADC zpx 4
76 ROR zpx 6
78 SEI imp 2
79 ADC aby 4
7D ADC abx 4
7E ROR abx 7
81 STA izx 6
84 STY zp 3
85 STA zp 3
86 STX zp 3
88 DEY imp 2
8A TXA imp 2
8C STY abs 4
8D STA abs 4
8E STX abs 4
90 BCC rel 2
91 STA izy 6
94 STY zpx 4
95 STA zpx 4
96 STX zpy 4
98 TYA imp 2
99 STA aby 5
9A TXS imp 2
9D STA abx 5
A0 LDY imm 2
A1 LDA izx 6
A2 LDX imm 2
A4 LDY zp 3
A5 LDA zp 3
A6 LDX zp 3
A8 TAY imp 2
A9 LDA imm 2
AA TAX imp 2
AC LDY abs 4
AD LDA abs 4
AE LDX abs 4
B0 BCS rel 2
B1 LDA izy 5
B4 LDY zpx 4
B5 LDA zpx 4
B6 LDX zpy 4
B8 CLV imp 2
B9 LDA aby 4
BA TSX imp 2
BC LDY abx 4
BD LDA abx 4
BE LDX aby 4
C0 CPY imm 2
C1 CMP izx 6
C4 CPY zp 3
C5 CMP zp 3
C6 DEC zp 5
C8 INY imp 2
C9 CMP imm 2
CA DEX imp 2
CC CPY abs 4
CD CMP abs 4
CE DEC abs 6
D0 BNE rel 2
D1 CMP izy 5
D5 CMP zpx 4
D6 DEC zpx 6
D8 CLD imp 2
D9 CMP aby 4
DD CMP abx 4
DE DEC abx 7
E0 CPX imm 2
E1 SBC izx 6
E4 CPX zp 3
E5 SBC zp 3
E6 INC zp 5
E8 INX imp 2
E9 SBC imm 2
EA NOP imp 2
EB SBC imm 2
EC CPX abs 4
ED SBC abs 4
EE INC abs 6
F0 BEQ rel 2
F1 SBC izy 5
F5 SBC zpx 4
F6 INC zpx 6
F8 SED imp 2
F9 SBC aby 4
FD SBC abx 4
FE INC abx 7
A7 LAX zp 3
B7 LAX zpy 4
AF LAX abs 4
BF LAX aby 4
A3 LAX izx 6
B3 LAX izy 5
87 SAX zp 3
97 SAX zpy 4
8F SAX abs 4
83 SAX izx 6
`;
const OPIDS = {ADC: 0, AND: 1, ASL: 2, BCC: 3, BCS: 4, BEQ: 5, BIT: 6, BMI: 7, BNE: 8, BPL: 9, BRK: 10, BVC: 11, BVS: 12, CLC: 13, CLD: 14, CLI: 15, CLV: 16, CMP: 17, CPX: 18, CPY: 19, DEC: 20, DEX: 21, DEY: 22, EOR: 23, INC: 24, INX: 25, INY: 26, JMP: 27, JSR: 28, LAX: 29, LDA: 30, LDX: 31, LDY: 32, LSR: 33, ORA: 34, PHA: 35, PHP: 36, PLA: 37, PLP: 38, ROL: 39, ROR: 40, RTI: 41, RTS: 42, SAX: 43, SBC: 44, SEC: 45, SED: 46, SEI: 47, STA: 48, STX: 49, STY: 50, TAX: 51, TAY: 52, TSX: 53, TXA: 54, TXS: 55, TYA: 56};
const OPID = new Uint8Array(256);
const MODES = { imp: 0, acc: 1, imm: 2, zp: 3, zpx: 4, zpy: 5, abs: 6, abx: 7, aby: 8, ind: 9, izx: 10, izy: 11, rel: 12 };
const OPNAME = new Array(256).fill('NOP'), OPMODE = new Uint8Array(256), OPCYC = new Uint8Array(256).fill(2), OPPEN = new Uint8Array(256);
(function () {
  const READ = new Set(['ORA', 'AND', 'EOR', 'ADC', 'LDA', 'CMP', 'SBC', 'LDX', 'LDY', 'LAX']);
  for (const line of OPTEXT.trim().split('\n')) {
    const [h, n, m, c] = line.trim().split(/\s+/);
    const op = parseInt(h, 16);
    OPNAME[op] = n; OPMODE[op] = MODES[m]; OPCYC[op] = +c;
    if (READ.has(n) && (m === 'abx' || m === 'aby' || m === 'izy')) OPPEN[op] = 1;
  }
  const nop = (list, mode, cyc, pen) => { for (const o of list) { OPNAME[o] = 'NOP'; OPMODE[o] = mode; OPCYC[o] = cyc; OPPEN[o] = pen ? 1 : 0; } };
  nop([0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA], 0, 2);
  nop([0x80, 0x82, 0x89, 0xC2, 0xE2], 2, 2);
  nop([0x04, 0x44, 0x64], 3, 3);
  nop([0x0C], 6, 4);
  nop([0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4], 4, 4);
  nop([0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC], 7, 4, true);
})();

for (let o = 0; o < 256; o++) OPID[o] = OPIDS[OPNAME[o]] === undefined ? 255 : OPIDS[OPNAME[o]];

class CPU {
  constructor(nes) { this.nes = nes; this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFD; this.p = 0x24; this.pc = 0; this.stall = 0; }
  reset() {
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFD; this.p = 0x24; this.stall = 0;
    this.pc = this.read16(0xFFFC);
  }
  read(a) { return this.nes.cpuRead(a); }
  write(a, v) { this.nes.cpuWrite(a, v); }
  read16(a) { return this.read(a) | (this.read((a + 1) & 0xFFFF) << 8); }
  fetch() { const v = this.nes.cpuRead(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  push(v) { this.write(0x100 + this.sp, v); this.sp = (this.sp - 1) & 0xFF; }
  pull() { this.sp = (this.sp + 1) & 0xFF; return this.read(0x100 + this.sp); }
  push16(v) { this.push(v >> 8); this.push(v & 0xFF); }
  pull16() { const l = this.pull(); return l | (this.pull() << 8); }
  zn(v) { this.p = (this.p & 0x7D) | (v & 0x80) | (v === 0 ? 2 : 0); return v; }
  interrupt(vec) {
    this.push16(this.pc); this.push((this.p & ~0x10) | 0x20);
    this.p |= 4; this.pc = this.read16(vec);
  }
  adc(v) {
    const a = this.a, s = a + v + (this.p & 1), r = s & 0xFF;
    this.p = (this.p & ~0x41) | (s > 0xFF ? 1 : 0) | ((~(a ^ v) & (a ^ r) & 0x80) ? 0x40 : 0);
    this.a = this.zn(r);
  }
  cmp(reg, v) { this.p = (this.p & ~1) | (reg >= v ? 1 : 0); this.zn((reg - v) & 0xFF); }
  branch(cond, off) {
    if (!cond) return 0;
    const old = this.pc; this.pc = (old + off) & 0xFFFF;
    return ((old & 0xFF00) !== (this.pc & 0xFF00)) ? 2 : 1;
  }
  shift(mode, addr, kind) {
    const v = mode === 1 ? this.a : this.read(addr), c = this.p & 1;
    let r, nc;
    switch (kind) {
      case 0: r = (v << 1) & 0xFF; nc = v >> 7; break;       // ASL
      case 1: r = v >> 1; nc = v & 1; break;                 // LSR
      case 2: r = ((v << 1) | c) & 0xFF; nc = v >> 7; break; // ROL
      default: r = (v >> 1) | (c << 7); nc = v & 1;          // ROR
    }
    this.p = (this.p & ~1) | nc; this.zn(r);
    if (mode === 1) this.a = r; else this.write(addr, r);
  }

  step() {
    if (this.stall > 0) { this.stall--; return 1; }
    const nes = this.nes;
    if (nes.nmi) { nes.nmi = false; this.interrupt(0xFFFA); return 7; }
    if ((this.p & 4) === 0 && nes.irqLine()) { this.interrupt(0xFFFE); return 7; }

    const op = this.fetch(), mode = OPMODE[op];
    let cyc = OPCYC[op], addr = 0, crossed = false, base;
    switch (mode) {
      case 2: addr = this.pc; this.pc = (this.pc + 1) & 0xFFFF; break;
      case 3: addr = this.fetch(); break;
      case 4: addr = (this.fetch() + this.x) & 0xFF; break;
      case 5: addr = (this.fetch() + this.y) & 0xFF; break;
      case 6: addr = this.fetch(); addr |= this.fetch() << 8; break;
      case 7: base = this.fetch(); base |= this.fetch() << 8; addr = (base + this.x) & 0xFFFF; crossed = (base & 0xFF00) !== (addr & 0xFF00); break;
      case 8: base = this.fetch(); base |= this.fetch() << 8; addr = (base + this.y) & 0xFFFF; crossed = (base & 0xFF00) !== (addr & 0xFF00); break;
      case 9: {
        let ptr = this.fetch(); ptr |= this.fetch() << 8;
        addr = this.read(ptr) | (this.read((ptr & 0xFF00) | ((ptr + 1) & 0xFF)) << 8); break;
      }
      case 10: { const z = (this.fetch() + this.x) & 0xFF; addr = this.read(z) | (this.read((z + 1) & 0xFF) << 8); break; }
      case 11: {
        const z = this.fetch(); base = this.read(z) | (this.read((z + 1) & 0xFF) << 8);
        addr = (base + this.y) & 0xFFFF; crossed = (base & 0xFF00) !== (addr & 0xFF00); break;
      }
      case 12: { const o = this.fetch(); addr = o < 128 ? o : o - 256; break; }
    }
    if (crossed && OPPEN[op]) cyc++;

    switch (OPID[op]) {
      case 30: /*LDA*/ this.a = this.zn(this.read(addr)); break;
      case 31: /*LDX*/ this.x = this.zn(this.read(addr)); break;
      case 32: /*LDY*/ this.y = this.zn(this.read(addr)); break;
      case 29: /*LAX*/ this.a = this.x = this.zn(this.read(addr)); break;
      case 48: /*STA*/ this.write(addr, this.a); break;
      case 49: /*STX*/ this.write(addr, this.x); break;
      case 50: /*STY*/ this.write(addr, this.y); break;
      case 43: /*SAX*/ this.write(addr, this.a & this.x); break;
      case 51: /*TAX*/ this.x = this.zn(this.a); break;
      case 52: /*TAY*/ this.y = this.zn(this.a); break;
      case 54: /*TXA*/ this.a = this.zn(this.x); break;
      case 56: /*TYA*/ this.a = this.zn(this.y); break;
      case 53: /*TSX*/ this.x = this.zn(this.sp); break;
      case 55: /*TXS*/ this.sp = this.x; break;
      case 35: /*PHA*/ this.push(this.a); break;
      case 37: /*PLA*/ this.a = this.zn(this.pull()); break;
      case 36: /*PHP*/ this.push(this.p | 0x30); break;
      case 38: /*PLP*/ this.p = (this.pull() & 0xEF) | 0x20; break;
      case 1: /*AND*/ this.a = this.zn(this.a & this.read(addr)); break;
      case 34: /*ORA*/ this.a = this.zn(this.a | this.read(addr)); break;
      case 23: /*EOR*/ this.a = this.zn(this.a ^ this.read(addr)); break;
      case 0: /*ADC*/ this.adc(this.read(addr)); break;
      case 44: /*SBC*/ this.adc(this.read(addr) ^ 0xFF); break;
      case 17: /*CMP*/ this.cmp(this.a, this.read(addr)); break;
      case 18: /*CPX*/ this.cmp(this.x, this.read(addr)); break;
      case 19: /*CPY*/ this.cmp(this.y, this.read(addr)); break;
      case 24: /*INC*/ this.write(addr, this.zn((this.read(addr) + 1) & 0xFF)); break;
      case 20: /*DEC*/ this.write(addr, this.zn((this.read(addr) - 1) & 0xFF)); break;
      case 25: /*INX*/ this.x = this.zn((this.x + 1) & 0xFF); break;
      case 26: /*INY*/ this.y = this.zn((this.y + 1) & 0xFF); break;
      case 21: /*DEX*/ this.x = this.zn((this.x - 1) & 0xFF); break;
      case 22: /*DEY*/ this.y = this.zn((this.y - 1) & 0xFF); break;
      case 2: /*ASL*/ this.shift(mode, addr, 0); break;
      case 33: /*LSR*/ this.shift(mode, addr, 1); break;
      case 39: /*ROL*/ this.shift(mode, addr, 2); break;
      case 40: /*ROR*/ this.shift(mode, addr, 3); break;
      case 6: /*BIT*/ { const v = this.read(addr); this.p = (this.p & 0x3D) | (v & 0xC0) | ((this.a & v) === 0 ? 2 : 0); break; }
      case 9: /*BPL*/ cyc += this.branch(!(this.p & 0x80), addr); break;
      case 7: /*BMI*/ cyc += this.branch((this.p & 0x80) !== 0, addr); break;
      case 11: /*BVC*/ cyc += this.branch(!(this.p & 0x40), addr); break;
      case 12: /*BVS*/ cyc += this.branch((this.p & 0x40) !== 0, addr); break;
      case 3: /*BCC*/ cyc += this.branch(!(this.p & 1), addr); break;
      case 4: /*BCS*/ cyc += this.branch((this.p & 1) !== 0, addr); break;
      case 8: /*BNE*/ cyc += this.branch(!(this.p & 2), addr); break;
      case 5: /*BEQ*/ cyc += this.branch((this.p & 2) !== 0, addr); break;
      case 27: /*JMP*/ this.pc = addr; break;
      case 28: /*JSR*/ this.push16((this.pc - 1) & 0xFFFF); this.pc = addr; break;
      case 42: /*RTS*/ this.pc = (this.pull16() + 1) & 0xFFFF; break;
      case 41: /*RTI*/ this.p = (this.pull() & 0xEF) | 0x20; this.pc = this.pull16(); break;
      case 10: /*BRK*/ this.pc = (this.pc + 1) & 0xFFFF; this.push16(this.pc); this.push(this.p | 0x30); this.p |= 4; this.pc = this.read16(0xFFFE); break;
      case 13: /*CLC*/ this.p &= ~1; break;
      case 45: /*SEC*/ this.p |= 1; break;
      case 15: /*CLI*/ this.p &= ~4; break;
      case 47: /*SEI*/ this.p |= 4; break;
      case 14: /*CLD*/ this.p &= ~8; break;
      case 46: /*SED*/ this.p |= 8; break;
      case 16: /*CLV*/ this.p &= ~0x40; break;
      default: break; // NOP
    }
    return cyc;
  }
}

