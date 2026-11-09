// Copia a PWA recém-construída para www/, diretório empacotado pelo Capacitor.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const candidates = [
  path.join(root, 'pwa'),             // layout do repositório principal/CI
  path.join(root, 'hub', 'dist', 'pwa'),
  path.join(root, 'dist', 'pwa'),
  path.join(root, 'apk', 'pwa')       // distribuição isolada do APK
];
const from = candidates.find(p => fs.existsSync(path.join(p, 'index.html')));
if (!from) {
  console.error('PWA não encontrada. Gere-a com python3 hub/build.py antes de sincronizar o Capacitor.');
  process.exit(1);
}

const dst = path.join(root, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(from, dst, { recursive: true });
console.log('www/ atualizado a partir de', path.relative(root, from));
