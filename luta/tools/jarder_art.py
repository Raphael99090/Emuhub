#!/usr/bin/env python3
"""Renderizador do Jarder em alta resolução (64x128 px finais, desenhado em 4x e reduzido por maioria).
Cada parte do corpo é uma forma com contorno e sombreado cilíndrico em 3 tons (luz vindo de cima à esquerda),
no estilo de arte de luta de arcade. Paleta fixa de 15 cores + transparente."""
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

S = 4                      # fator de super-amostragem
FW, FH = 64, 128           # tamanho final do quadro
W, H = FW * S, FH * S

# índices da paleta (0 = transparente)
K, S1, S2, S3, U1, U2, U3, H1, H2, H3, R1, R2, GOLD, BOOT, WHITE = range(1, 16)
PALETTE = [None, (18, 14, 22), (244, 190, 146), (212, 148, 104), (150, 94, 72),
           (158, 158, 104), (112, 116, 72), (68, 74, 50),
           (228, 228, 236), (160, 162, 176), (96, 98, 114),
           (214, 40, 44), (132, 20, 34), (248, 206, 62), (58, 54, 70), (244, 244, 252)]
MAT = {'skin': (S1, S2, S3), 'uni': (U1, U2, U3), 'hair': (H1, H2, H3), 'red': (R1, R1, R2),
       'gold': (GOLD, GOLD, GOLD), 'boot': (BOOT, BOOT, K), 'lens': (H3, H3, H3)}
LIGHT = np.array([-0.5, -0.7, 0.55]); LIGHT /= np.linalg.norm(LIGHT)
OW = 4.6                   # espessura do contorno (px em alta resolução)


