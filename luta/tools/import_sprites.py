#!/usr/bin/env python3
"""Importa os sprites do Jarder gerados por IA (art/src/*.jpg, fundo magenta):
recorta cada pose, tira o fundo, escala todas pela MESMA proporção (medida pelo tamanho do cabelo),
alinha pelos pés/centro, reduz preservando o contorno preto e mapeia para uma paleta única de 15 cores.
Devolve a lista de poses (índices 0..15, 0 = transparente) e a paleta."""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'art', 'src')
TARGET_H = 112          # altura (px finais) do Jarder em pé
GROUND = 122            # linha do chão dentro do quadro (a sola das botas termina aqui)
OUTLINE = (16, 14, 22)


def fg_mask(rgb):
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    mn = np.minimum(r, b)
    mag = (mn - g > 45) & (mn > 70)
    fg = ~mag
    fg = ndi.binary_opening(fg, iterations=1)
    lab, n = ndi.label(fg)
    if n:
        areas = ndi.sum(fg, lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool); keep[1:] = areas >= 900
        fg = keep[lab]
    # buracos pequenos dentro do corpo
    holes = ndi.binary_fill_holes(fg) & ~fg
    lab, n = ndi.label(holes)
    if n:
        areas = ndi.sum(holes, lab, range(1, n + 1))
        small = np.zeros(n + 1, bool); small[1:] = areas < 400
        fg |= small[lab]
    return fg


def split(name):
    """devolve lista de (rgb, mask) com um personagem cada, na ordem esquerda->direita, cima->baixo"""
    im = np.array(Image.open(os.path.join(SRC, name)).convert('RGB'))
    fg = fg_mask(im)
    lab, n = ndi.label(ndi.binary_dilation(fg, iterations=3))
    objs = ndi.find_objects(lab)
    items = []
    for i, sl in enumerate(objs):
        m = (lab[sl] == i + 1) & fg[sl]
        if m.sum() < 6000: continue
        items.append((sl, m))
    if name.startswith('sheet'): items.sort(key=lambda t: t[0][1].start)
    else: items.sort(key=lambda t: (round(t[0][0].start / 400), t[0][1].start))
    return [(im[sl], m) for sl, m in items]


def hair_width(rgb, m, lying=False):
    """largura do cabelo grisalho: maior região cinza na parte de cima do personagem"""
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    mx = np.maximum(np.maximum(r, g), b); mn = np.minimum(np.minimum(r, g), b)
    gray = m & (mx - mn < 34) & (mx > 75) & (mx < 205)
    gray = ndi.binary_closing(gray, iterations=2)
    gray = ndi.binary_opening(gray, iterations=3)
    ys = np.where(m.any(1))[0]; top = ys[0]; hgt = ys[-1] - top
    lab, n = ndi.label(gray)
    best = None
    for i, sl in enumerate(ndi.find_objects(lab)):
        area = (lab[sl] == i + 1).sum()
        if area < 700: continue
        if not lying and sl[0].start > top + 0.3 * hgt: continue
        if best is None or area > best[1]: best = (sl, area)
    return (best[0][1].stop - best[0][1].start) if best else None


def downscale(rgb, m, s):
    """reduz por 's' preservando contorno: cor por média, contorno preto por fração de escuro"""
    h, w = m.shape
    # preenche o fundo com a cor do vizinho mais próximo (evita borda rosa)
    idx = ndi.distance_transform_edt(~m, return_distances=False, return_indices=True)
    filled = rgb[idx[0], idx[1]]
    nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    I = Image.fromarray(filled)
    col = np.array(I.resize((nw, nh), Image.BOX)).astype(float)
    lum = filled.astype(float) @ [0.3, 0.59, 0.11]
    chroma = filled.max(-1).astype(int) - filled.min(-1).astype(int)
    dark = (m & (lum < 62) & (chroma < 48)).astype(np.float32)
    dfrac = np.array(Image.fromarray(dark).resize((nw, nh), Image.BOX))
    mfrac = np.array(Image.fromarray(m.astype(np.float32)).resize((nw, nh), Image.BOX))
    alpha = mfrac > 0.5
    outl = alpha & (dfrac > 0.30)
    return col, alpha, outl


def build():
    poses = {}  # nome -> (col, alpha, outl, scale)
    srcs = [
        ('idle0', 'idle_a.jpg', 0), ('idle1', 'idle_b.jpg', 0),
        ('walk0', 'walk_grid.jpg', 0), ('walk1', 'walk_grid.jpg', 1), ('walk2', 'walk_grid.jpg', 2), ('walk3', 'walk_grid.jpg', 3),
        ('jump', 'jump.jpg', 0), ('crouch', 'crouch.jpg', 0), ('punch', 'punch.jpg', 0), ('kick', 'kick.jpg', 0),
        ('hurt', 'sheet_8_11.jpg', 0), ('ko', 'sheet_8_11.jpg', 1), ('victory', 'sheet_8_11.jpg', 2), ('block', 'sheet_8_11.jpg', 3),
    ]
    cache = {}
    raw = {}
    for name, f, k in srcs:
        if f not in cache: cache[f] = split(f)
        items = cache[f]
        raw[name] = items[k]
    hw = {n: hair_width(*raw[n], lying=(n == 'ko')) for n in raw}
    return raw, hw


