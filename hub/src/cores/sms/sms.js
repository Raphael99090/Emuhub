'use strict';
/* Máquina Master System / Game Gear: Z80 + VDP + PSG, mapeador Sega (e Codemasters), RAM 8 KB,
 * portas de E/S e controles. Sem BIOS: o estado de partida imita o fim da BIOS. */
const SMS_FRAME_LINES = 262;

class SMS {
  constructor(gg) {
    this.gg = !!gg;
    this.cpu = new Z80(this);
    this.vdp = new SMSVDP(this); this.vdp.gg = this.gg;
    this.psg = new SMSPsg();
    this.ram = new Uint8Array(0x2000);
    this.cartRam = new Uint8Array(0x8000);
    this.rom = new Uint8Array(0x4000); this.pages = 1; this.mapper = 'sega';
    this.bank = [0, 1, 2]; this.ramCtl = 0; this.ramDirty = false;
    this.buttons = 0; this.ioCtl = 0xFF; this.memCtl = 0; this.cyc = 0; this.debt = 0; this.nmiPrev = false;
  }
  load(rom) {
    let u8 = rom;
    if (u8.length % 0x4000 === 512) u8 = u8.subarray(512);
    const pages = Math.max(1, Math.ceil(u8.length / 0x4000));
    this.rom = new Uint8Array(pages * 0x4000); this.rom.set(u8); this.pages = pages;
    // Codemasters: soma de verificação em 0x7FE6 + complemento em 0x7FE8 = 0x10000
    this.mapper = 'sega';
    if (pages >= 2) {
      const a = this.rom[0x7FE6] | (this.rom[0x7FE7] << 8), b = this.rom[0x7FE8] | (this.rom[0x7FE9] << 8);
      if (a !== 0 && ((a + b) & 0xFFFF) === 0 && !this.hasSegaHeader()) this.mapper = 'codemasters';
    }
    this.reset();
  }
  hasSegaHeader() { const r = this.rom, o = [0x7FF0, 0x3FF0, 0x1FF0]; for (const h of o) if (r[h] === 0x54 && r[h + 1] === 0x4D && r[h + 2] === 0x52) return true; return false; }
  reset() {
    this.cpu.reset(); this.vdp.reset(); this.psg.reset(); this.ram.fill(0);
    this.bank = this.mapper === 'codemasters' ? [0, 1, 0] : [0, 1, 2]; this.ramCtl = 0;
    this.cpu.sp = 0xDFF0; this.cyc = 0; this.debt = 0;
  }
  pageOf(n) { return n % this.pages; }
  /* ---- memória ---- */
  read(a) {
    if (a < 0x4000) {
      if (a < 0x400) return this.rom[a];
      return this.rom[(this.pageOf(this.bank[0]) << 14) | a];
    }
    if (a < 0x8000) return this.rom[(this.pageOf(this.bank[1]) << 14) | (a & 0x3FFF)];
    if (a < 0xC000) {
      if (this.ramCtl & 8) return this.cartRam[((this.ramCtl & 4) ? 0x4000 : 0) | (a & 0x3FFF)];
      return this.rom[(this.pageOf(this.bank[2]) << 14) | (a & 0x3FFF)];
    }
    return this.ram[a & 0x1FFF];
  }
  write(a, v) {
    if (a >= 0xC000) {
      this.ram[a & 0x1FFF] = v;
      if (a >= 0xFFFC && this.mapper === 'sega') {
        if (a === 0xFFFC) this.ramCtl = v; else this.bank[a - 0xFFFD] = v;
      }
      return;
    }
    if (this.mapper === 'codemasters') {
      if (a === 0x0000) this.bank[0] = v; else if (a === 0x4000) this.bank[1] = v; else if (a === 0x8000) this.bank[2] = v;
      return;
    }
    if (a >= 0x8000 && (this.ramCtl & 8)) { this.cartRam[((this.ramCtl & 4) ? 0x4000 : 0) | (a & 0x3FFF)] = v; this.ramDirty = true; }
  }
  /* ---- portas ---- */
  portIn(p) {
    p &= 0xFF;
    if (this.gg && p < 7) {
      if (p === 0) return 0x40 | ((this.buttons & 8) ? 0 : 0x80) | 0x3F;
      return 0xFF;
    }
    switch (p & 0xC1) {
      case 0x40: return this.vdp.vcounter();
      case 0x41: return this.vdp.hcounter();
      case 0x80: return this.vdp.readData();
      case 0x81: return this.vdp.readStatus();
      case 0xC0: { // 0xDC / 0xC0: jogador 1 e parte do 2
        const b = this.buttons;
        return ~(((b & 16) ? 1 : 0) | ((b & 32) ? 2 : 0) | ((b & 64) ? 4 : 0) | ((b & 128) ? 8 : 0) | ((b & 1) ? 16 : 0) | ((b & 2) ? 32 : 0)) & 0xFF;
      }
      case 0xC1: { // 0xDD / 0xC1: reset e linhas TH
        const io = this.ioCtl;
        const th1 = (io & 2) ? 1 : (io >> 5) & 1, th2 = (io & 8) ? 1 : (io >> 7) & 1;
        return 0x3F | 0x10 | (th1 << 6) | (th2 << 7);
      }
    }
    return 0xFF;
  }
  portOut(p, v) {
    p &= 0xFF;
    if (this.gg && p < 7) return; // estéreo e comunicação serial
    switch (p & 0xC1) {
      case 0x00: this.memCtl = v; return;
      case 0x01: this.ioCtl = v; return;
      case 0x40: case 0x41: this.psg.write(v); return;
      case 0x80: this.vdp.writeData(v); return;
      case 0x81: this.vdp.writeCtrl(v); return;
    }
  }
  setButtons(m) {
    this.buttons = m;
    // Pause do SMS = NMI (borda de descida do botão)
    if (!this.gg) { const st = (m & 8) !== 0; if (st && !this.nmiPrev) this.cpu.nmi = true; this.nmiPrev = st; }
  }
  /* ---- um quadro ---- */
  runFrame() {
    const cpu = this.cpu, vdp = this.vdp, psg = this.psg;
    for (let line = 0; line < SMS_FRAME_LINES; line++) {
      vdp.startLine(line);
      let c = this.debt;
      while (c < SMS_CYC_LINE) {
        const t = cpu.step(); c += t; psg.tick(t);
        this.cyc = c;
      }
      this.debt = c - SMS_CYC_LINE;
    }
  }
}

if (typeof module !== 'undefined') module.exports = { SMS };
