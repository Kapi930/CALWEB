/* Service Worker - caché para funcionamiento fuera de línea */
const CACHE = 'calendario-tareas-v2';
const URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './dropbox.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './sql-wasm.min.js',
  './sql-wasm.wasm'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS).catch(err => {
      console.log('Error de caché:', err);
    }))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Las API de Dropbox NO se cachean — van directo a la red
  if (e.request.url.includes('dropboxapi.com') ||
      e.request.url.includes('dropbox.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      // Guardar en caché las respuestas exitosas
      if (resp.ok && e.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
