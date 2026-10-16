const CACHE = 'foodlog-v61';
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
  './fun-animations-extra.js',
  './fun-animations-extra.css',
  './calorie-placeholders.js',
  './calorie-placeholders.css',
  './multi-entry-copy.js',
  './multi-entry-copy.css',
  './desktop-fab-ripple-fix.css',
  './desktop-add-sheet-scroll-fix.css',
  './mobile-add-food-fullscreen.css',
  './mobile-layout-guard.js',
  './mobile-layout-guard.css',
  './manual-entry-recent-added.css',
  './fab-context-glow.js',
  './fab-context-glow.css',
  './new-food-modal-scroll-reset.js',
  './food-search-reset-on-leave.js',
  './food-source-controls.js',
  './quick-log-remove.js',
  './add-food-recent-collapse.js',
  './add-food-recent-collapse.css',
  './manual-entry-search-separation.js',
  './saved-food-defaults-hardening.js',
  './saved-food-default-tag-authority.js',
  './foods-compact-typography.js',
  './foods-compact-typography.css',
  './log-entry-name-wrap.css',
  './meal-tag-totals.js',
  './swipe-delete.js',
  './swipe-delete.css',
  './meal-tag-drag.js',
  './meal-tag-drag.css',
  './recipe-builder.js',
  './recipe-builder.css',
  './recipe-builder-search.js',
  './recipe-builder-search.css',
  './recipe-entry-instance.js',
  './recipe-entry-instance.css',
  './recipe-decimal-amounts.js',
  './completed-days-chart.js',
  './calorie-target-chart.js',
  './calorie-target-chart.css',
  './serving-label.js',
  './food-metadata-carryover-fix.js',
  './food-spreadsheet-import.js',
  './copy-entry-to-date.js',
  './serving-multiplier-two-decimals.js',
  './food-default-confidence.js',
  './quick-log-serving.js',
  './default-meal-tag-authority-v2.js',
  './desktop-modal-backdrop-origin-fix.js',
  './over-goal-progress.js',
  './over-goal-progress.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './apple-touch-icon-180.png',
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

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  const updateCache = async () => {
    const response = await fetch(event.request);
    if (!response || !response.ok) return response;
    const served = event.request.mode === 'navigate'
      ? await withFoodLibraryFilters(response)
      : response;
    const cache = await caches.open(CACHE);
    await cache.put(event.request, served.clone());
    return served;
  };

  const cachedResponse = async () => {
    const cache = await caches.open(CACHE);
    let cached = await cache.match(event.request);
    if (event.request.mode === 'navigate' && !cached) {
      cached = await cache.match('./index.html');
    }
    return { cache, cached };
  };

  event.respondWith((async () => {
    const { cache, cached } = await cachedResponse();
    if (cached) {
      return event.request.mode === 'navigate'
        ? withFoodLibraryFilters(cached)
        : cached;
    }

    try {
      return await updateCache();
    } catch {
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        return fallback ? withFoodLibraryFilters(fallback) : Response.error();
      }
      return Response.error();
    }
  })());

  // Once an asset is cached, don't make startup wait for GitHub Pages.
  // Refresh the cached copy in the background instead.
  event.waitUntil((async () => {
    const { cached } = await cachedResponse();
    if (cached) await updateCache();
  })().catch(() => {}));
});
