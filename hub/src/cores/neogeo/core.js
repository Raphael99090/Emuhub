/* Adaptador Neo Geo -> interface comum de núcleos do hub.
 * Botões do hub: A=1 B=2 SEL=4 (moeda/select) START=8 direcionais 16..128, X=256 (C) Y=512 (D).
 * Jogos: ZIP estilo MAME (arquivos .p1 .s1 .m1 .v1 .c1 ...). BIOS: neogeo.zip (ou arquivos soltos). */
const NG_SKIP = new Set(['bios', 'sfix', 'zoom', 'sm1', 'p', 's', 'm1', 'spr1', 'spr2', 'frame', 'lineBuf', 'lineDepth', 'pcache', 'abuf', 'rom']);

class NeoGeoCore {
  constructor() {
    this.id = 'neogeo'; this.name = 'Neo Geo'; this.width = 320; this.height = 224; this.ready = false;
    this.m = new NeoGeo(); const ym = this.m.ym;
    this.audio = { buffered: () => ym.buffered(), fill: o => ym.fill(o), setSampleRate: sr => ym.setSampleRate(sr), setVolume: v => { ym.volume = v; } };
    this.romHash = 0; this.cheatOps = null; this.needsSet = true;
  }
  get frame() { return this.m.frame; }
  get hasBios() { return this.m.hasBios; }
  /* ---- ZIP de BIOS: [{name, data}] ---- */
  static parseBios(files) {
    const by = n => files.find(f => f.name.toLowerCase().split('/').pop() === n), nm = f => f.name.toLowerCase().split('/').pop();
    let bios = null;
    for (const n of ['neo-geo.rom', 'sp-s2.sp1', 'sp-s3.sp1', 'sp-s.sp1', 'sp-u2.sp1', 'sp-e.sp1', 'sp-45.sp1', 'uni-bios_4_0.rom', 'uni-bios_3_3.rom', 'neo-epo.bin', 'neo-po.bin', 'japan-j3.bin', 'vs-bios.rom']) { const f = by(n); if (f && f.data.length >= 0x20000) { bios = f.data; break; } }
    if (!bios) { const f = files.find(f => f.data.length === 0x20000 && !/sfix|sm1|lo\.lo|zoom|ng-lo/.test(nm(f))); if (f) bios = f.data; }
    const sf = files.find(f => /^(sfix\.(sfix|sfx)|ng-sfix\.rom)$/.test(nm(f))) || files.find(f => /^(ng-)?sfix/.test(nm(f)));
    const lo = files.find(f => /(000-lo\.lo|lo\.lo|zoom|^ng-lo\.rom$)/.test(nm(f))), sm = files.find(f => /^(ng-)?sm1/.test(nm(f)));
    if (!bios) throw new Error('Não achei a BIOS do Neo Geo no arquivo (procurei sp-s2.sp1, uni-bios, neo-epo.bin...). Use o neogeo.zip.');
    const vec = b => ((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) >>> 0;
    if ((vec(bios) >>> 20) !== 0xC) { const t = new Uint8Array(bios); for (let i = 0; i + 1 < t.length; i += 2) { t[i] = bios[i + 1]; t[i + 1] = bios[i]; } if ((vec(t) >>> 20) === 0xC) bios = t; } // BIOS com bytes trocados (dump antigo)
    return { bios, sfix: sf ? sf.data : null, zoom: lo ? lo.data : null, sm1: sm ? sm.data : null };
  }
  setBios(b) { this.m.setBios(b); }
  /* ---- ZIP do jogo (estilo MAME): [{name, data}] ---- */
  static parseSet(files) {
    const ext = f => (f.name.toLowerCase().split('/').pop().split('.').pop() || ''), num = f => +(ext(f).replace(/\D/g, '') || 0);
    const grp = ch => files.filter(f => new RegExp('^' + ch + '\\d+$').test(ext(f))).sort((a, b) => num(a) - num(b));
    const cat = list => { let n = 0; for (const f of list) n += f.data.length; const o = new Uint8Array(n); let p = 0; for (const f of list) { o.set(f.data, p); p += f.data.length; } return o; };
    const P = cat(grp('p')), S = cat(grp('s')), M = cat(grp('m')), V = cat(grp('v')), C = grp('c');
    if (!P.length) throw new Error('Este ZIP não tem a ROM de programa (.p1). Use um conjunto de ROM do Neo Geo no formato MAME.');
    if (!C.length) throw new Error('Este ZIP não tem as ROMs de gráficos (.c1, .c2...).');
    const odd = [], even = []; for (let i = 0; i + 1 < C.length; i += 2) { odd.push(C[i]); even.push(C[i + 1]); }
    const magic = (a, o) => String.fromCharCode(a[o], a[o + 1], a[o + 2], a[o + 3], a[o + 4], a[o + 5], a[o + 6]);
    if (magic(P, 0x100) !== 'NEO-GEO' && magic(P, 0x100).charAt(0) === 'E' ) { for (let i = 0; i + 1 < P.length; i += 2) { const t = P[i]; P[i] = P[i + 1]; P[i + 1] = t; } } // ROM com bytes trocados
    return { p: P, s: S, m1: M, v: V, c1: cat(odd), c2: cat(even) };
  }
  /* ---- arquivo .neo (cartucho já descriptografado: cabeçalho de 4096 bytes + P, S, M, V1, V2, C) ---- */
  static isNeo(u8) { return u8.length > 4096 && u8[0] === 0x4E && u8[1] === 0x45 && u8[2] === 0x4F && u8[3] === 1; }
  static parseNeo(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), sz = [];
    for (let i = 0; i < 6; i++) sz.push(dv.getUint32(4 + i * 4, true));
    let o = 4096; const take = n => { const r = u8.subarray(o, o + n); o += n; return r; };
    const p0 = take(sz[0]), p = new Uint8Array(p0.length); for (let i = 0; i + 1 < p0.length; i += 2) { p[i] = p0[i + 1]; p[i + 1] = p0[i]; }   // P vem em palavras little-endian
    const s = take(sz[1]), m1 = take(sz[2]), v1 = take(sz[3]), v2 = take(sz[4]), c = take(sz[5]);
    const v = new Uint8Array(v1.length + v2.length); v.set(v1); v.set(v2, v1.length);
    const c1 = new Uint8Array(c.length >> 1), c2 = new Uint8Array(c.length >> 1);   // C: bytes alternados (C1, C2)
    for (let i = 0; i < c1.length; i++) { c1[i] = c[i * 2]; c2[i] = c[i * 2 + 1]; }
    let name = ''; for (let i = 38; i < 71 && u8[i]; i++) name += String.fromCharCode(u8[i]);
    return { p, s, m1, v, c1, c2, name: name.trim() };
  }
  loadSet(set) {
    if (!this.m.hasBios) throw new Error('Falta a BIOS do Neo Geo. Toque em Ajustes > BIOS e escolha o neogeo.zip.');
    const m = this.m; m.loadSet(set); this.ready = true;
    this.romHash = 0; for (let i = 0; i < Math.min(set.p.length, 65536); i++) this.romHash = (this.romHash * 31 + set.p[i]) >>> 0;
    const nm = String.fromCharCode.apply(null, Array.from(set.p.subarray(0x108, 0x108 + 16)).map(c => c >= 32 && c < 127 ? c : 32)).trim();
    return { title: nm || 'Neo Geo', lines: ['ROM de programa: ' + (set.p.length >> 10) + ' KB', 'Gráficos: ' + ((set.c1.length * 2) >> 10) + ' KB, som: ' + (set.v.length >> 10) + ' KB'] };
  }
  load() { throw new Error('No Neo Geo, abra o ZIP do jogo (conjunto estilo MAME, com .p1 .c1 .m1 .v1).'); }
  peek(a) { a &= 0xFFFFFF; return a >= 0x100000 && a < 0x110000 ? this.m.wram[a & 0xFFFF] : 0; }
  reset() { this.m.reset(); }
  setButtons(b) { this.m.buttons[0] = b; }
  runFrame() { this.m.runFrame(); this.applyCheats(); }
  saveState() { return emuStateSave(this.m, NG_SKIP); }
  loadState(u8) {
    emuStateLoad(this.m, NG_SKIP, u8); const m = this.m;
    for (let b = 0; b < 2; b++) { const was = m.palBank; m.palBank = b; for (let i = 0; i < 0x1000; i++) m.setPal(i, m.pal[b][i]); m.palBank = was; }
    m.updateIrq(); m.ym.rp = m.ym.wp;
  }
  /* ---- cheats: ENDEREÇO:VALOR na RAM de trabalho (100000-10FFFF), 1 ou 2 bytes ---- */
  parseCheat(text) {
    const ops = [];
    for (let line of String(text).split(/[\n,;]+/)) {
      line = line.trim(); if (!line) continue; let m;
      if ((m = /^([0-9A-F]{6})\s*[:=]\s*([0-9A-F]{2}|[0-9A-F]{4})$/i.exec(line)) || (m = /^([0-9A-F]{6})\s+([0-9A-F]{2}|[0-9A-F]{4})$/i.exec(line))) {
        const addr = parseInt(m[1], 16); if (addr < 0x100000 || addr >= 0x110000) throw new Error('Só dá para alterar a RAM de trabalho (100000 a 10FFFF).');
        ops.push({ addr, val: parseInt(m[2], 16), size: m[2].length >> 1 });
      } else throw new Error('Formato não reconhecido: "' + line + '". Use endereço:valor (ex.: 10A1C4:09).');
    }
    if (!ops.length) throw new Error('Digite um código.'); return ops;
  }
  setCheats(ops) { this.cheatOps = ops.length ? ops : null; }
  applyCheats() { const r = this.cheatOps; if (!r) return; const w = this.m.wram; for (const o of r) { const a = o.addr & 0xFFFF; if (o.size === 1) w[a] = o.val; else { w[a] = o.val >> 8; w[a + 1] = o.val & 255; } } }
  enhancements() { return []; }
  setOptions() {}
  sramKey() { return this.ready ? 'neogeo_' + this.romHash : null; }
  sramData() { return this.m.sram.slice(); }
  sramRestore(u8) { this.m.sram.set(u8.subarray(0, this.m.sram.length)); }
}
if (typeof module !== 'undefined') module.exports = { NeoGeoCore };
