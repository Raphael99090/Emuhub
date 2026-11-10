/* NES: backend nativo C++/WebAssembly obrigatório; sem fallback JavaScript. */
class NESCore {
 constructor(){this.id='nes';this.name='NES';this.width=256;this.height=240;this.ready=false;this.wasm=null;this.audio={buffered:()=>0,fill:o=>o.fill(0),setSampleRate:()=>{},setVolume:()=>{}};this.saveState=null;this.loadState=null;}
 get frame(){return this.wasm?this.wasm.frame:new Uint32Array(256*240);}
 async loadNative(u8){if(typeof NESWasmRuntime==='undefined')throw new Error('Adaptador WebAssembly não incluído no build.');this.wasm=await NESWasmRuntime.create();try{const info=this.wasm.load(u8);this.ready=true;this.audio=this.wasm.audio;return info;}catch(e){this.wasm.destroy();this.wasm=null;throw e;}}
 load(){throw new Error('O NES exige o backend C++/WebAssembly. O núcleo JavaScript foi desativado.');}
 reset(){if(this.wasm)this.wasm.reset();} runFrame(){if(!this.wasm||!this.ready)throw new Error('Backend NES WebAssembly não está pronto.');this.wasm.runFrame();} setButtons(m){if(this.wasm)this.wasm.setButtons(m&255);}
 sramKey(){return null;} sramData(){return new Uint8Array(0);} sramRestore(){} parseCheat(){throw new Error('Cheats indisponíveis no backend C++/WASM.');} setCheats(){throw new Error('Cheats indisponíveis no backend C++/WASM.');} enhancements(){return [];} setOptions(){} peek(a){return this.wasm?this.wasm.peek(a):0;} destroy(){if(this.wasm)this.wasm.destroy();this.wasm=null;this.ready=false;}
}
