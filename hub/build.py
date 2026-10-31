#!/usr/bin/env python3
"""Empacota o hub em um único HTML: dist/emu-hub.html"""
import os, zipfile

root = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()

def wrap(cid, files, factory):
    src = '\n'.join(rd(f) for f in files)
    return "Cores.%s=(function(){\n%s\nreturn {create:function(){return new %s();},createGG:function(){return typeof GGCore!=='undefined'?new GGCore():null;}};\n})();" % (cid, src, factory)

CORE_FILES = {
    'nes':  ['shared/state.js', 'nes/cartridge.js', 'nes/cpu.js', 'nes/ppu.js', 'nes/apu.js', 'nes/nes.js', 'nes/core.js'],
    'snes': ['shared/state.js', 'snes/cpu.js', 'snes/spc.js', 'snes/gsu.js', 'snes/ppu.js', 'snes/snes.js', 'snes/core.js'],
    'gb':   ['shared/state.js', 'gb/cpu.js', 'gb/apu.js', 'gb/ppu.js', 'gb/gb.js', 'gb/core.js'],
    'sms':  ['shared/state.js', 'sms/z80.js', 'sms/vdp.js', 'sms/psg.js', 'sms/sms.js', 'sms/core.js'],
    'gba':  ['shared/state.js', 'gba/bus.js', 'gba/cpu.js', 'gba/ppu.js', 'gba/bios.js', 'gba/apu.js', 'gba/sys.js', 'gba/core.js'],
}
FACTORY = {'nes': 'NESCore', 'snes': 'SNESCore', 'gb': 'GBCore', 'sms': 'SMSCore', 'gba': 'GBACore'}
cores = 'var Cores={};\n' + '\n'.join(wrap(c, ['src/cores/' + f for f in fs], FACTORY[c]) for c, fs in CORE_FILES.items()) + "\nCores.gg={create:function(){return Cores.sms.createGG();}};"
html = rd('src/index.html').replace('/*CORES*/', cores).replace('/*HUB*/', rd('src/hub.js').replace('/*CHTIDX*/', rd('src/data/chtidx.b64').strip()))

os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist', 'emu-hub.html')
open(out, 'w', encoding='utf-8').write(html)

# versão instalável (PWA): precisa ser servida por HTTPS (ou localhost)
import hashlib, shutil
pw = os.path.join(root, 'dist', 'pwa'); os.makedirs(pw, exist_ok=True)
ver = hashlib.md5(html.encode()).hexdigest()[:10]
open(os.path.join(pw, 'index.html'), 'w', encoding='utf-8').write(html.replace('<!--PWA-->', '<link rel="manifest" href="manifest.json">\n<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-192.png">'))
open(os.path.join(pw, 'sw.js'), 'w', encoding='utf-8').write(rd('src/pwa/sw.js').replace('/*VERSAO*/', ver))
for f in ('manifest.json', 'icon-192.png', 'icon-512.png'):
    shutil.copy(os.path.join(root, 'src', 'pwa', f), os.path.join(pw, f))
with zipfile.ZipFile(os.path.join(root, 'dist', 'emu-hub-pwa.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(pw)):
        z.write(os.path.join(pw, f), f)

# projeto do APK (Capacitor): pasta apk/ + cópia da PWA em pwa/
apkdir = os.path.join(root, 'apk')
with zipfile.ZipFile(os.path.join(root, 'dist', 'emu-hub-apk.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, _, fn in os.walk(apkdir):
        for f in sorted(fn):
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, apkdir)
            if rel.split(os.sep)[0] in ('node_modules', 'android', 'www'): continue
            z.write(full, rel)
    for f in sorted(os.listdir(pw)):
        z.write(os.path.join(pw, f), 'pwa/' + f)

zpath = os.path.join(root, 'dist', 'emu-hub-fontes.zip')
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for top in ('src', 'tests', 'apk'):
        for dp, _, fn in os.walk(os.path.join(root, top)):
            for f in sorted(fn):
                full = os.path.join(dp, f)
                if os.sep + 'node_modules' in full or os.sep + 'android' + os.sep in full: continue
                z.write(full, os.path.relpath(full, root))
    for f in ('build.py', 'README.md'):
        if os.path.exists(os.path.join(root, f)):
            z.write(os.path.join(root, f), f)
print('ok', len(html), 'bytes ->', out)
