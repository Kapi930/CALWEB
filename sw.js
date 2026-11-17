// CALWEB: solo sus recursos y sus cachés; DT tiene otro servicio y almacenamiento.
const CACHE = 'calendario-tareas-v3';
const BASE = new URL('./', self.location.href);
const FILES = ['./','index.html','styles.css','app2.js','app2.js?v=calweb-3','db.js','dropbox.js','manifest.json','icon-192.png','icon-512.png','sql-wasm.min.js','sql-wasm.wasm'];
const PATHS = new Set(FILES.map(file => new URL(file, BASE).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('calendario-tareas-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque' && !response.redirected) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate' && (url.pathname === BASE.pathname || url.pathname === new URL('index.html', BASE).pathname)) {
        const page = await cache.match(new URL('index.html', BASE).href);
        if (page) return page;
      }
      throw error;
    }
  })());
});
