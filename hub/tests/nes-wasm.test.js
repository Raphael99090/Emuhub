// Exercita o ABI completo do NES compilado para WebAssembly pelo Emscripten.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'native', 'wasm');
const js = path.join(dir, 'emuhub-core.js');
const wasm = path.join(dir, 'emuhub-core.wasm');
assert(fs.existsSync(js), 'emuhub-core.js ausente');
assert(fs.existsSync(wasm), 'emuhub-core.wasm ausente');

(async () => {
  const factory = require(js);
  const module = await factory({ wasmBinary: fs.readFileSync(wasm) });
  assert.strictEqual(module._emuhub_abi_version(), 2);
  assert.strictEqual(module._emuhub_video_width(), 256);
  assert.strictEqual(module._emuhub_video_height(), 240);

  // ROM iNES NROM: loop JMP $8000 e vetor de reset.
  const rom = new Uint8Array(16 + 32768);
  rom.set([0x4e,0x45,0x53,0x1a,2,0,0,0], 0);
  rom.set([0x4c,0x00,0x80], 16);
  rom[16 + 0x7ffc] = 0x00;
  rom[16 + 0x7ffd] = 0x80;
  const ptr = module._malloc(rom.length);
  assert(ptr, 'malloc falhou');
  try {
    module.HEAPU8.set(rom, ptr);
    assert.strictEqual(module._emuhub_load_rom(ptr, rom.length), 0);
  } finally {
    module._free(ptr);
  }
  assert.strictEqual(module._emuhub_nes_mapper(), 0);
  assert.strictEqual(module._emuhub_nes_prg_size(), 32768);
  assert.strictEqual(module._emuhub_nes_chr_is_ram(), 1);
  assert.strictEqual(module._emuhub_nes_cpu_read(0x8000), 0x4c);
  assert.strictEqual(module._emuhub_run_frame(), 0);
  assert(module._emuhub_audio_buffer_samples() > 0, 'APU não gerou áudio');
  assert(module._emuhub_video_buffer() > 0, 'framebuffer indisponível');
  console.log('TUDO OK: ROM NES carregada e quadro executado no WASM.');
  module._emuhub_destroy();
})().catch(error => { console.error(error); process.exitCode = 1; });
