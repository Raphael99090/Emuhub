// uso: node tools/snes-shot.js rom.sfc saida.png [quadros]
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const files = ['shared/state', 'snes/cpu', 'snes/spc', 'snes/gsu', 'snes/ppu', 'snes/snes', 'snes/core'].map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'cores', f + '.js'), 'utf8'));
const { SNESCore } = new Function('module', files.join('\n') + '\nreturn {SNESCore};')({});
const [, , rom, out, n] = process.argv; const c = new SNESCore(); c.load(new Uint8Array(fs.readFileSync(rom)));
const t0 = Date.now(); for (let i = 0; i < (+n || 300); i++) c.runFrame();
const w = c.width, h = c.height, f = c.frame; console.log(w + 'x' + h, ((Date.now() - t0) / (+n || 300)).toFixed(2) + ' ms/frame');
const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const p = f[y * w + x], o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = p & 255; raw[o + 1] = (p >> 8) & 255; raw[o + 2] = (p >> 16) & 255; raw[o + 3] = 255; } }
const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
const ch = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]), l = Buffer.alloc(4), r = Buffer.alloc(4); l.writeUInt32BE(d.length); r.writeUInt32BE(crc(b)); return Buffer.concat([l, b, r]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]));