class Canvas:
    def __init__(self):
        self.idx = np.zeros((H, W), np.uint8)

    # ----- máscaras (desenhadas em alta resolução) -----
    @staticmethod
    def _new():
        im = Image.new('L', (W, H), 0); return im, ImageDraw.Draw(im)

    def m_poly(self, pts):
        im, d = self._new(); d.polygon([(x * S, y * S) for x, y in pts], fill=255); return im

    def m_ell(self, cx, cy, rx, ry):
        im, d = self._new(); d.ellipse(((cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S), fill=255); return im

    def m_cap(self, a, b, ra, rb=None):
        """cápsula afunilada de a até b com raios ra -> rb"""
        rb = ra if rb is None else rb
        im, d = self._new()
        ax, ay, bx, by = a[0] * S, a[1] * S, b[0] * S, b[1] * S
        L = max(((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5, 1e-6); nx, ny = -(by - ay) / L, (bx - ax) / L
        d.polygon([(ax + nx * ra * S, ay + ny * ra * S), (bx + nx * rb * S, by + ny * rb * S),
                   (bx - nx * rb * S, by - ny * rb * S), (ax - nx * ra * S, ay - ny * ra * S)], fill=255)
        d.ellipse((ax - ra * S, ay - ra * S, ax + ra * S, ay + ra * S), fill=255)
        d.ellipse((bx - rb * S, by - rb * S, bx + rb * S, by + rb * S), fill=255)
        return im

    # ----- pintura -----
    def part(self, mask, mat, bias=0.0, outline=True, clip=None, flat=None):
        m = np.array(mask) > 0
        if clip is not None: m &= clip
        if not m.any(): return m
        din = ndi.distance_transform_edt(m); dout = ndi.distance_transform_edt(~m)
        if outline:
            ring = (dout <= OW) & ~m
            if clip is not None: ring &= clip | (dout <= OW)  # contorno também fora do clip é permitido
            self.idx[ring] = K
        sd = ndi.gaussian_filter(dout - din, 2.0)
        gy, gx = np.gradient(sd); g = np.sqrt(gx * gx + gy * gy) + 1e-6; gx /= g; gy /= g
        R = max(din.max(), 1.0); t = np.clip(din / R, 0, 1)
        nz = np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1)); k = 1 - t
        nx_, ny_ = gx * k, gy * k
        # a normal aponta para fora (gradiente de sd cresce para fora)
        dot = nx_ * LIGHT[0] + ny_ * LIGHT[1] + nz * LIGHT[2] + bias
        tone = np.where(dot > 0.60, 0, np.where(dot > 0.22, 1, 2))
        if flat is not None: tone = np.full_like(tone, flat)
        lut = np.array(MAT[mat], np.uint8)
        self.idx[m] = lut[tone][m]
        return m

    def fill(self, mask, color, clip=None):
        m = np.array(mask) > 0
        if clip is not None: m &= clip
        self.idx[m] = color
        return m

    def stroke(self, pts, color, w, clip=None):
        im, d = self._new(); d.line([(x * S, y * S) for x, y in pts], fill=255, width=int(w * S), joint='curve')
        return self.fill(im, color, clip)

    def result(self):
        """reduz S x S por maioria; transparente se a maior parte do bloco for vazia"""
        b = self.idx.reshape(FH, S, FW, S).transpose(0, 2, 1, 3).reshape(FH, FW, S * S)
        counts = np.stack([(b == i).sum(-1) for i in range(16)], -1)
        solid = counts[..., 1:].argmax(-1) + 1
        out = np.where(counts[..., 0] > (S * S) // 2, 0, solid).astype(np.uint8)
        return out


# ---------------------------------------------------------------- partes do corpo
def leg(c, hip, knee, ankle, bias, toe=1):
    c.part(c.m_cap(hip, knee, 8.8, 7.6), 'uni', bias)                      # coxa
    # joelho / canela até a bota
    c.part(c.m_cap(knee, (ankle[0], ankle[1] - 11), 7.4, 6.2), 'uni', bias)
    c.part(c.m_cap((ankle[0], ankle[1] - 17), (ankle[0], ankle[1] - 3), 7.0, 6.4), 'boot', bias)  # cano da bota
    ax, ay = ankle
    foot = [(ax - 7, ay - 6), (ax + 5, ay - 6), (ax + 14 * toe, ay - 1), (ax + 15 * toe, ay + 6), (ax - 8, ay + 6)]
    c.part(c.m_poly(foot), 'boot', bias)
    c.stroke([(ax - 7, ay + 3.2), (ax + 14 * toe, ay + 3.2)], K, 1.6)    # sola
    c.stroke([(ax - 6, ay - 12), (ax + 6, ay - 12)], K, 1.2)             # dobra do cano


def arm(c, sh, el, fist, bias, fr=6.2):
    c.part(c.m_cap(sh, el, 8.0, 6.8), 'uni', bias)                       # manga
    c.stroke([(el[0] - 6, el[1] - 1), (el[0] + 6, el[1] + 1)], K, 1.2)   # dobra da manga
    c.part(c.m_cap(el, fist, 6.2, 5.2), 'skin', bias)                    # antebraço
    c.part(c.m_ell(fist[0], fist[1], fr, fr * 0.92), 'skin', bias)       # punho
    c.stroke([(fist[0] - fr * 0.1, fist[1] - fr * 0.5), (fist[0] - fr * 0.1, fist[1] + fr * 0.5)], K, 0.9)
    c.stroke([(fist[0] + fr * 0.35, fist[1] - fr * 0.5), (fist[0] + fr * 0.35, fist[1] + fr * 0.5)], K, 0.9)


def torso(c, ox, oy, lean=0):
    """tronco largo de coronel: ombros fortes, farda oliva, faixa vermelha diagonal, emblema dourado"""
    P = lambda x, y: (x + ox + (lean * (76 - y) / 38.0 if y < 76 else 0), y + oy)
    pts = [P(16, 42), P(24, 37), P(40, 36), P(49, 41), P(51, 54), P(46, 66), P(45, 77), P(20, 77), P(18, 66), P(13, 54)]
    m = c.part(c.m_poly(pts), 'uni')
    # peitoral (duas curvas) e linha dos abdominais sob a farda
    c.stroke([P(23, 55), P(31, 59), P(38, 57)], U3, 1.1, clip=m)
    c.stroke([P(32, 60), P(32, 70)], U3, 1.0, clip=m)
    # faixa vermelha em diagonal (ombro de trás -> quadril da frente)
    band = [P(19, 38), P(29, 38), P(48, 70), P(37, 74)]
    sm = c.part(c.m_poly(band), 'red', clip=m, outline=True)
    # emblema dourado
    ex, ey = P(34, 56)
    c.part(c.m_ell(ex, ey, 4.2, 4.2), 'gold')
    c.fill(c.m_ell(ex, ey, 1.6, 1.6), K)
    # gola alta e botões
    c.part(c.m_poly([P(25, 37), P(40, 36), P(41, 41), P(33, 44), P(24, 41)]), 'uni', bias=-0.15)
    for by in (48, 62):
        c.fill(c.m_ell(*P(44, by), 1.3, 1.3), GOLD)
    # dragona (ombreira dourada) no ombro da frente
    c.part(c.m_poly([P(41, 38), P(49, 41), P(49, 46), P(42, 44)]), 'gold')
    # cinto com fivela
    belt = c.part(c.m_poly([P(19, 72), P(45, 72), P(46, 78), P(19, 78)]), 'boot')
    c.part(c.m_poly([P(30, 72.5), P(37, 72.5), P(37, 77.5), P(30, 77.5)]), 'gold')
    return m


def head(c, cx, cy, look=1):
    """cabeça de 3/4: óculos de armação grossa, sobrancelhas fechadas, bigode e cavanhaque grisalhos, cabelo ondulado"""
    c.part(c.m_cap((cx - 1, cy + 10), (cx - 1, cy + 20), 6.2), 'skin', bias=-0.2)                # pescoço
    # orelha (lado de perto)
    c.part(c.m_ell(cx - 10, cy + 1, 2.8, 4.2), 'skin')
    # rosto: elipse + queixo marcado
    face = c.part(c.m_ell(cx, cy, 10.2, 12.6), 'skin')
    c.part(c.m_poly([(cx - 8, cy + 5), (cx + 9, cy + 5), (cx + 7, cy + 12), (cx, cy + 14), (cx - 6, cy + 12)]), 'skin', outline=False, clip=face)
    # barba / cavanhaque (cinza) cobrindo o queixo
    c.part(c.m_poly([(cx - 7, cy + 8), (cx + 8, cy + 8), (cx + 6, cy + 15), (cx + 1, cy + 19), (cx - 4, cy + 15)]), 'hair')
    # costeleta
    c.part(c.m_poly([(cx - 10, cy - 2), (cx - 7, cy - 2), (cx - 7, cy + 9), (cx - 10, cy + 7)]), 'hair')
    # cabelo ondulado grisalho: cachos no topo e nas laterais (sem cobrir a testa e os óculos)
    for (hx, hy, r) in ((-9.5, -7, 3.8), (-6, -12, 4.6), (0, -14.5, 5.0), (6.5, -13, 4.8), (10.5, -9, 4.0), (-11, -2, 3.2), (12, -4.5, 3.0),
                        (-3, -11, 3.8), (3, -12, 4.0)):
        c.part(c.m_ell(cx + hx, cy + hy, r, r * 0.92), 'hair', outline=True)
    # nariz
    c.part(c.m_ell(cx + 5, cy + 3.5, 3.4, 3.0), 'skin', outline=True)
    # óculos: dois aros grossos com lente azul-acinzentada
    for (lx, ly, w, h) in ((cx - 7.5, cy - 4.5, 7.6, 6.2), (cx + 2.2, cy - 4.5, 8.4, 6.4)):
        c.fill(c.m_poly([(lx - 1.4, ly - 1.4), (lx + w + 1.4, ly - 1.4), (lx + w + 1.4, ly + h + 1.4), (lx - 1.4, ly + h + 1.4)]), K)
        c.fill(c.m_poly([(lx, ly), (lx + w, ly), (lx + w, ly + h), (lx, ly + h)]), H3)
        c.fill(c.m_poly([(lx + 1, ly + 1), (lx + 3.2, ly + 1), (lx + 1, ly + 3.2)]), WHITE)
        c.fill(c.m_poly([(lx + 1, ly + h - 1.2), (lx + w - 1, ly + h - 1.2), (lx + w - 1, ly + h)]), H2)
    c.stroke([(cx + 0.2, cy - 2.6), (cx + 2.4, cy - 2.6)], K, 1.5)                                    # ponte
    c.stroke([(cx - 10.5, cy - 3), (cx - 8.8, cy - 3)], K, 1.4)                                       # haste
    # sobrancelhas grossas e franzidas (cara de mau)
    c.stroke([(cx - 8.5, cy - 8.4), (cx - 1, cy - 5.8)], K, 2.1)
    c.stroke([(cx + 3, cy - 5.8), (cx + 10.5, cy - 8.8)], K, 2.1)
    # bigode farto
    c.part(c.m_poly([(cx - 3, cy + 6), (cx + 11, cy + 6.2), (cx + 12, cy + 9.5), (cx + 7, cy + 8.6), (cx + 1, cy + 9.6), (cx - 4, cy + 9)]), 'hair')
    c.stroke([(cx + 0.5, cy + 11.2), (cx + 7.5, cy + 11.2)], K, 1.0)                                  # boca severa sob o bigode


def figure(pose):
    c = Canvas()
    p = pose
    ox, oy = p.get('ux', 0), p.get('uy', 0)
    # perna de trás (mais escura) e braço de trás
    leg(c, p['hipB'], p['kneeB'], p['ankB'], -0.28)
    torso(c, ox, oy, p.get('lean', 0))
    arm(c, (18 + ox, 45 + oy), p['elB'], p['fistB'], -0.22)
    # pélvis / calça
    c.part(c.m_poly([(22 + ox, 74 + oy), (44 + ox, 74 + oy), (49 + ox, p['hipF'][1] + 6), (18 + ox, p['hipF'][1] + 6)]), 'uni', outline=False)
    leg(c, p['hipF'], p['kneeF'], p['ankF'], 0.0)
    head(c, p['head'][0] + ox, p['head'][1] + oy)
    arm(c, (44 + ox, 45 + oy), p['elF'], p['fistF'], 0.0, fr=p.get('fr', 6.2))
    return c


def _pose(**kw):
    base = dict(hipB=(26, 80), hipF=(38, 80), head=(36, 22), ux=0, uy=0, lean=0)
    base.update(kw); return base


POSES = {
    'idle0': _pose(kneeB=(19, 99), ankB=(13, 116), kneeF=(46, 99), ankF=(52, 116),
                   elB=(8, 59), fistB=(13, 42), elF=(50, 62), fistF=(58, 48)),
    'idle1': _pose(kneeB=(19, 99), ankB=(13, 116), kneeF=(46, 99), ankF=(52, 116), uy=1,
                   elB=(8, 60), fistB=(13, 43), elF=(50, 63), fistF=(58, 49)),
    'walk0': _pose(kneeB=(20, 99), ankB=(10, 116), kneeF=(47, 99), ankF=(54, 116), ux=2, lean=2,
                   elB=(9, 59), fistB=(14, 42), elF=(51, 62), fistF=(58, 48)),
    'walk1': _pose(kneeB=(29, 96), ankB=(24, 110), kneeF=(40, 99), ankF=(40, 116), uy=1, ux=2, lean=2,
                   elB=(9, 60), fistB=(14, 43), elF=(51, 63), fistF=(58, 49)),
    'walk2': _pose(kneeB=(44, 99), ankB=(50, 116), kneeF=(24, 99), ankF=(14, 116), ux=2, lean=2,
                   elB=(9, 59), fistB=(14, 42), elF=(51, 62), fistF=(58, 48)),
    'walk3': _pose(kneeB=(36, 96), ankB=(40, 110), kneeF=(30, 99), ankF=(27, 116), uy=1, ux=2, lean=2,
                   elB=(9, 60), fistB=(14, 43), elF=(51, 63), fistF=(58, 49)),
    'jump':  _pose(kneeB=(14, 94), ankB=(20, 108), kneeF=(48, 92), ankF=(40, 106), uy=-4,
                   elB=(10, 36), fistB=(16, 22), elF=(54, 36), fistF=(52, 23)),
    'crouch': _pose(hipB=(26, 100), hipF=(38, 100), kneeB=(12, 104), ankB=(12, 118), kneeF=(54, 104), ankF=(52, 118), uy=22, head=(38, 23),
                    elB=(8, 80), fistB=(13, 63), elF=(52, 84), fistF=(59, 70), lean=3),
    'punch': _pose(hipB=(20, 80), hipF=(31, 80), kneeB=(13, 99), ankB=(9, 116), kneeF=(40, 99), ankF=(44, 116), ux=-7, lean=5, head=(39, 22),
                   elB=(5, 60), fistB=(9, 44), elF=(46, 44), fistF=(56, 43), fr=7.4),
}
ORDER = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'jump', 'crouch', 'punch']


def render(name):
    return figure(POSES[name]).result()


if __name__ == '__main__':
    import sys, os
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build'); os.makedirs(out, exist_ok=True)
    names = sys.argv[1:] or ORDER
    sheet = Image.new('RGB', (len(names) * 68 + 4, 132), (70, 84, 120))
    for i, n in enumerate(names):
        a = render(n)
        rgba = np.zeros((FH, FW, 4), np.uint8)
        for j, col in enumerate(PALETTE):
            if col: rgba[a == j] = (*col, 255)
        sheet.paste(Image.fromarray(rgba, 'RGBA'), (4 + i * 68, 2), Image.fromarray(rgba, 'RGBA'))
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    sheet.save(os.path.join(out, 'preview_jarder.png'))
