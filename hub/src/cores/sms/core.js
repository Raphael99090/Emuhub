/* Adaptador Master System / Game Gear -> interface comum de núcleos do hub.
 * Máscara de botões: A=1 B=2 SEL=4 START=8 UP=16 DOWN=32 LEFT=64 RIGHT=128 (A/B = botões 1/2; START = Pause no SMS) */
const SMS_SKIP = new Set(['rom', 'frame', 'lineBuf', 'prioBuf', 'sprMask', 'sprList', 'sprUsed', 'tilePix', 'abuf', 'gfx']);

class SMSCore {
  constructor(gg) {
    this.gg = !!gg; this.id = this.gg ? 'gg' : 'sms'; this.name = this.gg ? 'Game Gear' : 'Master System';
    this.width = this.gg ? 160 : 256; this.height = this.gg ? 144 : 192; this.ready = false;
    this.m = new SMS(this.gg);
    this.gfx = this.gg ? new Uint32Array(160 * 144) : null;
    const psg = this.m.psg;
    this.audio = {
      buffered: () => psg.buffered(),
      fill: o => psg.fill(o),
      setSampleRate: sr => psg.setSampleRate(sr),
      setVolume: v => { psg.volume = v; }
    };
    this.ramCheats = null; this.header = null;
  }
  get frame() { return this.gg ? this.gfx : this.m.vdp.frame; }
  parseHeader(rom) {
    for (const o of [0x7FF0, 0x3FF0, 0x1FF0]) {
      if (o + 16 <= rom.length && rom[o] === 0x54 && rom[o + 1] === 0x4D && rom[o + 2] === 0x52 && rom[o + 3] === 0x20 && rom[o + 4] === 0x53) {
        const reg = rom[o + 15] >> 4;
        return { found: true, region: reg, product: ((rom[o + 12] | (rom[o + 13] << 8)).toString(16)).toUpperCase(), isGG: reg >= 5 && reg <= 7 };
      }
    }
    return { found: false };
  }
  load(u8) {
    if (u8.length < 0x2000) throw new Error('Arquivo pequeno demais para ser uma ROM de ' + this.name + '.');
    const m = this.m, h = this.parseHeader(u8.length % 0x4000 === 512 ? u8.subarray(512) : u8); this.header = h;
    m.load(u8);
    this.romHash = 0; for (let i = 0; i < Math.min(u8.length, 65536); i++) this.romHash = (this.romHash * 31 + u8[i]) >>> 0;
    this.ready = true;
    const lines = [
      'Mapeador: ' + (m.mapper === 'codemasters' ? 'Codemasters' : 'Sega padrão') + ', ROM: ' + (m.rom.length >> 10) + ' KB',
      h.found ? 'Cabeçalho TMR SEGA encontrado (região ' + h.region + ')' : 'Sem cabeçalho TMR SEGA (ROM antiga, ou de outro sistema)'
    ];
    if (h.found && h.isGG !== this.gg) lines.push('Atenção: pelo cabeçalho esta ROM é de ' + (h.isGG ? 'Game Gear' : 'Master System') + '; abra no console certo se a imagem sair estranha');
    return { title: this.name, lines };
  }
  reset() { this.m.reset(); }
  setButtons(b) { this.m.setButtons(b); }
  runFrame() {
    const m = this.m; m.runFrame(); this.applyCheats();
    if (this.gg) { // janela de 160x144 dentro dos 256x192
      const src = m.vdp.frame, dst = this.gfx;
      for (let y = 0; y < 144; y++) { const s = (y + 24) * 256 + 48, d = y * 160; for (let x = 0; x < 160; x++) dst[d + x] = src[s + x]; }
    }
  }
  saveState() { return emuStateSave(this.m, SMS_SKIP); }
  loadState(u8) {
    emuStateLoad(this.m, SMS_SKIP, u8);
    const v = this.m.vdp, n = this.gg ? 32 : 32; for (let i = 0; i < n; i++) v.setPal(i);
    this.m.psg.rp = this.m.psg.wp; v.updateIrq();
  }
  /* ---- cheats: Action Replay 00AAAAVV ou endereço:valor (RAM C000-DFFF / E000-FFFF) ---- */
  parseCheat(text) {
    const ops = [];
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim().replace(/^(00[0-9A-F]{2})-/i, '$1'); if (!line) continue; // formato do libretro: 00C5-3809
      let m, addr, val;
      if ((m = /^00([0-9A-F]{4})([0-9A-F]{2})$/i.exec(line)) || (m = /^([0-9A-F]{4}):([0-9A-F]{2})$/i.exec(line))) { addr = parseInt(m[1], 16); val = parseInt(m[2], 16); }
      else throw new Error('Formato não reconhecido: "' + line + '". Use endereço:valor (ex.: C123:09) ou Action Replay 00C12309.');
      if (addr < 0xC000) throw new Error('Só dá para alterar a RAM (C000 a FFFF).');
      ops.push({ addr, val });
    }
    if (!ops.length) throw new Error('Digite um código.');
    return ops;
  }
  setCheats(ops) { this.ramCheats = ops.length ? ops : null; }
  applyCheats() { const r = this.ramCheats; if (!r) return; const m = this.m; for (let i = 0; i < r.length; i++) m.ram[r[i].addr & 0x1FFF] = r[i].val; }
  enhancements() { return []; }
  setOptions() {}
  /* ---- RAM do cartucho (bateria) ---- */
  sramKey() { return (this.gg ? 'gg_' : 'sms_') + this.romHash; } // a chave vale desde o início para o save antigo ser restaurado
  sramData() { return this.m.ramDirty ? this.m.cartRam : new Uint8Array(0); } // vazio = nunca usou RAM de cartucho, nada é gravado
  sramRestore(u8) { this.m.cartRam.set(u8.subarray(0, this.m.cartRam.length)); this.m.ramDirty = true; }
}
class GGCore extends SMSCore { constructor() { super(true); } }

if (typeof module !== 'undefined') module.exports = { SMSCore, GGCore };
