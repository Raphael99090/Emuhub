#!/usr/bin/env bash
# Gera luta/jarder.sfc. Precisa de Python 3 com Pillow e do WLA-DX (wla-65816 e wlalink) no PATH.
set -e
cd "$(dirname "$0")"
python3 tools/gen_assets.py
wla-65816 -o build/jarder.o jarder.asm
printf '[objects]\nbuild/jarder.o\n' > build/link.txt
wlalink -r build/link.txt jarder.sfc
ls -l jarder.sfc
