#!/usr/bin/env python3
"""Empacota build/ em jarder.neo (formato .neo: cabecalho 4096 B, P em palavras LE, C com bytes alternados C1/C2)."""
import sys, struct, os
B = sys.argv[1]
rd = lambda n: open(os.path.join(B, n), 'rb').read()
p = bytearray(rd('p.bin')); p += bytes((-len(p)) % 0x1000)
p = bytearray(p); 
for i in range(0, len(p) - 1, 2): p[i], p[i + 1] = p[i + 1], p[i]
s = bytes(0x1000)
# driver Z80 minimo: responde aos comandos da BIOS (porta 0 -> porta 0x0C) e habilita NMI
m = bytearray(0x100)
code0 = bytes([0xF3, 0x31, 0xFF, 0xFF, 0xD3, 0x08, 0x18, 0xFE])
nmi = bytes([0xF5, 0xDB, 0x00, 0xFE, 0x01, 0x20, 0x03, 0xAF, 0xD3, 0x0C, 0x3E, 0x01, 0xD3, 0x0C, 0xF1, 0xED, 0x45])  # cmd 1: responde 0 e depois 1; demais: 1
m[0:len(code0)] = code0; m[0x66:0x66 + len(nmi)] = nmi
c1, c2 = rd('c1.bin'), rd('c2.bin')
c = bytearray(len(c1) * 2); c[0::2] = c1; c[1::2] = c2
hdr = bytearray(4096); hdr[0:4] = b'NEO\x01'
struct.pack_into('<6I', hdr, 4, len(p), len(s), len(m), 0, 0, len(c))
hdr[38:38 + 6] = b'JARDER'
open(os.path.join(B, 'jarder.neo'), 'wb').write(bytes(hdr) + bytes(p) + s + bytes(m) + bytes(c))
print('jarder.neo', len(hdr) + len(p) + len(s) + len(m) + len(c))
