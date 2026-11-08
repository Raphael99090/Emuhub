// Roda jarder.sfc no núcleo SNES do Emu Hub, aperta botões e confere o resultado (e salva prints em build/shots/)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const hub = path.join(__dirname, '..', '..', 'hub', 'src', 'cores');
const files = ['shared/state', 'snes/cpu', 'snes/spc', 'snes/gsu', 'snes/sa1', 'snes/ppu', 'snes/snes', 'snes/core'].map(f => fs.readFileSync(path.join(hub, f + '.js'), 'utf8'));
const { SNESCore } = new Function('module', files.join('\n') + '\nreturn {SNESCore};')({});
const BTN = { A: 1, B: 2, SEL: 4, START: 8, UP: 16, DOWN: 32, LEFT: 64, RIGHT: 128, X: 256, Y: 512 };
const c = new SNESCore(); c.load(new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'jarder.sfc'))));
const out = path.join(__dirname, '..', 'build', 'shots'); fs.mkdirSync(out, { recursive: true });
function png(name) {
  const w = c.width, h = c.height, f = c.frame, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const p = f[y * w + x], o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = p & 255; raw[o + 1] = (p >> 8) & 255; raw[o + 2] = (p >> 16) & 255; raw[o + 3] = 255; } }
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const ch = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), l = Buffer.alloc(4), r = Buffer.alloc(4); l.writeUInt32BE(d.length); r.writeUInt32BE(crc(b)); return Buffer.concat([l, b, r]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
}
// posição do personagem: caixa dos pixels vermelhos da faixa (r alto, g e b baixos)
function sash() {
  const w = c.width, h = c.height, f = c.frame; let x0 = 999, x1 = -1, y0 = 999, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = f[y * w + x], r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255; if (r > 180 && g < 70 && b < 70) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  return x1 < 0 ? null : { x: (x0 + x1) / 2, y0, y1 };
}
function run(n, buttons) { c.setButtons(buttons || 0); for (let i = 0; i < n; i++) c.runFrame(); }
let fails = 0; const ok = (cond, msg) => { console.log(cond ? 'ok:' : 'FALHOU:', msg); if (!cond) fails++; };
run(30); png('1-parado'); const p0 = sash(); ok(!!p0, 'o Jarder aparece na tela (faixa vermelha encontrada)');
run(30, BTN.RIGHT); png('2-andando-direita'); const p1 = sash(); ok(p1 && p1.x > p0.x + 40, 'anda para a direita (x ' + (p0 && p0.x) + ' -> ' + (p1 && p1.x) + ')');
run(60, BTN.LEFT); const p2 = sash(); ok(p2 && p2.x < p1.x - 40, 'anda para a esquerda (x -> ' + (p2 && p2.x) + ')'); png('3-andando-esquerda');
run(200, BTN.LEFT); const p3 = sash(); ok(p3 && p3.x >= 24 - 12, 'para na borda esquerda (x ' + (p3 && p3.x) + ')');
run(5); run(1, BTN.UP); let minY = 999; for (let i = 0; i < 40; i++) { run(1, i < 1 ? BTN.UP : 0); const s = sash(); if (s) minY = Math.min(minY, s.y0); if (i === 16) png('4-pulo'); }
const ground = (() => { run(20); return sash().y0; })(); ok(minY < ground - 40, 'pula ao menos 40 px (topo ' + minY + ' vs chão ' + ground + ')'); ok(sash().y0 === ground, 'volta ao chão');
run(10, BTN.DOWN); png('5-agachado'); const pc = sash(); ok(pc && pc.y0 > ground + 8, 'agachado fica mais baixo (' + (pc && pc.y0) + ' vs ' + ground + ')');
run(10); run(5, BTN.Y); png('6-soco');
run(40); const pe = sash(); ok(pe && pe.y0 === ground, 'volta ao normal depois do soco');
c.setButtons(0); for (let i = 0; i < 300; i++) c.runFrame(); ok(!!sash(), 'estável depois de 300 quadros');
console.log(fails ? fails + ' falha(s)' : 'TUDO OK (jarder)'); process.exit(fails ? 1 : 0);
