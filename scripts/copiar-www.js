// Copia o hub (PWA já construída por build.py) para a pasta www/ que o Capacitor empacota.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', '..', 'dist', 'pwa'), dst = path.join(__dirname, '..', 'www');
const alt = path.join(__dirname, '..', 'pwa'); // quando o projeto é distribuído sozinho
const from = fs.existsSync(src) ? src : alt;
if (!fs.existsSync(from)) { console.error('Não achei a pasta da PWA (dist/pwa ou apk/pwa).'); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(from)) fs.copyFileSync(path.join(from, f), path.join(dst, f));
console.log('www/ atualizado a partir de', from);
