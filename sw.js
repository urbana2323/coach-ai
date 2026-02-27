const CACHE_NAME = 'coach-v1';
const ASSETS = [
  '/',
  '/index.html',
  // Добавь сюда пути к своим стилям или картинкам, если они в отдельных файлах
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});