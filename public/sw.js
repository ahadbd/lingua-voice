const CACHE_NAME = 'linguavoice-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/src/main.js',
    '/src/style.css',
    '/vite.svg'
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
