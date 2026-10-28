// Testes da CPU ARM7TDMI com programas montados à mão (ARM e Thumb)
const { GBABus } = require('../../src/cores/gba/bus.js');
const { ARM7, GBA_MODE_IRQ, GBA_MODE_SVC, GBA_MODE_SYS, GBA_MODE_UND } = require('../../src/cores/gba/cpu.js');

let fails = 0, total = 0;
const eq = (got, want, msg) => {
  total++;
  const g = got >>> 0, w = want >>> 0;
  if (g !== w) { fails++; console.log('FALHOU:', msg, '- obtido 0x' + g.toString(16) + ', esperado 0x' + w.toString(16)); }
  else console.log('ok:', msg);
};

/* ---------- montador mínimo ---------- */
const AL = 14;
const DP = { AND: 0, EOR: 1, SUB: 2, RSB: 3, ADD: 4, ADC: 5, SBC: 6, RSC: 7, TST: 8, TEQ: 9, CMP: 10, CMN: 11, ORR: 12, MOV: 13, BIC: 14, MVN: 15 };
function armImm(v) {
  for (let r = 0; r < 16; r++) {
    const rot = 2 * r, val = rot ? (((v << rot) | (v >>> (32 - rot))) >>> 0) : v >>> 0;
    if (val <= 0xFF) return (r << 8) | val;
  }
  throw new Error('imediato não codificável: ' + v.toString(16));
}
const dpI = (op, s, rn, rd, imm, cond = AL) => ((cond << 28) | (1 << 25) | (DP[op] << 21) | (s << 20) | (rn << 16) | (rd << 12) | armImm(imm)) >>> 0;
const dpR = (op, s, rn, rd, rm, type = 0, amt = 0, cond = AL) => ((cond << 28) | (DP[op] << 21) | (s << 20) | (rn << 16) | (rd << 12) | (amt << 7) | (type << 5) | rm) >>> 0;
const ldst = (L, B, P, U, W, rn, rd, off, cond = AL) => ((cond << 28) | (1 << 26) | (P << 24) | (U << 23) | (B << 22) | (W << 21) | (L << 20) | (rn << 16) | (rd << 12) | off) >>> 0;
const block = (L, P, U, W, rn, list) => ((AL << 28) | (1 << 27) | (P << 24) | (U << 23) | (W << 21) | (L << 20) | (rn << 16) | list) >>> 0;
const branch = (link, from, to, cond = AL) => ((cond << 28) | (5 << 25) | (link << 24) | ((((to - (from + 8)) >> 2)) & 0xFFFFFF)) >>> 0;
const bx = rm => ((AL << 28) | 0x012FFF10 | rm) >>> 0;
const mul = (rd, rm, rs) => ((AL << 28) | (rd << 16) | (rs << 8) | 0x90 | rm) >>> 0;
const umull = (lo, hi, rm, rs) => ((AL << 28) | 0x00800000 | (hi << 16) | (lo << 12) | (rs << 8) | 0x90 | rm) >>> 0;
const smull = (lo, hi, rm, rs) => ((AL << 28) | 0x00C00000 | (hi << 16) | (lo << 12) | (rs << 8) | 0x90 | rm) >>> 0;
const swi = n => ((AL << 28) | (0xF << 24) | n) >>> 0;
const mrs = rd => ((AL << 28) | 0x010F0000 | (rd << 12)) >>> 0;
const msrReg = (fields, rm) => ((AL << 28) | 0x0120F000 | (fields << 16) | rm) >>> 0;
const ldrh = (rn, rd, off) => ((AL << 28) | (1 << 24) | (1 << 23) | (1 << 22) | (1 << 20) | (rn << 16) | (rd << 12) | ((off >> 4) << 8) | 0xB0 | (off & 15)) >>> 0;
const strh = (rn, rd, off) => ((AL << 28) | (1 << 24) | (1 << 23) | (1 << 22) | (rn << 16) | (rd << 12) | ((off >> 4) << 8) | 0xB0 | (off & 15)) >>> 0;
const ldrsb = (rn, rd, off) => ((AL << 28) | (1 << 24) | (1 << 23) | (1 << 22) | (1 << 20) | (rn << 16) | (rd << 12) | ((off >> 4) << 8) | 0xD0 | (off & 15)) >>> 0;

