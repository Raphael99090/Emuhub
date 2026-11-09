# Emu Hub — núcleo nativo C++ / WebAssembly

## Estado da migração NES

A interface do hub e o núcleo JavaScript permanecem como fallback funcional. O núcleo C++ agora tem uma primeira integração executável de cartucho, CPU, barramento, PPU e APU; ainda não é uma substituição equivalente ao JavaScript para todos os jogos.

### Portado para C++
- Cartucho iNES 1.0, trainer, PRG RAM, CHR ROM/CHR RAM e mappers 0, 1, 2, 3, 4 e 7.
- CPU 6502 com instruções oficiais comuns, interrupções, modos de endereço e os opcodes não oficiais LAX/SAX/NOP usados pelo núcleo JS.
- Barramento NES com RAM espelhada, registradores PPU/APU, controle serial e DMA OAM.
- PPU com memória de vídeo, palette RAM, mirroring, registradores, NMI/VBlank e renderização por scanline de fundo e sprites.
- APU com dois canais pulse, triangle, noise, sequenciador de quadro, IRQ e buffer de áudio.
- Máquina NES que conecta cartucho, CPU, barramento, PPU e APU; C ABI já consegue carregar ROM e avançar um quadro.

### Limitações conhecidas
- A CPU ainda precisa completar/auditar o conjunto de opcodes, detalhes de ciclo e comportamento de hardware.
- A PPU/APU precisam ser comparadas com ROMs de diagnóstico e com a implementação JS; ainda não há alegação de precisão ciclo a ciclo.
- DMC da APU, recursos extras do adaptador JS (Game Genie, cheats RAM, save states, opções de overclock), segundo controle e estados de hardware mais detalhados ainda não foram portados.
- O adaptador frontend/loader WASM ainda não seleciona o backend C++; o núcleo JS segue ativo para a interface.
- Nenhum conjunto de ROMs comerciais/diagnóstico foi validado nesta etapa. Não considerar compatibilidade geral ou migração concluída.

## Build e testes nativos
```sh
cmake -S hub/native -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
```

## Build WebAssembly
```sh
emcmake cmake -S hub/native -B build/wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm --parallel
```

O buffer de vídeo é 256×240 e o buffer de áudio expõe amostras float pelo C ABI. A validação de produção ainda depende de testes de ROMs de diagnóstico, comparação automatizada de frames/áudio e integração com o frontend.
