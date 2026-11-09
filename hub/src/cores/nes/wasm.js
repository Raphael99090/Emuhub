/* Optional native WebAssembly backend for the NES core.
 * If emuhub-core.js/.wasm are absent or fail to initialize, the JS core remains active. */
class NESWasmRuntime {
  static modulePromise = null;
  static async create() {
    if (!this.modulePromise) this.modulePromise = this.loadModule();
    const mod = await this.modulePromise;
    return new NESWasmRuntime(mod);
  }
  static loadModule() {
    return new Promise((resolve, reject) => {
      if (typeof EmuHubCoreModule === 'function') {
        EmuHubCoreModule({ locateFile: p => new URL(p, document.currentScript?.src || location.href).href }).then(resolve, reject);
        return;
      }
      const script = document.createElement('script');
      script.src = new URL('emuhub-core.js', document.baseURI).href;
      script.async = true;
      script.onload = () => {
        if (typeof EmuHubCoreModule !== 'function') return reject(new Error('Módulo WebAssembly não exportado'));
        EmuHubCoreModule({ locateFile: p => new URL(p, script.src).href }).then(resolve, reject);
      };
      script.onerror = () => reject(new Error('Backend WebAssembly não encontrado'));
      document.head.appendChild(script);
    });
  }
  constructor(Module) {
    this.m = Module;
    this.w = Module._emuhub_video_width();
    this.h = Module._emuhub_video_height();
    this.videoPtr = Module._emuhub_video_buffer();
    this.audioPtr = Module._emuhub_audio_buffer();
    this.video = new Uint32Array(Module.HEAPU32.buffer, this.videoPtr, Module._emuhub_video_buffer_size());
    this.audio = {
      setSampleRate: rate => Module._emuhub_set_audio_sample_rate(rate),
      setVolume: volume => Module._emuhub_set_audio_volume(volume),
      fill: out => {
        const count = Math.min(out.length, Module._emuhub_audio_buffer_size());
        const src = new Float32Array(Module.HEAPF32.buffer, this.audioPtr, count);
        out.set(src.subarray(0,count));
        if (count < out.length) out.fill(0,count);
      },
      buffered: () => Module._emuhub_audio_buffer_size()
    };
    this.ready = false;
  }
  load(u8) {
    const ptr = this.m._malloc(u8.length);
    if (!ptr) throw new Error('Memória insuficiente para carregar a ROM');
    try {
      this.m.HEAPU8.set(u8,ptr);
      const result=this.m._emuhub_load_rom(ptr,u8.length);
      if(result!==0) throw new Error('O núcleo C++ recusou a ROM (código '+result+')');
      this.ready=true;
      return {title:'ROM NES (C++/WASM)',lines:['Backend nativo WebAssembly','Mapper '+this.m._emuhub_nes_mapper(),'PRG '+(this.m._emuhub_nes_prg_size()>>10)+' KB','CHR '+(this.m._emuhub_nes_chr_is_ram()?'RAM':(this.m._emuhub_nes_chr_rom_size()>>10)+' KB')]};
    } finally { this.m._free(ptr); }
  }
  get frame() { return this.video; }
  runFrame() {
    const r=this.m._emuhub_run_frame();
    if(r!==0) throw new Error('Falha ao executar quadro NES (código '+r+')');
  }
  reset(){this.m._emuhub_reset();}
  setButtons(mask){this.m._emuhub_set_buttons(mask&255);}
  setCheats(){/* Cheats continuam disponíveis no backend JS. */}
  parseCheat(){throw new Error('Cheats ainda não estão disponíveis no backend C++/WASM.');}
  peek(address){return this.m._emuhub_nes_cpu_read(address&65535);}
  sramKey(){return null;}
  sramData(){return new Uint8Array(0);}
  sramRestore(){}
  destroy(){this.m._emuhub_destroy();this.ready=false;}
}
