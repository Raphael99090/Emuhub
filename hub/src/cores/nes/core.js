/* Adaptador NES -> interface comum de núcleos do hub.
 * Todo núcleo expõe: id, name, width, height, frame (Uint32Array ABGR), ready, audio,
 * load(u8) -> {title, lines[]}, reset(), runFrame(), setButtons(mask),
 * sramKey(), sramData(), sramRestore(u8)
 * Máscara de botões: A=1 B=2 SEL=4 START=8 UP=16 DOWN=32 LEFT=64 RIGHT=128 X=256 Y=512 L=1024 R=2048 */
const NES_MAPPERS = { 0: 'NROM', 1: 'MMC1 (SxROM)', 2: 'UxROM', 3: 'CNROM', 4: 'MMC3 (TxROM)', 7: 'AxROM' };

const NES_SKIP_RAM = new Set(['prg', 'frame', 'buf', 'gg', 'ggOps', 'ramCheats', 'noLimit', 'xPre', 'xPost', 'inExtra']);
const NES_SKIP = new Set(['prg', 'chr', 'frame', 'buf', 'gg', 'ggOps', 'ramCheats', 'noLimit', 'xPre', 'xPost', 'inExtra']);

class NESCore {
  constructor() {
    this.id = 'nes'; this.name = 'NES'; this.width = 256; this.height = 240; this.ready = false;
    this.nes = new NES();
    const apu = this.nes.apu;
    this.audio = {
      buffered: () => apu.buffered(),
      fill: o => apu.fill(o),
      setSampleRate: sr => apu.setSampleRate(sr),
      setVolume: v => { apu.volume = v; }
    };
  }
  get frame() { return this.nes.ppu.frame; }
  load(u8) {
    this.nes.load(u8); this.ready = true;
    if (this.ggOps && this.ggOps.length) this.nes.cart.gg = this.ggOps;
    const c = this.nes.cart;
    return {
      title: 'ROM de NES',
      lines: [
        'Mapper ' + c.mapper + ' (' + (NES_MAPPERS[c.mapper] || 'desconhecido') + ')',
        'PRG ' + (c.prg.length >> 10) + ' KB, CHR ' + (c.chrRam ? 'RAM' : (c.chr.length >> 10) + ' KB'),
        'Bateria: ' + (c.battery ? 'sim' : 'não')
      ]
    };
  }
  /* ---- cheats: Game Genie (6/8 letras) e RAM "ENDERECO:VALOR" ---- */
  parseCheat(text) {
    const L = 'APZLGITYEOXUKSVN', ops = [];
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim(); if (!line) continue;
      let m;
      if ((m = /^([APZLGITYEOXUKSVN]{6}|[APZLGITYEOXUKSVN]{8})$/i.exec(line))) {
        const n = Array.from(m[1].toUpperCase(), c => L.indexOf(c));
        const addr = 0x8000 + (((n[3] & 7) << 12) | ((n[5] & 7) << 8) | ((n[4] & 8) << 8) | ((n[2] & 7) << 4) | ((n[1] & 8) << 4) | (n[4] & 7) | (n[3] & 8));
        const last = n.length === 8 ? n[7] : n[5];
        const val = ((n[1] & 7) << 4) | ((n[0] & 8) << 4) | (n[0] & 7) | (last & 8);
        const cmp = n.length === 8 ? (((n[7] & 7) << 4) | ((n[6] & 8) << 4) | (n[6] & 7) | (n[5] & 8)) : -1;
        ops.push({ t: 'gg', addr, val, cmp });
      } else if ((m = /^([0-9A-F]{4})\s*[:=]\s*([0-9A-F]{2})$/i.exec(line))) {
        const addr = parseInt(m[1], 16);
        if (addr >= 0x800 && (addr < 0x6000 || addr > 0x7FFF)) throw new Error('Endereço ' + m[1].toUpperCase() + ' fora da RAM do NES (0000-07FF ou 6000-7FFF).');
        ops.push({ t: 'ram', addr, val: parseInt(m[2], 16) });
      } else throw new Error('Formato não reconhecido: "' + line + '". Use Game Genie (ex.: SXIOPO) ou ENDEREÇO:VALOR (ex.: 0075:09).');
    }
    if (!ops.length) throw new Error('Digite um código.');
    return ops;
  }
  setCheats(ops) {
    this.ramCheats = ops.filter(o => o.t === 'ram');
    const gg = ops.filter(o => o.t === 'gg');
    if (this.nes.cart) this.nes.cart.gg = gg.length ? gg : null;
    this.ggOps = gg;
  }
  applyCheats() {
    const r = this.ramCheats; if (!r || !r.length) return;
    const n = this.nes;
    for (let i = 0; i < r.length; i++) { const o = r[i]; if (o.addr < 0x800) n.ram[o.addr] = o.val; else n.cart.prgRam[o.addr - 0x6000] = o.val; }
  }
  saveState() { const c = this.nes.cart; return emuStateSave(this.nes, c && c.chrRam ? NES_SKIP_RAM : NES_SKIP); }
  loadState(u8) { const c = this.nes.cart; emuStateLoad(this.nes, c && c.chrRam ? NES_SKIP_RAM : NES_SKIP, u8); const a = this.nes.apu; a.rp = a.wp; }
  /* ---- melhorias opcionais (por jogo) ---- */
  enhancements() {
    return [
      { id: 'noLimit', type: 'toggle', label: 'Sem limite de 8 sprites por linha', hint: 'Acaba com o pisca-pisca dos personagens. Alguns jogos usam o limite de propósito.' },
      { id: 'pre', type: 'choice', label: 'Overclock da CPU', choices: ['Desligado', '+10%', '+25%', '+50%', '+100%'], hint: 'Dá mais tempo à CPU antes de cada quadro e reduz a lentidão (Mega Man, Contra, Castlevania). Gasta mais processamento.' },
      { id: 'post', type: 'choice', label: 'V-Blank estendido', choices: ['Desligado', '+8%', '+20%', '+40%'], hint: 'Mais tempo para o jogo atualizar a tela no intervalo entre quadros. Útil quando aparecem falhas gráficas.' }
    ];
  }
  setOptions(o) {
    const n = this.nes, PRE = [0, 26, 65, 131, 262], POST = [0, 21, 52, 105];
    n.noLimit = !!o.noLimit; n.xPre = PRE[o.pre | 0] || 0; n.xPost = POST[o.post | 0] || 0;
  }
  reset() { this.nes.reset(); }
  runFrame() { this.nes.runFrame(); this.applyCheats(); }
  setButtons(m) { this.nes.setButtons(m & 0xFF); }
  sramKey() {
    const c = this.nes.cart;
    if (!c || !c.battery) return null;
    let h = 0; for (let i = 0; i < Math.min(c.prg.length, 65536); i++) h = (h * 31 + c.prg[i]) >>> 0;
    return 'nes_' + h;
  }
  sramData() { return this.nes.cart.prgRam; }
  sramRestore(u8) { this.nes.cart.prgRam.set(u8.subarray(0, 8192)); this.nes.reset(); }
}
