// Service Worker：应用壳预缓存（离线可用）、静态资源 stale-while-revalidate、
// Tesseract CDN 运行时缓存、通知点击跳转对应页面

const CACHE = 'ds-v1';

// 应用壳：核心文件（其余同源 GET 资源运行时缓存）
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/main.js',
  './js/util.js',
  './js/settings.js',
  './js/db.js',
  './js/model.js',
  './js/parser.js',
  './js/data.js',
  './js/ui.js',
  './js/ocr.js',
  './js/ai.js',
  './js/speech.js',
  './js/reminders.js',
  './js/summarize.js',
  './js/review.js',
  './js/views/today.js',
  './js/views/schedule.js',
  './js/views/notes.js',
  './js/views/summary.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 导航请求：网络优先，离线回退到缓存的 index.html
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // 同源与 CDN 静态资源：stale-while-revalidate
  if (url.origin === location.origin || /cdn\.jsdelivr\.net|unpkg\.com|tessdata/.test(url.hostname)) {
    ev.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fresh = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await fresh) || Response.error();
    })());
  }
});

// 通知点击：聚焦/打开应用并跳转对应 Tab
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const tab = (ev.notification.data && ev.notification.data.tab) || 'today';
  ev.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ tab });
        return;
      }
    }
    await self.clients.openWindow('./index.html#/' + tab);
  })());
});
