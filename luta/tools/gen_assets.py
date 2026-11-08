#!/usr/bin/env python3
"""Gera os gráficos do jogo de luta: sprites do Jarder (32x64, 9 poses), sombra e o cenário do pátio.
Saída em luta/build/: sprites.bin (tiles 4bpp do SNES), obj_pal.bin, chunks.inc, bg_tiles.bin, bg_map.bin, bg_pal.bin
e prévias PNG. Tudo desenhado por código, sem arte externa."""
import os, sys, struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'build'); os.makedirs(OUT, exist_ok=True)

# ---------- paleta do Jarder (índice 0 = transparente) ----------
C = {
    'T': None,                    # transparente
    'k': (16, 14, 20),            # contorno / preto
    's': (222, 164, 118),         # pele
    'S': (176, 118, 82),          # pele sombra
    'h': (150, 150, 160),         # cabelo / barba grisalhos
    'H': (96, 96, 108),           # cabelo sombra / bigode
    'g': (112, 112, 72),          # farda oliva
    'G': (78, 80, 52),            # farda sombra
    'q': (146, 148, 98),          # farda luz
    'r': (200, 36, 40),           # faixa vermelha
    'R': (132, 20, 30),           # faixa sombra
    'y': (244, 200, 52),          # dourado (emblema, botões)
    'w': (236, 236, 244),         # branco (reflexo do óculos)
    'b': (44, 44, 56),            # bota / cinto
    'l': (70, 92, 120),           # lente do óculos
    'o': (0, 0, 0),               # sombra do chão (preenchida à parte)
}
PAL = ['T', 'k', 's', 'S', 'h', 'H', 'g', 'G', 'q', 'r', 'R', 'y', 'w', 'b', 'l']  # 15 cores usadas + índice 0
IDX = {c: i for i, c in enumerate(PAL)}  # 'T' -> 0


def newimg():
    return Image.new('P', (32, 64), 0)


def px(d, x, y, c):
    if 0 <= x < 32 and 0 <= y < 64: d.point((x, y), fill=IDX[c])


def rect(d, x0, y0, x1, y1, c): d.rectangle((x0, y0, x1, y1), fill=IDX[c])
def poly(d, pts, c): d.polygon(pts, fill=IDX[c])
def line(d, a, b, c, w=1): d.line((a, b), fill=IDX[c], width=w)


def limb(d, a, b, w, c, cs=None):
    """braço/perna: linha grossa com contorno simples"""
    line(d, a, b, 'k', w + 2)
    line(d, a, b, c, w)


def draw_head(d, cx, top, dip=0):
    """cabeça de frente: cabelo ondulado grisalho, óculos de armação grossa, bigode e cavanhaque"""
    y = top + dip
    # contorno e rosto
    d.ellipse((cx - 6, y, cx + 6, y + 15), fill=IDX['k'])
    d.ellipse((cx - 5, y + 1, cx + 5, y + 14), fill=IDX['s'])
    # cabelo (topo e laterais)
    d.pieslice((cx - 6, y - 1, cx + 6, y + 9), 180, 360, fill=IDX['h'])
    rect(d, cx - 6, y + 3, cx - 5, y + 7, 'h'); rect(d, cx + 5, y + 3, cx + 6, y + 7, 'h')
    for x in range(cx - 4, cx + 5, 2): px(d, x, y, 'H')
    # testa/sombra
    rect(d, cx - 4, y + 5, cx + 4, y + 5, 's')
    # óculos
    rect(d, cx - 5, y + 6, cx - 1, y + 9, 'k'); rect(d, cx + 1, y + 6, cx + 5, y + 9, 'k')
    rect(d, cx - 4, y + 7, cx - 2, y + 8, 'l'); rect(d, cx + 2, y + 7, cx + 4, y + 8, 'l')
    px(d, cx - 4, y + 7, 'w'); px(d, cx + 2, y + 7, 'w')
    rect(d, cx - 1, y + 7, cx + 1, y + 7, 'k')
    # nariz e bigode
    px(d, cx, y + 9, 'S'); px(d, cx, y + 10, 'S')
    rect(d, cx - 4, y + 11, cx + 4, y + 11, 'H')
    rect(d, cx - 3, y + 10, cx - 1, y + 10, 'H'); rect(d, cx + 1, y + 10, cx + 3, y + 10, 'H')
    # boca discreta e cavanhaque
    rect(d, cx - 2, y + 12, cx + 2, y + 12, 'S')
    rect(d, cx - 3, y + 13, cx + 3, y + 13, 'h'); rect(d, cx - 2, y + 14, cx + 2, y + 14, 'h')
    px(d, cx - 4, y + 12, 'h'); px(d, cx + 4, y + 12, 'h')