const T = {
  movI: (rd, i) => 0x2000 | (rd << 8) | i, cmpI: (rd, i) => 0x2800 | (rd << 8) | i,
  addI: (rd, i) => 0x3000 | (rd << 8) | i, subI: (rd, i) => 0x3800 | (rd << 8) | i,
  shift: (op, rd, rs, off) => (op << 11) | (off << 6) | (rs << 3) | rd,
  addR: (rd, rs, rn) => 0x1800 | (rn << 6) | (rs << 3) | rd, subR: (rd, rs, rn) => 0x1A00 | (rn << 6) | (rs << 3) | rd,
  addI3: (rd, rs, n) => 0x1C00 | (n << 6) | (rs << 3) | rd, subI3: (rd, rs, n) => 0x1E00 | (n << 6) | (rs << 3) | rd,
  alu: (op, rd, rs) => 0x4000 | (op << 6) | (rs << 3) | rd,
  bx: rs => 0x4700 | (rs << 3),
  movHi: (rd, rs) => 0x4600 | ((rd >> 3) << 7) | ((rs >> 3) << 6) | ((rs & 7) << 3) | (rd & 7),
  ldrPc: (rd, w8) => 0x4800 | (rd << 8) | w8,
  strI: (rd, rb, off) => 0x6000 | ((off >> 2) << 6) | (rb << 3) | rd, ldrI: (rd, rb, off) => 0x6800 | ((off >> 2) << 6) | (rb << 3) | rd,
  push: (list, lr) => 0xB400 | (lr << 8) | list, pop: (list, pc) => 0xBC00 | (pc << 8) | list,
  bcond: (cond, from, to) => 0xD000 | (cond << 8) | ((((to - (from + 4)) >> 1)) & 0xFF),
  b: (from, to) => 0xE000 | ((((to - (from + 4)) >> 1)) & 0x7FF),
  bl1: (from, to) => 0xF000 | ((((to - (from + 4)) >> 12)) & 0x7FF),
  bl2: (from, to) => 0xF800 | ((((to - (from + 4)) >> 1)) & 0x7FF),
  stmia: (rb, list) => 0xC000 | (rb << 8) | list, ldmia: (rb, list) => 0xC800 | (rb << 8) | list,
  swi: n => 0xDF00 | n
};

const BASE = 0x03000000;
function make() {
  const bus = new GBABus(), cpu = new ARM7(bus);
  cpu.reset(true); // modo SYS, I=0
  cpu.r[15] = BASE;
  return { bus, cpu };
}
function loadArm(bus, words, at = BASE) { words.forEach((w, k) => bus.iwram.u32[((at & 0x7FFF) >> 2) + k] = w); }
function loadThumb(bus, hw, at) { hw.forEach((w, k) => bus.iwram.u16[((at & 0x7FFF) >> 1) + k] = w); }
const run = (cpu, n) => { for (let k = 0; k < n; k++) cpu.step(); };

