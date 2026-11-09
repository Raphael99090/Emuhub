# Emu Hub — núcleo nativo C++ / WebAssembly

## Estado da migração NES

A interface do hub e o núcleo JavaScript permanecem como fallback. O núcleo C++ já integra cartucho, CPU, barramento, PPU e APU e pode ser carregado pelo adaptador opcional WebAssembly do frontend.

### Portado para C++
- Cartucho iNES 1.0, trainer, PRG RAM, CHR ROM/CHR RAM e mappers 0, 1, 2, 3, 4 e 7.
- CPU 6502, interrupções, modos de endereço e os opcodes não oficiais LAX/SAX/NOP presentes na referência JavaScript.
- Barramento NES, RAM espelhada, registradores PPU/APU, controle serial e DMA OAM.
- PPU com memória de vídeo, palettes, mirroring, registradores, VBlank/NMI e renderização de fundo/sprites.
- APU com dois canais pulse, triangle, noise, frame sequencer, IRQ e buffer de áudio.
- Máquina integrada e C ABI v3 para carregar ROM, executar quadros e obter vídeo/áudio.

### Integração no frontend
- Ao carregar uma ROM NES, o adaptador tenta carregar `emuhub-core.js` e `emuhub-core.wasm` na mesma pasta da PWA.
- Se os arquivos não existirem ou o módulo não inicializar/carregar a ROM, o adaptador mantém o núcleo JavaScript como fallback.
- `hub/build.py` inclui os binários em `dist/pwa` e no ZIP da PWA quando estiverem em `hub/native/wasm/`.
- O service worker pré-armazena os dois binários para uso offline.
- A pipeline de CI compila WASM, empacota a PWA e publica o ZIP como artefato `emuhub-nes-wasm-pwa`.

### Limitações conhecidas
- CPU/PPU e temporização ainda precisam ser auditadas contra ROMs de diagnóstico; não há alegação de precisão ciclo a ciclo.
- APU DMC e detalhes de hardware adicionais ainda não foram portados.
- No backend WASM, save states, rewind, SRAM persistente, cheats e melhorias por jogo ainda não estão implementados; use o fallback JS para esses recursos.
- Não há validação de compatibilidade geral com ROMs comerciais nem equivalência completa de vídeo/áudio.
- Mantenha o fallback JavaScript até completar a validação de compatibilidade.

## Build e testes nativos
```sh
cmake -S hub/native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
```

## Build WebAssembly e PWA
```sh
emcmake cmake -S hub/native -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm --parallel
mkdir -p hub/native/wasm
cp build/wasm/emuhub-core.js build/wasm/emuhub-core.wasm hub/native/wasm/
python3 hub/build.py
```

O resultado instalável fica em `hub/dist/emu-hub-pwa.zip`. A validação final de produção depende de ROMs de diagnóstico, testes de compatibilidade e comparação de frames/áudio.