def draw_torso(d, cx, top, h=22, lean=0):
    """tronco com farda oliva, faixa vermelha em diagonal do ombro esquerdo ao quadril direito, emblema dourado"""
    x0, x1 = cx - 10 + lean, cx + 10 + lean
    # pescoço e colarinho
    rect(d, cx - 2 + lean, top - 2, cx + 2 + lean, top, 's')
    # corpo
    poly(d, [(x0 + 1, top), (x1 - 1, top), (x1 + 1, top + 3), (x1, top + h), (x0, top + h), (x0 - 1, top + 3)], 'k')
    poly(d, [(x0 + 2, top + 1), (x1 - 2, top + 1), (x1, top + 4), (x1 - 1, top + h - 1), (x0 + 1, top + h - 1), (x0, top + 4)], 'g')
    rect(d, x0 + 2, top + 2, x0 + 4, top + h - 2, 'q')            # luz lateral
    rect(d, x1 - 4, top + 3, x1 - 2, top + h - 2, 'G')            # sombra lateral
    # colarinho (gola)
    poly(d, [(cx - 5 + lean, top), (cx + 5 + lean, top), (cx + 3 + lean, top + 4), (cx - 3 + lean, top + 4)], 'G')
    px(d, cx - 4 + lean, top + 1, 'r'); px(d, cx + 4 + lean, top + 1, 'r')
    # faixa vermelha diagonal (da esquerda-cima para a direita-baixo)
    sx = x0 + 1
    poly(d, [(sx, top + 1), (sx + 6, top + 1), (x1 - 1, top + h - 4), (x1 - 7, top + h - 4)], 'k')
    poly(d, [(sx + 1, top + 2), (sx + 5, top + 2), (x1 - 2, top + h - 5), (x1 - 6, top + h - 5)], 'r')
    line(d, (sx + 5, top + 3), (x1 - 3, top + h - 6), 'R', 1)
    # emblema dourado no meio da faixa
    mx, my = cx + lean + 0, top + h // 2 - 2
    rect(d, mx - 1, my, mx + 1, my + 2, 'y'); px(d, mx - 2, my + 1, 'y'); px(d, mx + 2, my - 1, 'y')
    # cinto e botões
    rect(d, x0 + 1, top + h - 3, x1 - 1, top + h - 2, 'b')
    px(d, cx + lean, top + h - 3, 'y')
    px(d, cx + 5 + lean, top + 8, 'y'); px(d, cx + 5 + lean, top + 12, 'y')


def draw_leg(d, hip, foot, knee=None, front=True):
    pts = [hip] + ([knee] if knee else []) + [foot]
    for a, b in zip(pts, pts[1:]):
        line(d, a, b, 'k', 7); line(d, a, b, 'G' if not front else 'g', 5)
    # bota
    fx, fy = foot
    rect(d, fx - 4, fy - 1, fx + 4, fy + 3, 'k'); rect(d, fx - 3, fy, fx + 3, fy + 2, 'b')
    px(d, fx - 3, fy, 'H')


def draw_arm(d, sh, hand, elbow=None, sleeve='g'):
    pts = [sh] + ([elbow] if elbow else []) + [hand]
    for a, b in zip(pts, pts[1:]):
        line(d, a, b, 'k', 6); line(d, a, b, sleeve, 4)
    hx, hy = hand
    rect(d, hx - 2, hy - 2, hx + 2, hy + 2, 'k'); rect(d, hx - 1, hy - 1, hx + 1, hy + 1, 's')
    px(d, hx - 1, hy - 1, 'S')


