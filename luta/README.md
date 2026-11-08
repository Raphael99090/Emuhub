# Jarder — base do jogo de luta (SNES)

Primeira etapa: o Jarder (ex-coronel soviético) andando, pulando, agachando e dando soco num pátio de quartel com neve.

- `jarder.asm` — jogo em assembly 65816 (WLA-DX), LoROM de 128 KB
- `tools/gen_assets.py` — desenha os sprites e o cenário por código e converte para o formato do SNES
- `build.sh` — gera `jarder.sfc` (precisa de Python 3 + Pillow e do WLA-DX: `wla-65816` e `wlalink`)
- `tests/run.js` — roda o ROM no núcleo SNES do Emu Hub, aperta botões e confere (e salva prints em `build/shots/`)

Controles: direcionais andam · Cima pula · Baixo agacha · B/Y/A/X dá um soco.
