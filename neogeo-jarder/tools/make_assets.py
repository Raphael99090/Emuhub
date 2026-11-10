#!/usr/bin/env python3
"""Converte os PNGs (Avenida + Jarder idle) em dados de Neo Geo.
Saidas em build/: c1.bin c2.bin (tiles de sprite), pal.bin (256x16 palavras), scb1_stage.bin, scb1_jarder.bin, info.json
Uso: python3 -I make_assets.py <raiz do projeto>
"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from scipy.spatial.distance import cdist

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
ART, BUILD = os.path.join(ROOT, 'art'), os.path.join(ROOT, 'build')
os.makedirs(BUILD, exist_ok=True)
rng = np.random.default_rng(7)

def q5(a):  # arredonda para 5 bits por canal (0..31) e volta a 0..255 aproximado
    return np.clip(np.rint(a / 255 * 31), 0, 31)

# ---------- encoder de tile 16x16 (inverso do renderizador) ----------
def encode_tile(idx):
    """idx: (16,16) indices 0..15 -> (64 bytes c1, 64 bytes c2)"""
    c1 = bytearray(64); c2 = bytearray(64)
    for r in range(16):
        for X in range(16):
            v = int(idx[r, X]); k = 15 - X; half, px = k >> 3, k & 7; bit = 7 - px
            ro = half * 32 + (16 if r >= 8 else 0) + (r & 7) * 2
            if v & 1: c1[ro] |= 1 << bit
            if v & 2: c1[ro + 1] |= 1 << bit
            if v & 4: c2[ro] |= 1 << bit
            if v & 8: c2[ro + 1] |= 1 << bit
    return bytes(c1), bytes(c2)

def decode_tile(c1, c2):
    out = np.zeros((16, 16), np.uint8)
    for r in range(16):
        for X in range(16):
            k = 15 - X; half, px = k >> 3, k & 7; bit = 7 - px
            ro = half * 32 + (16 if r >= 8 else 0) + (r & 7) * 2
            out[r, X] = ((c1[ro] >> bit) & 1) | (((c1[ro + 1] >> bit) & 1) << 1) | (((c2[ro] >> bit) & 1) << 2) | (((c2[ro + 1] >> bit) & 1) << 3)
    return out

def pal_word(rgb5):
    r, g, b = [int(x) for x in rgb5]
    return ((r & 1) << 14) | ((g & 1) << 13) | ((b & 1) << 12) | ((r >> 1) << 8) | ((g >> 1) << 4) | (b >> 1)

# ---------- ajuste de paletas ----------
def tile_colors(px, k):
    u = np.unique(px, axis=0)
    if len(u) <= k: return u.astype(float)
    c, _ = kmeans2(px.astype(float), k, seed=int(rng.integers(1 << 30)), minit='++')
    return c

def fit_palettes(tiles, K, ncol=15, iters=4):
    """tiles: lista de arrays (N,3) em escala 0..31 (apenas pixels opacos). Retorna paletas (K,ncol,3) e atribuicao."""
    n = len(tiles)
    K = min(K, n)
    lum = lambda c: c @ np.array([.3, .59, .11])
    feats = []
    for t in tiles:
        if len(t) == 0: feats.append(np.zeros(ncol * 3)); continue
        c = tile_colors(t, ncol); c = c[np.argsort(lum(c))]
        # reamostra para ncol por interpolacao simples
        idx = np.linspace(0, len(c) - 1, ncol).round().astype(int); feats.append(c[idx].ravel())
    feats = np.array(feats)
    _, lab = kmeans2(feats, K, seed=3, minit='++')
    pals = np.zeros((K, ncol, 3))
    for it in range(iters):
        for k in range(K):
            m = [tiles[i] for i in range(n) if lab[i] == k and len(tiles[i])]
            if not m:
                pals[k] = pals[k - 1] if k else 0; continue
            pooled = np.concatenate(m)
            if len(pooled) > 4000: pooled = pooled[rng.choice(len(pooled), 4000, replace=False)]
            c = tile_colors(pooled, ncol)
            pals[k, :len(c)] = c
            if len(c) < ncol: pals[k, len(c):] = c[-1]
        pals = np.rint(pals)
        allc = pals.reshape(-1, 3)
        for i, t in enumerate(tiles):
            if not len(t): continue
            u, cnt = np.unique(t, axis=0, return_counts=True)
            d = cdist(u, allc, 'sqeuclidean').reshape(len(u), K, ncol).min(2)
            lab[i] = int(np.argmin((d * cnt[:, None]).sum(0)))
    return pals, lab

def index_tile(px16, alpha16, pal):
    """px16 (16,16,3) 0..31; devolve (16,16) 1..15 (0 transparente)"""
    d = cdist(px16.reshape(-1, 3), pal, 'sqeuclidean').argmin(1).reshape(16, 16) + 1
    d[alpha16 < 128] = 0
    return d.astype(np.uint8)

# ---------- palco ----------
def build_stage():
    pick = [0, 2, 4, 6, 8, 10, 12, 14]             # 8 quadros -> auto-animacao do LSPC (bit 2 do atributo)
    frames = []
    for f in pick:
        im = Image.open(os.path.join(ART, 'stage', 'avenida_frame_%02d.png' % (f + 1))).convert('RGB')
        im = im.resize((round(im.width * 224 / im.height), 224), Image.LANCZOS)
        im = im.crop((0, 0, 44 * 16, 224)) if im.width >= 44 * 16 else im.resize((44 * 16, 224), Image.LANCZOS)
        frames.append(q5(np.asarray(im, float)))
    cols, rows = 44, 14
    pos = [(c, r) for c in range(cols) for r in range(rows)]
    groups = []
    for (c, r) in pos:
        groups.append(np.concatenate([fr[r * 16:(r + 1) * 16, c * 16:(c + 1) * 16].reshape(-1, 3) for fr in frames]))
    return frames, pos, groups

# ---------- Jarder ----------
def build_jarder(sheet):
    im = Image.open(sheet).convert('RGBA'); a = np.asarray(im)
    mask = a[:, :, 3] > 40
    # um boneco por componente conexo grande, da esquerda para a direita
    lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    comps = [i + 1 for i, s in enumerate(sizes) if s > 15000]
    comps.sort(key=lambda i: ndimage.center_of_mass(lab == i)[1])
    crops = []
    for i in comps:
        m = (lab == i) & mask; ys, xs = np.where(m)
        sl = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
        rgba = a[sl].copy(); rgba[~m[sl], 3] = 0
        crops.append(rgba)
    print(os.path.basename(sheet), len(crops), 'quadros')
    return crops

def render_frames(crops, scale, out_h=160, box_w=96):
    frames = []
    for c in crops:
        h, w = c.shape[:2]; nh, nw = max(1, round(h * scale)), max(1, round(w * scale))
        arr = np.asarray(Image.fromarray(c).resize((nw, nh), Image.LANCZOS)).astype(float)
        # ancora no centro de massa do tronco (40% superior), para o corpo nao "tremer" ao andar
        top = arr[:max(1, int(nh * .4)), :, 3] > 128
        xs = np.where(top.any(0))[0]; anchor = int(xs.mean()) if len(xs) else nw // 2
        ox = box_w // 2 - anchor; oy = out_h - nh
        if ox < 0 or ox + nw > box_w: raise SystemExit('sprite largo demais: ox=%d nw=%d box=%d' % (ox, nw, box_w))
        canvas = np.zeros((out_h, box_w, 4)); canvas[oy:oy + nh, ox:ox + nw] = arr
        frames.append((q5(canvas[:, :, :3]), canvas[:, :, 3]))
    return frames

def main():
    pal_words = np.zeros((256, 16), np.uint16)
    c1 = bytearray(); c2 = bytearray()
    def add_tile(idx):
        a, b = encode_tile(idx); c1.extend(a); c2.extend(b); return len(c1) // 64 - 1

    info = {}
    # ---- palco: paletas 16..143 ----
    frames, pos, groups = build_stage()
    print('palco: ajustando paletas...'); pals, lab = fit_palettes(groups, 128)
    scb1 = {}
    stage_base = 0
    assert not c1
    for g, (c, r) in enumerate(pos):
        p = pals[lab[g]]
        ids = []
        for f in range(8):
            px = frames[f][r * 16:(r + 1) * 16, c * 16:(c + 1) * 16]
            ids.append(add_tile(index_tile(px, np.full((16, 16), 255), p)))
        assert ids[0] % 8 == 0 and ids[7] == ids[0] + 7
        scb1[(c, r)] = (ids[0], 16 + int(lab[g]))
    for k in range(len(pals)):
        pal_words[16 + k, 1:] = [pal_word(x) for x in pals[k]]
    stage = bytearray()
    for c in range(44):
        for r in range(14):
            code, pal = scb1[(c, r)]
            stage += int(code & 0xFFFF).to_bytes(2, 'big') + int((pal << 8) | ((code >> 16) << 4) | 0x04).to_bytes(2, 'big')
    open(os.path.join(BUILD, 'scb1_stage.bin'), 'wb').write(stage)

    # ---- Jarder: paletas 144..255 ----
    idle = build_jarder(os.path.join(ART, 'sprites', 'jarder_idle.png'))
    walk = build_jarder(os.path.join(ART, 'sprites', 'jarder_walk.png'))
    scale = 160 / max(c.shape[0] for c in idle)
    med = lambda cs: float(np.median([c.shape[0] for c in cs]))
    wscale = scale * min(1.12, med(idle) / med(walk))       # o andar foi gerado mais baixo: iguala a altura tipica
    print('escala idle %.4f andar %.4f' % (scale, wscale))
    jf = render_frames(idle, scale) + render_frames(walk, wscale)
    tiles, meta = [], []
    for fi, (rgb, al) in enumerate(jf):
        for cx in range(6):
            for ry in range(10):
                sl = (slice(ry * 16, ry * 16 + 16), slice(cx * 16, cx * 16 + 16))
                a16 = al[sl]; px = rgb[sl]
                tiles.append(px[a16 >= 128]); meta.append((fi, cx, ry, px, a16))
    print('jarder: ajustando paletas (%d tiles)...' % len(tiles))
    jp, jl = fit_palettes(tiles, 110)
    for k in range(len(jp)):
        pal_words[144 + k, 1:] = [pal_word(x) for x in jp[k]]
    # codigos de tile: alinhados a 0x800
    while len(c1) // 64 < 0x1400: add_tile(np.zeros((16, 16), np.uint8))
    jb = bytearray(); jbase = len(c1) // 64
    for i, (fi, cx, ry, px, a16) in enumerate(meta):
        if not (a16 >= 128).any():
            code = add_tile(np.zeros((16, 16), np.uint8)); pal = 144
        else:
            code = add_tile(index_tile(px, a16, jp[jl[i]])); pal = 144 + int(jl[i])
        jb += code.to_bytes(2, 'big') + int((pal << 8) | ((code >> 16) << 4)).to_bytes(2, 'big')
    open(os.path.join(BUILD, 'scb1_jarder.bin'), 'wb').write(jb)
    pad = (-len(c1)) % (0x10000)
    c1 += bytes(pad); c2 += bytes(pad)
    open(os.path.join(BUILD, 'c1.bin'), 'wb').write(c1); open(os.path.join(BUILD, 'c2.bin'), 'wb').write(c2)
    open(os.path.join(BUILD, 'pal.bin'), 'wb').write(b''.join(int(w).to_bytes(2, 'big') for w in pal_words.ravel()))
    info = dict(tiles=len(c1) // 64, jarder_frames=len(jf), jarder_base=jbase)
    json.dump(info, open(os.path.join(BUILD, 'info.json'), 'w'))
    print(info)

    # ---- previa: redecodifica a partir dos binarios ----
    def pal_rgb(p, i):
        w = int(pal_words[p, i]); r = ((w >> 8) & 15) << 1 | ((w >> 14) & 1); g = ((w >> 4) & 15) << 1 | ((w >> 13) & 1); b = (w & 15) << 1 | ((w >> 12) & 1)
        return [round(r * 255 / 31), round(g * 255 / 31), round(b * 255 / 31)]
    img = np.zeros((224, 704, 3), np.uint8)
    for c in range(44):
        for r in range(14):
            o = (c * 14 + r) * 4; code = int.from_bytes(stage[o:o + 2], 'big'); pal = stage[o + 2]
            t = decode_tile(c1[code * 64:code * 64 + 64], c2[code * 64:code * 64 + 64])
            for y in range(16):
                for x in range(16): img[r * 16 + y, c * 16 + x] = pal_rgb(pal, t[y, x])
    Image.fromarray(img).save(os.path.join(BUILD, 'prev_stage.png'))
    fr = []
    for fi in (0, 4, 8, 12):
        im = np.zeros((160, 96, 3), np.uint8) + 40
        for cx in range(6):
            for ry in range(10):
                o = ((fi * 6 + cx) * 10 + ry) * 4; code = int.from_bytes(jb[o:o + 2], 'big'); pal = jb[o + 2]
                t = decode_tile(c1[code * 64:code * 64 + 64], c2[code * 64:code * 64 + 64])
                for y in range(16):
                    for x in range(16):
                        if t[y, x]: im[ry * 16 + y, cx * 16 + x] = pal_rgb(pal, t[y, x])
        fr.append(im)
    Image.fromarray(np.concatenate(fr, 1)).resize((384 * 2, 160 * 2), Image.NEAREST).save(os.path.join(BUILD, 'prev_jarder.png'))

main()
