// Service worker do Emu Hub: guarda o app para abrir offline. VERSAO muda a cada build.
const VERSAO = '325fbfb3e7';
const ARQ = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQ)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // capas e listas externas passam direto
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
