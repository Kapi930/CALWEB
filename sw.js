/* Service Worker - cache para funcionamiento offline */
const CACHE = 'calendario-tareas-v1';
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
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.wasm'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(URLS).catch(err => {
      console.log('Cache error:', err);
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
  // Las APIs de Dropbox NO se cachean
  if (e.request.url.includes('dropboxapi.com') ||
      e.request.url.includes('dropbox.com')) {
    return; // Pasa directo a la red
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      // Cachear respuestas exitosas
      if (resp.ok && e.request.method === 'GET') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