def pose(name):
    img = newimg(); d = ImageDraw.Draw(img); cx = 16
    if name == 'idle0':
        draw_leg(d, (11, 40), (8, 59), (9, 49), False); draw_leg(d, (21, 40), (24, 59), (23, 49))
        draw_arm(d, (7, 25), (9, 28), (4, 30), 'G')
        draw_torso(d, cx, 21)
        draw_head(d, cx, 3)
        draw_arm(d, (25, 25), (22, 27), (28, 31))
    elif name == 'idle1':
        draw_leg(d, (11, 41), (8, 59), (8, 50), False); draw_leg(d, (21, 41), (24, 59), (24, 50))
        draw_arm(d, (7, 26), (9, 29), (4, 31), 'G')
        draw_torso(d, cx, 22)
        draw_head(d, cx, 4)
        draw_arm(d, (25, 26), (22, 28), (28, 32))
    elif name.startswith('walk'):
        n = int(name[4:])
        # n=0: perna D à frente; 1: junto; 2: perna E à frente; 3: junto
        legs = {0: ((13, 59), (21, 56), 0), 1: ((16, 59), (18, 59), 1), 2: ((21, 59), (11, 56), 0), 3: ((16, 59), (14, 59), 1)}[n]
        (lx, ly), (rx, ry) = (legs[0], legs[1])
        bob = 1 if n in (1, 3) else 0
        draw_leg(d, (12, 40 + bob), (lx - 1, ly), (lx, 50), False); draw_leg(d, (20, 40 + bob), (rx + 1, ry), (rx, 49))
        swing = {0: 3, 1: 0, 2: -3, 3: 0}[n]
        draw_arm(d, (7, 25 + bob), (9 - swing, 28 + bob), (5 - swing, 30), 'G')
        draw_torso(d, cx, 21 + bob, lean=1)
        draw_head(d, cx + 1, 3 + bob)
        draw_arm(d, (26, 25 + bob), (23 + swing, 27 + bob), (28 + swing, 31))
    elif name == 'jump':
        draw_leg(d, (11, 38), (6, 50), (5, 43), False); draw_leg(d, (21, 38), (26, 48), (27, 42))
        draw_arm(d, (7, 21), (5, 12), (3, 16), 'G')
        draw_torso(d, cx, 17)
        draw_head(d, cx, 0)
        draw_arm(d, (25, 21), (27, 12), (29, 16))
    elif name == 'crouch':
        draw_leg(d, (10, 51), (5, 61), (4, 56), False); draw_leg(d, (22, 51), (27, 61), (28, 56))
        draw_arm(d, (7, 38), (9, 41), (4, 43), 'G')
        draw_torso(d, cx, 34, h=17)
        draw_head(d, cx, 16)
        draw_arm(d, (25, 38), (21, 41), (28, 44))
    elif name == 'punch':
        draw_leg(d, (11, 40), (6, 59), (7, 50), False); draw_leg(d, (21, 40), (27, 59), (25, 50))
        draw_arm(d, (7, 25), (7, 28), (3, 30), 'G')
        draw_torso(d, cx, 21, lean=2)
        draw_head(d, cx + 2, 3)
        # braço direito estendido: soco
        draw_arm(d, (26, 26), (31, 26), (28, 26))
        # linhas de velocidade
        px(d, 29, 22, 'w'); px(d, 30, 21, 'w'); px(d, 29, 31, 'w'); px(d, 30, 32, 'w')
    return img


POSES = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'jump', 'crouch', 'punch']


def shadow():
    img = newimg(); d = ImageDraw.Draw(img)
    # elipse achatada nas últimas linhas do bloco 32x32 (sprite da sombra ocupa só a parte de cima do bloco de 64)
    d.ellipse((2, 24, 29, 30), fill=IDX['k'])
    d.ellipse((5, 25, 26, 29), fill=IDX['G'])
    return img.crop((0, 0, 32, 32))


def snes_tile(img, tx, ty):
    """converte um bloco 8x8 de imagem indexada para 32 bytes em 4bpp planar do SNES"""
    b = bytearray(32)
    for y in range(8):
        p0 = p1 = p2 = p3 = 0
        for x in range(8):
            v = img.getpixel((tx * 8 + x, ty * 8 + y)) & 15
            bit = 7 - x
            p0 |= (v & 1) << bit; p1 |= ((v >> 1) & 1) << bit; p2 |= ((v >> 2) & 1) << bit; p3 |= ((v >> 3) & 1) << bit
        b[y * 2] = p0; b[y * 2 + 1] = p1; b[16 + y * 2] = p2; b[16 + y * 2 + 1] = p3
    return bytes(b)


def bgr15(rgb):
    r, g, b = rgb
    return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)