/* ================= ARM: dados e flags ================= */
{
  const { bus, cpu } = make();
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 5),          // r0 = 5
    dpI('ADD', 0, 0, 1, 3),          // r1 = 8
    dpI('SUB', 1, 1, 2, 8),          // r2 = 0, Z=1, C=1
  ]);
  run(cpu, 3);
  eq(cpu.r[1], 8, 'ARM: ADD imediato');
  eq(cpu.r[2], 0, 'ARM: SUBS resultado zero');
  eq(cpu.z, 1, 'ARM: SUBS seta Z'); eq(cpu.c, 1, 'ARM: SUBS sem borrow seta C');
}
{
  const { bus, cpu } = make();
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 0x40000000), // r0 = 0x40000000
    dpR('ADD', 1, 0, 1, 0),          // ADDS r1 = r0 + r0 = 0x80000000
  ]);
  run(cpu, 2);
  eq(cpu.r[1], 0x80000000, 'ARM: ADDS overflow resultado');
  eq(cpu.v, 1, 'ARM: ADDS seta V'); eq(cpu.n, 1, 'ARM: ADDS seta N'); eq(cpu.c, 0, 'ARM: ADDS sem carry');
}
{
  const { bus, cpu } = make();
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 0x80000000),
    dpR('MOV', 1, 0, 1, 0, 1, 31),   // MOVS r1, r0, LSR #31
    dpR('MOV', 1, 0, 2, 0, 0, 1),    // MOVS r2, r0, LSL #1
    dpR('MOV', 0, 0, 3, 0, 2, 0),    // MOV r3, r0, ASR #32 (amt 0 => 32)
    dpR('MOV', 0, 0, 4, 0, 3, 4),    // MOV r4, r0, ROR #4
  ]);
  run(cpu, 3);
  eq(cpu.r[1], 1, 'ARM: LSR #31'); eq(cpu.r[2], 0, 'ARM: LSL #1 estoura'); eq(cpu.c, 1, 'ARM: LSL #1 carry = bit 31');
  run(cpu, 2);
  eq(cpu.r[3], 0xFFFFFFFF, 'ARM: ASR #32 propaga sinal'); eq(cpu.r[4], 0x08000000, 'ARM: ROR #4');
}
{
  const { bus, cpu } = make();
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 7),
    dpI('CMP', 1, 0, 0, 7),                       // Z=1
    dpI('MOV', 0, 0, 1, 1, 0),                    // MOVEQ r1,#1
    dpI('MOV', 0, 0, 2, 2, 1),                    // MOVNE r2,#2 (não executa)
    dpI('ADC', 0, 0, 3, 0),                       // r3 = r0 + 0 + C (C=1 após CMP igual)
  ]);
  run(cpu, 5);
  eq(cpu.r[1], 1, 'ARM: MOVEQ executa'); eq(cpu.r[2], 0, 'ARM: MOVNE não executa'); eq(cpu.r[3], 8, 'ARM: ADC usa carry');
}
{
  const { bus, cpu } = make();
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 3),
    dpI('MOV', 0, 0, 1, 4),
    dpR('SUB', 1, 0, 2, 1),                       // SUBS r2 = 3 - 4 = -1, N=1, C=0
    dpI('RSB', 0, 0, 3, 10),                      // r3 = 10 - r0 = 7
    dpR('BIC', 0, 0, 4, 1),                       // r4 = r0 & ~r1 = 3
    dpR('MVN', 0, 0, 5, 0),                       // r5 = ~3
  ]);
  run(cpu, 6);
  eq(cpu.r[2], 0xFFFFFFFF, 'ARM: SUBS negativo'); eq(cpu.n, 1, 'ARM: N'); eq(cpu.c, 0, 'ARM: borrow limpa C');
  eq(cpu.r[3], 7, 'ARM: RSB'); eq(cpu.r[4], 3, 'ARM: BIC'); eq(cpu.r[5], 0xFFFFFFFC, 'ARM: MVN');
}
{ // PC como operando vale instrução + 8
  const { bus, cpu } = make();
  loadArm(bus, [dpR('MOV', 0, 0, 0, 15)]);
  run(cpu, 1);
  eq(cpu.r[0], BASE + 8, 'ARM: ler PC = endereço + 8');
}

/* ================= ARM: desvios ================= */
{
  const { bus, cpu } = make();
  loadArm(bus, [
    branch(0, BASE, BASE + 12),      // B +12 (pula a próxima)
    dpI('MOV', 0, 0, 0, 0xAA),       // pulada
    dpI('MOV', 0, 0, 0, 0xBB),       // pulada
    dpI('MOV', 0, 0, 1, 0x11),       // alvo
    branch(1, BASE + 16, BASE + 28), // BL sub
    dpI('MOV', 0, 0, 3, 0x33),       // volta aqui
    branch(0, BASE + 24, BASE + 24), // fim (laço)
    dpI('MOV', 0, 0, 2, 0x22),       // sub:
    bx(14),
  ]);
  run(cpu, 6);
  eq(cpu.r[0], 0, 'ARM: B pulou instruções'); eq(cpu.r[1], 0x11, 'ARM: caiu no alvo');
  eq(cpu.r[14], BASE + 20, 'ARM: BL guarda endereço de retorno'); eq(cpu.r[2], 0x22, 'ARM: executou sub-rotina'); eq(cpu.r[3], 0x33, 'ARM: BX LR retornou');
}

