# Jarder — base do jogo de luta (SNES)

Primeira etapa: o Jarder andando, pulando, agachando e dando soco num pátio de quartel com neve.

- `jarder.asm` — jogo em assembly 65816 (WLA-DX), LoROM de 128 KB
- `tools/gen_assets.py` — gera/empacota os gráficos; o importador também usa arte em `art/src/`
- `tools/import_sprites.py` — recorta, alinha e converte os sprites importados
- `build.sh` — gera `jarder.sfc` com WLA-DX
- `tests/run.js` — executa o ROM no núcleo SNES do Emu Hub e salva capturas em `build/shots/`

## Dependências

Python 3, Pillow, NumPy e SciPy. Instale com:

```sh
python3 -m pip install -r tools/requirements.txt
```

Também é necessário instalar o WLA-DX e deixar `wla-65816` e `wlalink` disponíveis no `PATH`.

## Compilar e testar

```sh
./build.sh
node tests/run.js
```

Controles: direcionais andam · Cima pula · Baixo agacha · B/Y/A/X ataca.

Os sprites de arte importada devem estar em `art/src/`. Não inclua ROMs de terceiros no repositório.