def build_sprites():
    chunks = []  # lista de imagens 32x32 (indexadas)
    previews = []
    for name in POSES:
        im = pose(name); previews.append(im)
        chunks.append(im.crop((0, 0, 32, 32))); chunks.append(im.crop((0, 32, 32, 64)))
    chunks.append(shadow())
    # grade de tiles de 16 por linha: cada bloco 32x32 ocupa 4x4 tiles, 4 blocos por faixa
    n = len(chunks); groups = (n + 3) // 4
    rows = groups * 4
    grid = [[None] * 16 for _ in range(rows)]
    tiles_of = []
    for k, ch in enumerate(chunks):
        gy, gx = (k // 4) * 4, (k % 4) * 4
        tiles_of.append(gy * 16 + gx)
        for ty in range(4):
            for tx in range(4):
                grid[gy + ty][gx + tx] = snes_tile(ch, tx, ty)
    blank = bytes(32)
    data = b''.join((grid[r][c] or blank) for r in range(rows) for c in range(16))
    open(os.path.join(OUT, 'sprites.bin'), 'wb').write(data)
    pal = bytearray()
    for c in PAL:
        rgb = C[c] if C[c] else (0, 0, 0)
        pal += struct.pack('<H', bgr15(rgb))
    pal += bytes(32 - len(pal))
    open(os.path.join(OUT, 'obj_pal.bin'), 'wb').write(bytes(pal))
    # tabela: para cada bloco, byte do tile (8 bits baixos) e bit de tabela (tile>>8)
    with open(os.path.join(OUT, 'chunks.inc'), 'w') as f:
        f.write('; gerado por tools/gen_assets.py: tile baixo, bit de tabela (N) para cada bloco 32x32\nChunkTbl:\n')
        for k, t in enumerate(tiles_of):
            f.write('  .db $%02X, $%02X\n' % (t & 255, (t >> 8) & 1))
        f.write('.define NFRAMES %d\n.define SHADOW_CHUNK %d\n' % (len(POSES), len(chunks) - 1))
    # prévia
    sheet = Image.new('RGB', (len(POSES) * 34 + 2, 66), (60, 70, 100))
    rgbpal = []
    for c in PAL:
        rgbpal += list(C[c] if C[c] else (60, 70, 100))
    for i, im in enumerate(previews):
        im2 = im.copy(); im2.putpalette(rgbpal + [0] * (768 - len(rgbpal)))
        im2 = im2.convert('RGBA'); a = Image.new('L', im.size, 0)
        for y in range(64):
            for x in range(32): a.putpixel((x, y), 255 if im.getpixel((x, y)) else 0)
        im2.putalpha(a); sheet.paste(im2, (2 + i * 34, 1), im2)
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    sheet.save(os.path.join(OUT, 'preview_sprites.png'))
    return len(data)


# ---------- cenário: pátio de um quartel abandonado, neve, fim de tarde ----------
def build_bg():
    W, H = 256, 224
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)
    sky = [(26, 24, 58), (46, 36, 82), (92, 50, 100), (158, 72, 98), (224, 126, 96)]
    bands = [0, 40, 78, 112, 142]
    for i, (c, y0) in enumerate(zip(sky, bands)):
        y1 = bands[i + 1] if i + 1 < len(bands) else 188
        d.rectangle((0, y0, W, y1), fill=c)
        # transição pontilhada com a faixa seguinte
        if i + 1 < len(sky):
            for yy in range(y1 - 6, y1):
                for xx in range((yy % 2), W, 2):
                    d.point((xx, yy), fill=sky[i + 1])
    # sol baixo
    d.ellipse((176, 150, 216, 190), fill=(244, 182, 110)); d.ellipse((184, 158, 208, 182), fill=(252, 214, 140))
    # montanhas distantes
    d.polygon([(0, 150), (30, 128), (60, 146), (96, 122), (140, 150), (170, 136), (210, 152), (256, 130), (256, 190), (0, 190)], fill=(60, 44, 84))
    # prédio do quartel (silhueta) com estrela vermelha desbotada
    d.rectangle((10, 96, 170, 190), fill=(34, 30, 52)); d.rectangle((10, 96, 170, 100), fill=(52, 44, 70))
    d.polygon([(4, 98), (90, 78), (176, 98)], fill=(30, 26, 46))
    for wx in range(22, 160, 24):
        for wy in (108, 142):
            d.rectangle((wx, wy, wx + 11, wy + 16), fill=(20, 18, 34))
    for wx, wy in ((46, 108), (94, 142), (142, 108)):
        d.rectangle((wx, wy, wx + 11, wy + 16), fill=(236, 190, 82))
    # estrela vermelha no frontão
    cx, cy, r = 90, 88, 10
    import math
    star = [(cx + (r if i % 2 == 0 else r * 0.42) * math.sin(math.pi * i / 5), cy - (r if i % 2 == 0 else r * 0.42) * math.cos(math.pi * i / 5)) for i in range(10)]
    d.polygon(star, fill=(168, 38, 48))
    # carrossel enferrujado à direita
    d.rectangle((222, 118, 224, 190), fill=(78, 48, 40)); d.rectangle((238, 126, 240, 190), fill=(78, 48, 40))
    d.polygon([(206, 120), (231, 100), (256, 120)], fill=(112, 58, 44)); d.rectangle((206, 120, 256, 124), fill=(84, 46, 40))
    for hx in (212, 230, 246):
        d.rectangle((hx, 130, hx + 2, 186), fill=(60, 40, 40))
    d.ellipse((206, 168, 256, 190), fill=(60, 40, 40))
    # cerca
    for fx in range(0, W, 12):
        d.rectangle((fx, 168, fx + 2, 192), fill=(26, 22, 38))
    d.rectangle((0, 174, W, 176), fill=(26, 22, 38))
    # chão de neve
    d.rectangle((0, 188, W, H), fill=(204, 216, 238))
    d.rectangle((0, 188, W, 191), fill=(238, 244, 255))
    for y in range(192, H, 8):
        for x in range((y // 8 % 2) * 8, W, 16):
            d.rectangle((x, y, x + 7, y + 1), fill=(172, 188, 222))
    # linha de pisos de pedra na parte de baixo
    d.rectangle((0, 212, W, H), fill=(150, 168, 206))
    for x in range(0, W, 32): d.rectangle((x, 212, x + 1, H), fill=(120, 140, 184))
    # flocos de neve
    import random
    rnd = random.Random(7)
    for _ in range(46):
        x, y = rnd.randrange(W), rnd.randrange(0, 186)
        d.point((x, y), fill=(236, 240, 252))
    # reduz para 15 cores + índice 0
    q = im.quantize(colors=15, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = q.getpalette()[:45]
    # índice 0 reservado como cor do fundo (a cor mais escura do céu)
    colors = [(26, 24, 58)] + [tuple(pal[i:i + 3]) for i in range(0, 45, 3)]
    # remapeia: pixels -> menor distância na paleta de 16 cores
    out = Image.new('P', (W, H))
    flat = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata()); idx = []
    cache = {}
    for p in flat:
        if p not in cache:
            cache[p] = min(range(16), key=lambda i: sum((a - b) ** 2 for a, b in zip(p, colors[i])))
        idx.append(cache[p])
    out.putdata(idx)
    out.putpalette([v for c in colors for v in c] + [0] * (768 - 48))
    # tiles únicos
    tiles, tmap, seen = [], [], {}
    for ty in range(32):
        for tx in range(32):
            if ty >= H // 8:
                key = bytes(32)
                b = key
            else:
                b = snes_tile(out, tx, ty)
            if b not in seen:
                seen[b] = len(tiles); tiles.append(b)
            tmap.append(seen[b])
    open(os.path.join(OUT, 'bg_tiles.bin'), 'wb').write(b''.join(tiles))
    open(os.path.join(OUT, 'bg_map.bin'), 'wb').write(b''.join(struct.pack('<H', t) for t in tmap))
    open(os.path.join(OUT, 'bg_pal.bin'), 'wb').write(b''.join(struct.pack('<H', bgr15(c)) for c in colors))
    pv = out.convert('RGB').resize((W * 2, H * 2), Image.NEAREST); pv.save(os.path.join(OUT, 'preview_bg.png'))
    return len(tiles)


if __name__ == '__main__':
    ns = build_sprites(); nb = build_bg()
    open(os.path.join(OUT, 'sizes.inc'), 'w').write('.define SPR_SIZE %d\n.define BGT_SIZE %d\n' % (ns, nb * 32))
    print('sprites.bin', ns, 'bytes | tiles do cenário únicos:', nb, '(%d bytes)' % (nb * 32))
    if nb > 960: print('AVISO: tiles demais para o espaço reservado'); sys.exit(1)