/* ================= ARM: load/store ================= */
{
  const { bus, cpu } = make();
  cpu.r[1] = 0x02000000;
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 0x78), ldst(0, 0, 1, 1, 0, 1, 0, 4),         // STR r0,[r1,#4]
    ldst(1, 0, 1, 1, 0, 1, 2, 4),                                    // LDR r2,[r1,#4]
    ldst(1, 1, 1, 1, 0, 1, 3, 4),                                    // LDRB r3,[r1,#4]
    dpI('ADD', 0, 1, 4, 5),                                          // r4 = r1 + 5 (desalinhado)
    ldst(1, 0, 1, 1, 0, 4, 5, 0),                                    // LDR r5,[r4] (rotaciona)
    ldst(0, 0, 0, 1, 0, 1, 0, 8),                                    // STR r0,[r1],#8 (pós-indexado)
  ]);
  run(cpu, 7);
  eq(cpu.r[2], 0x78, 'ARM: STR/LDR'); eq(cpu.r[3], 0x78, 'ARM: LDRB');
  eq(cpu.r[5], 0x78000000, 'ARM: LDR desalinhado (endereço+1) rotaciona 8 bits');
  eq(cpu.r[1], 0x02000008, 'ARM: pós-indexado faz writeback');
  eq(bus.ewram.u32[0], 0x78, 'ARM: STR pós-indexado gravou no endereço antigo');
}
{ // LDR desalinhado com valor identificável
  const { bus, cpu } = make();
  bus.ewram.u32[0] = 0x44332211;
  cpu.r[1] = 0x02000001;
  loadArm(bus, [ldst(1, 0, 1, 1, 0, 1, 2, 0)]);
  run(cpu, 1);
  eq(cpu.r[2], 0x11443322, 'ARM: LDR em endereço+1 = ROR 8');
}
{ // halfword e signed
  const { bus, cpu } = make();
  bus.ewram.u32[0] = 0x8180FF7F;
  cpu.r[1] = 0x02000000;
  loadArm(bus, [ldrh(1, 2, 0), ldrsb(1, 3, 1), ldrsb(1, 4, 0), dpI('MOV', 0, 0, 5, 0xAB), strh(1, 5, 8)]);
  run(cpu, 5);
  eq(cpu.r[2], 0xFF7F, 'ARM: LDRH'); eq(cpu.r[3], 0xFFFFFFFF, 'ARM: LDRSB extensão de sinal'); eq(cpu.r[4], 0x7F, 'ARM: LDRSB positivo');
  eq(bus.ewram.u16[4], 0xAB, 'ARM: STRH');
}
{ // LDM / STM
  const { bus, cpu } = make();
  cpu.r[13] = 0x03007F00;
  cpu.r[0] = 0xA; cpu.r[1] = 0xB; cpu.r[2] = 0xC; cpu.r[14] = 0xE;
  loadArm(bus, [
    block(0, 1, 0, 1, 13, 0x4007),  // STMDB sp!,{r0-r2,lr}
    dpI('MOV', 0, 0, 0, 0), dpI('MOV', 0, 0, 1, 0), dpI('MOV', 0, 0, 2, 0), dpI('MOV', 0, 0, 14, 0),
    block(1, 0, 1, 1, 13, 0x4007),  // LDMIA sp!,{r0-r2,lr}
  ]);
  run(cpu, 1);
  eq(cpu.r[13], 0x03007F00 - 16, 'ARM: STMDB atualiza sp');
  eq(bus.iwram.u32[(0x7F00 - 16) >> 2], 0xA, 'ARM: STMDB r0 no endereço mais baixo');
  eq(bus.iwram.u32[(0x7F00 - 4) >> 2], 0xE, 'ARM: STMDB lr no endereço mais alto');
  run(cpu, 5);
  eq(cpu.r[0], 0xA, 'ARM: LDMIA r0'); eq(cpu.r[2], 0xC, 'ARM: LDMIA r2'); eq(cpu.r[14], 0xE, 'ARM: LDMIA lr'); eq(cpu.r[13], 0x03007F00, 'ARM: LDMIA restaura sp');
}

