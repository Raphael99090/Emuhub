# Emu Hub

Hub de emuladores escritos do zero: NES, SNES (beta; alta resolução, Super FX testado com ROMs de teste, SA-1 experimental; DSP-1, Cx4 e S-DD1 ainda não), Game Boy / Game Boy Color (beta), Master System e Game Gear (beta, mesmo núcleo: Z80 + VDP + PSG) e GBA (beta).

```
build.py              junta tudo em dist/emu-hub.html (arquivo único) e dist/emu-hub-fontes.zip
src/
  index.html          casca da página (CSS, ícones SVG, estrutura)
  hub.js              interface: menu, player, painel, cheats, estados, biblioteca
  cores/
    shared/state.js   save states genéricos (usado por NES e GBA)
    nes/              cartridge, cpu, ppu, apu, nes (sistema) e core (adaptador do hub)
    snes/             cpu (65816), spc (SPC700 + DSP), gsu (Super FX), sa1 (SA-1), ppu (modos 0-7, hi-res, entrelaçado), snes (sistema, DMA/HDMA) e core (adaptador)
    gb/               cpu (LR35902), ppu (DMG + CGB), apu, gb (sistema, MBC1/2/3/5, timer, DMA) e core (adaptador)
    gba/              bus, cpu, ppu, bios, apu, sys (timers, DMA, IRQ) e core (adaptador do hub)
tests/
  hub.test.js         testa os núcleos já empacotados (rode build.py antes)
  gba/cpu.test.js     CPU ARM/Thumb
  gba/system.test.js  vídeo, som, timers, DMA, saves, cheats, estados
  snes.test.js        CPU 65816 (256 opcodes), vídeo, SPC700, estados
  sms.test.js         Z80, VDP (fundo, sprites, rolagem, IRQ de linha), PSG, mapeadores Sega/Codemasters, Game Gear, cheats e estados (ZEX=pasta com prelim.com/zexdoc.cim roda também as suítes ZEX)
  gb.test.js          CPU, timer, vídeo DMG/CGB, som, MBCs, cheats, estados (GB_TEST_ROMS=pasta roda também o cpu_instrs do Blargg)
apk/                  projeto Capacitor para gerar o APK (ver apk/LEIA-ME.md; sai em dist/emu-hub-apk.zip)
dist/                 saída do build
```

Rodar tudo: `python3 build.py && node tests/hub.test.js && node tests/gba/cpu.test.js && node tests/gba/system.test.js && node tests/snes.test.js && node tests/gb.test.js && node tests/sms.test.js`

## Neo Geo (beta, a testar com jogos reais)

Núcleo em `src/cores/neogeo/`: `m68k.js` (CPU 68000 completa), `ym2610.js` (FM, SSG, ADPCM-A e ADPCM-B), `neogeo.js` (mapa de memória, LSPC com sprites e camada fixa, Z80 de som reaproveitado de `sms/z80.js`) e `core.js` (adaptador do hub).

- **BIOS:** em Ajustes, escolha o `neogeo.zip` (ou os arquivos soltos). O hub usa `sp-s2.sp1` (ou outra BIOS de 128 KB), `sfix.sfix` e, se existirem, `000-lo.lo` e `sm1.sm1`. Os arquivos ficam só no aparelho (IndexedDB).
- **Jogos:** ZIP no formato MAME, com `.p1 .s1 .m1 .v1 .c1 .c2...`. Jogos com ROMs criptografadas (a partir de KOF 98) ainda não funcionam.
- **Controles:** A, B, C, D, COIN (moeda e select) e START.
- **Testes:** `node tests/neogeo.test.js` (68000 com programas montados à mão e o sistema inteiro com uma BIOS sintética).
- **Não verificado:** o formato exato dos bytes das ROMs de sprites (`neogeo.js`, `renderLine`) e da camada fixa foi escrito de memória; confirmar com um jogo real.


## Neo Geo
Abra um arquivo `.neo` (ou ZIP com `.neo`, ou ZIP estilo MAME sem criptografia) e escolha a BIOS em Ajustes > BIOS (neogeo.zip ou arquivos soltos). Suporta o chip PVC (Metal Slug 5, SVC Chaos, KOF 2003). ROMs e BIOS nao vem no repositorio.
