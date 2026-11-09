# Arquitetura híbrida C++ / WebAssembly

## Objetivo

Manter a interface, biblioteca e integração com Capacitor em JavaScript/HTML/CSS. Migrar a execução dos núcleos de emulação para C++17, compilado para WebAssembly no navegador e Android WebView. O mesmo código C++ poderá ser compilado nativamente no futuro.

## Estado desta etapa

Esta pasta contém a fundação de build e o contrato ABI versionado, não um emulador NES funcional em C++. `emuhub_load_rom` valida iNES e guarda o conteúdo; `emuhub_run_frame` retorna `-3` enquanto o núcleo real não for portado. O frontend atual continua usando os núcleos JavaScript. Não selecionar o backend C++ em produção até o port e a suíte de conformidade passarem.

## Contrato ABI v1

- Inicialização/versão: `emuhub_abi_version`
- ROM: `emuhub_load_rom(ptr, size)`
- Vídeo: largura, altura e buffer RGBA/ARGB de 32 bits
- Áudio: sample rate, buffer float intercalado (definir estéreo antes da implementação)
- Entrada: bitmask de controles estável
- Execução: `emuhub_run_frame`, um frame por chamada
- Estado: reset e destroy; save states serão acrescentados com formato versionado

## Compilar

Nativo (verifica compilador e contrato):

```sh
cmake -S hub/native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native
```

WebAssembly (com Emscripten instalado e ativado):

```sh
emcmake cmake -S hub/native -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm
```

## Fases do port

1. Congelar resultados de referência dos núcleos JS com ROMs de teste legais e hashes de frame/áudio.
2. Implementar NES em C++ por componentes: cartridge/mappers, CPU 6502, PPU, APU, DMA e timing.
3. Comparar ciclos, frames, áudio, input e save states contra o núcleo JS.
4. Rodar testes de regressão no nativo e no WASM.
5. Integrar backend selecionável com fallback JS e só então portar SNES, GB/GBC, SMS/GG, GBA e Neo Geo.

Não remover os núcleos JS antes de equivalência funcional demonstrada.