ORDER = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'jump', 'crouch', 'punch', 'kick', 'hurt', 'ko', 'victory', 'block']
FH = 128


def frames():
    """-> (poses, palette): poses = [(nome, array HxW de índices, largo?)], palette = 16 cores RGB (0 = transparente)"""
    raw, hw = build()
    H = {n: float(np.where(raw[n][1].any(1))[0][-1] - np.where(raw[n][1].any(1))[0][0] + 1) for n in raw}
    s_idle = TARGET_H / ((H['idle0'] + H['idle1']) / 2)
    hair_idle = (hw['idle0'] + hw['idle1']) / 2
    scale = {}
    for n in raw:
        if n.startswith('idle'): scale[n] = s_idle
        elif n.startswith('walk'): scale[n] = (TARGET_H - 3) / np.mean([H['walk%d' % i] for i in range(4)])
        elif n in ('hurt', 'ko', 'victory', 'block'): scale[n] = TARGET_H / 513.0   # folha 8-11: personagem em pé ~513 px da cabeça aos pés
        else: scale[n] = s_idle * hair_idle / hw[n]
    small = {}
    for n in ORDER:
        rgb, m = raw[n]
        col, alpha, outl = downscale(rgb, m, scale[n])
        if alpha.shape[0] > 120:                         # cabe no quadro
            f = 120.0 / alpha.shape[0]; col, alpha, outl = downscale(rgb, m, scale[n] * f)
        small[n] = (col, alpha, outl)
    # paleta global: contorno fixo + 14 cores (k-means, dando peso a cores raras e saturadas)
    px, wt = [], []
    for n in ORDER:
        col, alpha, outl = small[n]
        sel = alpha & ~outl
        c = col[sel]; mx = c.max(1); mn = c.min(1); sat = (mx - mn) / (mx + 1)
        px.append(c); wt.append(1 + 5 * sat)
    px = np.concatenate(px); wt = np.concatenate(wt)
    # 1ª etapa: 56 grupos finos; 2ª: junta em 14 com peso por raiz da contagem (cores raras, como o dourado, sobrevivem)
    rng = np.random.RandomState(1)
    sub = rng.choice(len(px), min(len(px), 30000), replace=False)
    fine = np.array(Image.fromarray(px[sub][:len(sub) // 50 * 50].reshape(-1, 50, 3).astype(np.uint8)).quantize(56, Image.Quantize.MEDIANCUT).getpalette()[:168], float).reshape(56, 3)
    for _ in range(6):
        lab = ((px[:, None, :] - fine[None]) ** 2).sum(-1).argmin(1)
        for k in range(56):
            sel = lab == k
            if sel.any(): fine[k] = px[sel].mean(0)
    cnt = np.bincount(lab, minlength=56).astype(float)
    fsat = (fine.max(1) - fine.min(1)) / (fine.max(1) + 1)
    fw = np.sqrt(cnt) * (1 + 1.2 * fsat)
    ok = cnt > 20; fine, fw = fine[ok], fw[ok]
    cen = fine[np.argsort(-fw)[:14]].copy()
    for _ in range(25):
        lab2 = ((fine[:, None, :] - cen[None]) ** 2).sum(-1).argmin(1)
        for k in range(14):
            sel = lab2 == k
            if sel.any(): cen[k] = (fine[sel] * fw[sel, None]).sum(0) / fw[sel].sum()
    pal = [None, OUTLINE] + [tuple(int(round(v)) for v in c) for c in cen]
    cenarr = np.array(pal[2:], float)
    out = []
    for n in ORDER:
        col, alpha, outl = small[n]
        h, w = alpha.shape
        idx = np.zeros((h, w), np.uint8)
        d = ((col[:, :, None, :] - cenarr[None, None]) ** 2).sum(-1)
        idx[alpha] = (d.argmin(-1) + 2)[alpha]
        idx[outl] = 1
        ys, xs = np.where(alpha)
        wide = (xs.max() - xs.min() + 1) > 62
        CW = 128 if wide else 64
        cx = xs.mean()
        ox = int(round(CW / 2 - cx))
        ox = max(1 - xs.min(), min(CW - 1 - xs.max(), ox))
        oy = GROUND + 1 - (ys.max() + 1)
        canvas = np.zeros((FH, CW), np.uint8)
        canvas[oy + ys.min():oy + ys.max() + 1, ox + xs.min():ox + xs.max() + 1] = idx[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out.append((n, canvas, wide))
    return out, pal


if __name__ == '__main__':
    poses, pal = frames()
    sheet = Image.new('RGB', (sum(c.shape[1] + 4 for _, c, _ in poses) + 4, 132), (70, 84, 120))
    x = 4
    for n, c, wide in poses:
        rgba = np.zeros((FH, c.shape[1], 4), np.uint8)
        for j, col in enumerate(pal):
            if col: rgba[c == j] = (*col, 255)
        t = Image.fromarray(rgba, 'RGBA'); sheet.paste(t, (x, 2), t); x += c.shape[1] + 4
        print(n, c.shape[1], 'largo' if wide else '')
    sheet.save(os.path.join(HERE, '..', 'build', 'preview_import.png'))
    print(pal)