/* ================= ARM: multiplicação ================= */
{
  const { bus, cpu } = make();
  cpu.r[0] = 1000; cpu.r[1] = 3000; cpu.r[2] = 0xFFFFFFFF; cpu.r[3] = 2;
  loadArm(bus, [mul(4, 0, 1), umull(5, 6, 2, 3), smull(7, 8, 2, 3)]);
  run(cpu, 3);
  eq(cpu.r[4], 3000000, 'ARM: MUL');
  eq(cpu.r[5], 0xFFFFFFFE, 'ARM: UMULL baixo'); eq(cpu.r[6], 1, 'ARM: UMULL alto');
  eq(cpu.r[7], 0xFFFFFFFE, 'ARM: SMULL baixo (-1*2)'); eq(cpu.r[8], 0xFFFFFFFF, 'ARM: SMULL alto (sinal)');
}

/* ================= modos, SWI, IRQ ================= */
{
  const { bus, cpu } = make();
  // vetor SWI em 0x08: MOV r5,#0x77 ; MOVS pc,lr
  bus.bios.u32[2] = dpI('MOV', 0, 0, 5, 0x77);
  bus.bios.u32[3] = dpR('MOV', 1, 0, 15, 14);
  loadArm(bus, [swi(0x12), dpI('MOV', 0, 0, 6, 0x66)]);
  cpu.step();
  eq(cpu.mode, GBA_MODE_SVC, 'SWI: entra em modo SVC'); eq(cpu.r[15], 8, 'SWI: pula para o vetor 0x08'); eq(cpu.r[14], BASE + 4, 'SWI: LR = próxima instrução');
  run(cpu, 2);
  eq(cpu.mode, GBA_MODE_SYS, 'SWI: MOVS pc,lr restaura o modo'); eq(cpu.r[5], 0x77, 'SWI: handler executou'); eq(cpu.r[15], BASE + 4, 'SWI: voltou após o SWI');
  cpu.step();
  eq(cpu.r[6], 0x66, 'SWI: execução continua');
}
{ // IRQ
  const { bus, cpu } = make();
  bus.bios.u32[6] = dpI('MOV', 0, 0, 6, 1);                 // 0x18: MOV r6,#1
  bus.bios.u32[7] = dpI('SUB', 1, 14, 15, 4);                // SUBS pc,lr,#4
  loadArm(bus, [dpI('MOV', 0, 0, 0, 1), dpI('MOV', 0, 0, 1, 2)]);
  cpu.step();
  cpu.irqPending = true;
  cpu.step();
  cpu.irqPending = false;
  eq(cpu.mode, GBA_MODE_IRQ, 'IRQ: entra em modo IRQ'); eq(cpu.i, 1, 'IRQ: mascara IRQs'); eq(cpu.r[14], BASE + 8, 'IRQ: LR = próxima + 4');
  run(cpu, 2);
  eq(cpu.r[6], 1, 'IRQ: handler executou'); eq(cpu.mode, GBA_MODE_SYS, 'IRQ: retorno restaura modo'); eq(cpu.r[15], BASE + 4, 'IRQ: retoma na instrução interrompida');
  cpu.step();
  eq(cpu.r[1], 2, 'IRQ: programa continua normalmente');
}
{ // registradores "banked": sp por modo
  const { bus, cpu } = make();
  cpu.r[13] = 0x1111;
  loadArm(bus, [
    dpI('MOV', 0, 0, 0, 0x12), msrReg(1, 0),   // MSR cpsr_c, r0 (modo IRQ)
    dpI('MOV', 0, 0, 13, 0x22), dpI('MOV', 0, 0, 1, 0x1F), msrReg(1, 1), // volta SYS
    mrs(2),
  ]);
  run(cpu, 2);
  eq(cpu.mode, GBA_MODE_IRQ, 'MSR: trocou para IRQ');
  run(cpu, 1);
  eq(cpu.r[13], 0x22, 'banco: sp do IRQ');
  run(cpu, 2);
  eq(cpu.mode, GBA_MODE_SYS, 'MSR: voltou para SYS'); eq(cpu.r[13], 0x1111, 'banco: sp do SYS preservado');
  run(cpu, 1);
  eq(cpu.r[2] & 0x1F, 0x1F, 'MRS: lê CPSR');
}
{ // instrução indefinida
  const { bus, cpu } = make();
  loadArm(bus, [0xE7F000F0]);
  cpu.step();
  eq(cpu.mode, GBA_MODE_UND, 'UND: entra em modo indefinido'); eq(cpu.r[15], 4, 'UND: vetor 0x04');
}

