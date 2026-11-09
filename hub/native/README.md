# Emu Hub — núcleo nativo C++ / WebAssembly

## Estado atual
A interface e os emuladores ativos continuam em HTML/CSS/JavaScript. O backend C++ está sendo migrado por etapas e não substitui os núcleos JS antes dos testes de equivalência.

### Implementado em C++
- Parser iNES 1.0 com validação de cabeçalho, tamanho e truncamento.
- Tratamento de trainer de 512 bytes, PRG RAM, CHR ROM e CHR RAM.
- Mapeamento NROM (0) e UxROM (2), incluindo seleção de banco.
- Metadados de bateria e mirroring horizontal, vertical e four-screen.
- API C ABI para carregar ROM, consultar metadados e ler/escrever memória da CPU e PPU.
- Testes nativos de mapeamento e entradas inválidas.

### Ainda não implementado
CPU 6502, bus completo, PPU, APU, DMA, temporização por ciclo, IRQ/NMI, save states e integração com a interface. `emuhub_run_frame()` retorna `-3`: o código ainda não executa jogos.

## Build e testes
```sh
cmake -S hub/native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
```
Com Emscripten:
```sh
emcmake cmake -S hub/native -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm --parallel
```

## Próximas etapas
1. CPU 6502 com testes de instruções, flags, endereçamento e ciclos.
2. Bus NES e integração CPU/cartucho.
3. PPU com timing e renderização comparada ao núcleo JS.
4. APU, DMA e IRQ/NMI.
5. ROMs de diagnóstico e comparação frame/áudio.
6. Adaptador WASM com seleção de backend e fallback JS.

Mantenha o núcleo JavaScript como referência até a equivalência funcional ser demonstrada.
