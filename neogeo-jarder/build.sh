#!/bin/sh
# Uso: VASM=/caminho/vasmm68k_mot ./build.sh
set -e
cd "$(dirname "$0")"
VASM=${VASM:-vasmm68k_mot}
python3 -I tools/make_assets.py .
(cd src && $VASM -Fbin -m68000 -no-opt -o ../build/p.bin jarder.s)
python3 -I tools/pack_neo.py build