/* ================= Thumb ================= */
{ // entra em Thumb via BX; programa em 0x03000040
  const { bus, cpu } = make();
  const TB = BASE + 0x40;
  loadArm(bus, [dpI('MOV', 0, 0, 0, BASE), dpI('ADD', 0, 0, 0, 0x41), bx(0)]);
  const code = [
    T.movI(0, 200),                        // 40
    T.addI(0, 100),                        // 42: r0 = 300
    T.movI(1, 3),                          // 44
    T.shift(0, 2, 1, 4),                   // 46: LSL r2,r1,#4 = 48
    T.subI3(3, 0, 7),                      // 48: r3 = 293
    T.alu(13, 2, 1),                       // 4A: MUL r2 = r2*r1 = 144
    T.movI(5, 0),                          // 4C
    T.cmpI(3, 255),                        // 4E: 293-255 => C=1, Z=0
    T.bcond(1, TB + 0x50, TB + 0x56),      // 50: BNE +... (pula o MOV r5,#9)
    T.movI(5, 9),                          // 52 (pulada)
    T.movI(5, 9),                          // 54 (pulada)
    T.movI(6, 0x66),                       // 56: alvo
    T.push(0x03, 1),                       // 58: PUSH {r0,r1,lr}
    T.movI(0, 0), T.movI(1, 0),            // 5A, 5C
    T.pop(0x03, 0),                        // 5E: POP {r0,r1}
    T.bl1(TB + 0x60, TB + 0x70), T.bl2(TB + 0x60, TB + 0x70), // 60/62: BL sub
    T.movI(7, 0x77),                       // 64
    T.b(TB + 0x66, TB + 0x66),             // 66: laço
    T.movI(4, 0x55), T.movI(4, 0x55),      // 68, 6A (preenchimento)
    T.movI(4, 0x55), T.movI(4, 0x55),      // 6C, 6E
    T.movI(4, 0x55),                       // 70: sub
    T.bx(14),                              // 72
  ];
  loadThumb(bus, code, TB);
  run(cpu, 3);
  eq(cpu.t, 1, 'Thumb: BX entrou em modo Thumb'); eq(cpu.r[15], TB, 'Thumb: PC no alvo');
  run(cpu, 6);
  eq(cpu.r[0], 300, 'Thumb: MOV/ADD imediato'); eq(cpu.r[2], 144, 'Thumb: LSL + MUL'); eq(cpu.r[3], 293, 'Thumb: SUB imediato de 3 bits');
  eq(cpu.c, 1, 'Thumb: CMP seta C'); eq(cpu.z, 0, 'Thumb: CMP limpa Z');
  run(cpu, 4);
  eq(cpu.r[5], 0, 'Thumb: BNE pulou'); eq(cpu.r[6], 0x66, 'Thumb: alvo do BNE executado');
  run(cpu, 5);
  eq(cpu.r[0], 300, 'Thumb: PUSH/POP restaura r0'); eq(cpu.r[1], 3, 'Thumb: PUSH/POP restaura r1');
  run(cpu, 1);
  eq(cpu.r[14], (BASE + 0x64) | 1, 'Thumb: BL guarda retorno com bit 0');
  run(cpu, 3);
  eq(cpu.r[4], 0x55, 'Thumb: sub-rotina via BL'); eq(cpu.r[7], 0x77, 'Thumb: BX LR retorna ao Thumb');
}
{ // Thumb: LDR relativo a PC, STR/LDR, hi regs, SWI
  const { bus, cpu } = make();
  const TB = BASE + 0x80;
  cpu.t = 1; cpu.r[15] = TB;
  bus.iwram.u32[0x90 >> 2] = 0xCAFEBABE;
  cpu.r[1] = 0x02000000;
  loadThumb(bus, [
    T.ldrPc(0, 3),                         // 80: r0 = [(pc&~3)+12] = 0x84+... => endereço 0x90
    T.strI(0, 1, 4),                       // 82: STR r0,[r1,#4]
    T.ldrI(2, 1, 4),                       // 84: LDR r2,[r1,#4]
    T.movI(3, 5),                          // 86
    T.movHi(8, 3),                         // 88: MOV r8, r3
    T.addI(3, 1),                          // 8A
    T.movHi(4, 8),                         // 8C: MOV r4, r8
  ], TB);
  run(cpu, 7);
  eq(cpu.r[0], 0xCAFEBABE, 'Thumb: LDR relativo a PC'); eq(cpu.r[2], 0xCAFEBABE, 'Thumb: STR/LDR imediato');
  eq(cpu.r[8], 5, 'Thumb: MOV para registrador alto'); eq(cpu.r[4], 5, 'Thumb: MOV de registrador alto');
}
{ // Thumb: ALU flags e shifts por registrador
  const { bus, cpu } = make();
  const TB = BASE + 0x80;
  cpu.t = 1; cpu.r[15] = TB;
  cpu.r[0] = 0x80000000; cpu.r[1] = 1; cpu.r[2] = 0xFF;
  loadThumb(bus, [
    T.alu(3, 0, 1),                        // LSR r0, r1 (r0 >>= 1) = 0x40000000
    T.alu(9, 3, 2),                        // NEG r3, r2 = -255
    T.alu(5, 4, 1),                        // ADC r4, r1 (r4=0 + 1 + C)
    T.alu(15, 5, 1),                       // MVN r5, r1
  ], TB);
  run(cpu, 4);
  eq(cpu.r[0], 0x40000000, 'Thumb: LSR por registrador'); eq(cpu.r[3], 0xFFFFFF01, 'Thumb: NEG'); eq(cpu.r[5], 0xFFFFFFFE, 'Thumb: MVN');
}
{ // Thumb: STMIA/LDMIA e SWI
  const { bus, cpu } = make();
  const TB = BASE + 0x80;
  cpu.t = 1; cpu.r[15] = TB;
  cpu.r[0] = 0x02000100; cpu.r[1] = 11; cpu.r[2] = 22;
  bus.bios.u32[2] = dpI('MOV', 0, 0, 7, 0x5A); // handler SWI
  loadThumb(bus, [T.stmia(0, 0x06), T.movI(1, 0), T.movI(2, 0), T.ldmia(0, 0x00), T.swi(3)], TB);
  cpu.r[3] = 0x02000100;
  loadThumb(bus, [T.stmia(0, 0x06), T.movI(1, 0), T.movI(2, 0), T.alu(0, 0, 0), T.swi(3)], TB);
  run(cpu, 1);
  eq(cpu.r[0], 0x02000108, 'Thumb: STMIA writeback');
  eq(bus.ewram.u32[0x40], 11, 'Thumb: STMIA r1'); eq(bus.ewram.u32[0x41], 22, 'Thumb: STMIA r2');
  run(cpu, 4);
  eq(cpu.mode, GBA_MODE_SVC, 'Thumb: SWI entra em SVC'); eq(cpu.t, 0, 'Thumb: exceção volta para ARM'); eq(cpu.r[14], TB + 8 + 2, 'Thumb: LR do SWI');
}

console.log(fails ? '\n' + fails + ' falha(s) de ' + total : '\nTUDO OK (' + total + ' verificações)');
process.exit(fails ? 1 : 0);
