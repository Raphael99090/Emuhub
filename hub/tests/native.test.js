// Testa o adaptador NativeCore com um módulo WebAssembly simulado (o real só existe no CI com Emscripten)
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'native.js'), 'utf8');
const { Native, NativeCore, makeCore } = new Function('module', 'Cores', 'localStorage', src + '\nreturn module.exports;')({}, { gba: { create: () => ({ js: true }) }, snes: { create: () => ({ js: true }) }, gb: { create: () => ({ js: true }) }, nes: { create: () => ({ js: true }) } }, { getItem: () => '1' });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FALHOU:', m); } else console.log('ok:', m); };

let con = 0, buttons = 0;
const heap = new ArrayBuffer(1 << 20);
const mod = {
  HEAPU8: new Uint8Array(heap), HEAPU32: new Uint32Array(heap), HEAPF32: new Float32Array(heap),
  _malloc: () => 4096, _free() {},
  _emuhub_select_console: c => { con = c; return 0; },
  _emuhub_video_width: () => (con ? 160 : 256), _emuhub_video_height: () => (con ? 144 : 240),
  _emuhub_video_buffer: () => 65536, _emuhub_video_buffer_size: () => (con ? 160 * 144 : 256 * 240),
  _emuhub_set_audio_sample_rate() {}, _emuhub_set_audio_volume() {},
  _emuhub_load_rom: (p, n) => (n < 0x150 ? 1 : 0), _emuhub_run_frame: () => 0, _emuhub_reset() {},
  _emuhub_set_buttons: m => { buttons = m; }, _emuhub_audio_buffer: () => 131072, _emuhub_audio_buffer_samples: () => 4,
  _emuhub_gb_is_cgb: () => 0, _emuhub_nes_mapper: () => 0, _emuhub_nes_cpu_read: a => a & 255,
  _emuhub_video_aspect: () => 256 / 224, _emuhub_snes_peek: a => a & 255,
  _emuhub_sram_battery: () => 1, _emuhub_sram_size: () => 8, _emuhub_sram_data: () => 200000,
  _emuhub_state_save: () => 5, _emuhub_state_buffer: () => 300000, _emuhub_state_alloc: () => 310000,
  _emuhub_state_load: n => (st.code ? st.code : (st.n = n, 0))
};
const st = { code: 0 }; const cc = [];
mod._emuhub_cheats_clear = () => { cc.length = 0; }; mod._emuhub_cheat_ram = (a, v) => cc.push(['r', a, v]); mod._emuhub_cheat_gg = (a, v, c) => cc.push(['g', a, v, c]);
Native.mod = mod; Native.ready = true;
for (let i = 0; i < 4; i++) mod.HEAPF32[32768 + i] = 0.25 * (i + 1);

const c = makeCore('gb', 'Game Boy');
ok(c instanceof NativeCore && c.width === 160 && c.height === 144, 'GB nativo selecionado quando ligado');
const rom = new Uint8Array(0x200); 'TETRIS'.split('').forEach((ch, i) => { rom[0x134 + i] = ch.charCodeAt(0); });
const info = c.load(rom);
ok(info.title === 'TETRIS' && c.ready, 'load devolve título e fica pronto');
c.runFrame();
const out = new Float32Array(6); c.audio.fill(out);
ok(out[0] === 0.25 && out[3] === 1, 'áudio do quadro chega ao hub');
c.setButtons(0x1FF); ok(buttons === 255, 'botões limitados a 8 bits');
ok(c.sramKey() === 'gb_' + c.romHash, 'chave do save compatível com o núcleo JS');
c.sramRestore(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])); ok(c.sramData()[7] === 8 && c.sramData().length === 8, 'save da bateria vai e volta');
let threw = false; try { c.load(new Uint8Array(10)); } catch (e) { threw = true; } ok(threw, 'ROM recusada gera erro legível');
ok(makeCore('gba', 'GBA').js === true, 'console sem suporte usa o núcleo JS');
Native.ready = false; ok(makeCore('gb', 'Game Boy').js === true, 'sem o módulo cai no JS');
// SNES: tamanho dinâmico, máscara de 12 botões, aspecto e coprocessadores caindo no JS
Native.ready = true; con = 2;
const sn = makeCore('snes', 'SNES');
ok(sn instanceof NativeCore && sn.dar === 256 / 224, 'SNES nativo informa o aspecto');
sn.setButtons(0xFFFF); ok(buttons === 0xFFF, 'SNES usa 12 botões');
ok(sn.peek(0x7E0010) === 0x10, 'peek de RAM do SNES');
ok(sn.needsJs(new Uint8Array(16)) === false, 'sem parseSnesHeader não força o JS');
// cheats: SNES (Action Replay + Game Genie) via parser do JS
if (typeof Cores !== 'undefined' && Cores.snes) {
  const ops = sn.parseCheat('7E0DBE:05'); sn.setCheats(ops.concat([{ t: 'gg', addr: 0x8123, val: 7 }]));
  ok(cc.length === 2 && cc[0][0] === 'r' && cc[0][1] === 0x7E0DBE && cc[1][3] === -1, 'cheats chegam ao módulo já decodificados');
}
const op = []; mod._emuhub_set_option = (k, v) => op.push([k, v]);
if (sn.enhancements) { sn.setOptions({ noLimit: true, oc: 2 }); ok(op.some(x => x[0] === 0 && x[1] === 1) && op.some(x => x[0] === 4 && x[1] === 500), 'melhorias do SNES chegam ao módulo'); }
// estados salvos
for (let i = 0; i < 5; i++) mod.HEAPU8[300000 + i] = 10 + i;
const sv = sn.saveState(); ok(sv.length === 5 && sv[4] === 14, 'saveState copia o buffer do módulo');
sn.loadState(sv); ok(st.n === 5 && mod.HEAPU8[310002] === 12, 'loadState envia os bytes ao módulo');
st.code = 1; threw = false; try { sn.loadState(sv); } catch (e) { threw = /outro motor/.test(e.message); } ok(threw, 'estado do motor JS é recusado com mensagem clara');
st.code = 2; threw = false; try { sn.loadState(sv); } catch (e) { threw = /incompat/.test(e.message); } ok(threw, 'estado de outro jogo é recusado');
process.exit(fails ? 1 : 0);
