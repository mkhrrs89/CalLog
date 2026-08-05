const CACHE = 'foodlog-v6';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './entry-serving-editor.js',
  './entry-serving-editor-core.js',
  './food-library-filters.js',
  './export-filename-time.js',
  './default-meal-tag-logging-fix.js',
  './remove-pinned-add-sheet.js',
  './mobile-food-filter-collapse.js',
  './fun-animations.js',
  './fun-animations.css',
  './saved-food-default-tag-authority.js',
  './foods-compact-typography.js',
  './foods-compact-typography.css',
  './log-entry-name-wrap.css',
  './meal-tag-totals.js',
  './swipe-delete.js',
  './swipe-delete.css',
  './recipe-builder.js',
  './recipe-builder.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url))))
  );
});

const withFoodLibraryFilters = async response => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('food-library-filters.js')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const enhanced = html.replace(
    '<script src="./entry-serving-editor.js"></script>',
    '<script src="./entry-serving-editor.js"></script><script src="./food-library-filters.js"></script>'
  );
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers: response.headers });
};

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(async response => {
        const served = event.request.mode === 'navigate' ? await withFoodLibraryFilters(response) : response;
        const copy = served.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return served;
      })
      .catch(() => caches.match(event.request).then(async cached => {
        if (cached) return event.request.mode === 'navigate' ? withFoodLibraryFilters(cached) : cached;
        const fallback = await caches.match('./index.html');
        return fallback ? withFoodLibraryFilters(fallback) : fallback;
      }))
  );
});
