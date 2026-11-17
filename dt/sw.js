// DT conserva solo sus recursos. CALWEB comparte origen, nunca sus cachés.
const CACHE = 'dt-movil-5';
const BASE = new URL('./', self.location.href);
const FILES = ['./','index.html','app.js','style.css','desktop-ui.js','desktop.css','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','manifest.webmanifest?v=dt-5','assets/calendario.png','assets/partes_operarios.png','assets/usuarios.png','assets/necesidades.png','assets/cambios_obra.png','assets/diagnostico.png'];
const PATHS = new Set(FILES.map(file => new URL(file, BASE).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dt-movil-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
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
