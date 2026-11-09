// Copia a PWA gerada neste build; o Capacitor deve receber os binários WASM do NES.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const candidates = [
  path.join(root, 'hub', 'dist', 'pwa'), // saída atual de hub/build.py
  path.join(root, 'pwa'),               // layout legado do projeto
  path.join(root, 'dist', 'pwa'),
  path.join(root, 'apk', 'pwa')
];
const from = candidates.find(p => fs.existsSync(path.join(p, 'index.html')));
if (!from) {
  console.error('PWA não encontrada. Gere-a com python3 hub/build.py antes de sincronizar o Capacitor.');
  process.exit(1);
}
for (const name of ['emuhub-core.js', 'emuhub-core.wasm']) {
  const asset = path.join(from, name);
  if (!fs.existsSync(asset) || fs.statSync(asset).size === 0) {
    console.error('Binário obrigatório do NES ausente na PWA: ' + asset);
    process.exit(1);
  }
}

const dst = path.join(root, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(from, dst, { recursive: true });
for (const name of ['emuhub-core.js', 'emuhub-core.wasm']) {
  const copied = path.join(dst, name);
  if (!fs.existsSync(copied) || fs.statSync(copied).size === 0) {
    throw new Error('Falha ao copiar asset WASM para o Capacitor: ' + name);
  }
}
console.log('www/ atualizado a partir de', path.relative(root, from), 'com os binários NES WASM.');
