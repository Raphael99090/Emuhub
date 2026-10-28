# Emu Hub

Hub de emuladores escritos do zero: NES, SNES (beta, sem chips extras), Game Boy / Game Boy Color (beta) e GBA (beta).

```
build.py              junta tudo em dist/emu-hub.html (arquivo único) e dist/emu-hub-fontes.zip
src/
  index.html          casca da página (CSS, ícones SVG, estrutura)
  hub.js              interface: menu, player, painel, cheats, estados, biblioteca
  cores/
    shared/state.js   save states genéricos (usado por NES e GBA)
    nes/              cartridge, cpu, ppu, apu, nes (sistema) e core (adaptador do hub)
    snes/             cpu (65816), spc (SPC700 + DSP), ppu, snes (sistema, DMA/HDMA) e core (adaptador)
    gb/               cpu (LR35902), ppu (DMG + CGB), apu, gb (sistema, MBC1/2/3/5, timer, DMA) e core (adaptador)
    gba/              bus, cpu, ppu, bios, apu, sys (timers, DMA, IRQ) e core (adaptador do hub)
tests/
  hub.test.js         testa os núcleos já empacotados (rode build.py antes)
  gba/cpu.test.js     CPU ARM/Thumb
  gba/system.test.js  vídeo, som, timers, DMA, saves, cheats, estados
  snes.test.js        CPU 65816 (256 opcodes), vídeo, SPC700, estados
  gb.test.js          CPU, timer, vídeo DMG/CGB, som, MBCs, cheats, estados (GB_TEST_ROMS=pasta roda também o cpu_instrs do Blargg)
apk/                  projeto Capacitor para gerar o APK (ver apk/LEIA-ME.md; sai em dist/emu-hub-apk.zip)
dist/                 saída do build
```

Rodar tudo: `python3 build.py && node tests/hub.test.js && node tests/gba/cpu.test.js && node tests/gba/system.test.js && node tests/snes.test.js && node tests/gb.test.js`
