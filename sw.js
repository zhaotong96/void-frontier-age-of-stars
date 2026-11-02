/**
 * sw.js — VOID FRONTIER 同源静态缓存 Service Worker
 *
 * 策略：
 * - install：逐个预缓存应用外壳资源（Promise.allSettled，单个失败不阻塞安装）。
 * - fetch：仅拦截同源 GET 请求；缓存优先，未命中回源并在成功后回填缓存；
 *   离线时页面导航回退到应用外壳。
 * - activate：清理全部旧版本缓存，并立即接管已打开页面。
 * - message：收到 { type: 'SKIP_WAITING' } 时 self.skipWaiting()。
 *
 * 注意：全部使用相对路径（基于 SW 所在目录解析），兼容二级路径部署；
 * 顶层不依赖 importScripts。
 */

const CACHE_NAME = 'void-frontier-v1';

/** 预缓存清单：应用外壳（全部相对路径） */
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 逐个缓存：任一资源拉取失败仅该资源放弃，不阻塞 install
    await Promise.allSettled(PRECACHE_URLS.map(async (url) => {
      const res = await fetch(url, { cache: 'reload' });
      if (!res || !res.ok) {
        throw new Error(`[sw] 预缓存失败：${url}（HTTP ${res ? res.status : 'no response'}）`);
      }
      await cache.put(url, res);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 仅处理同源请求
  if (!url.protocol.startsWith('http')) return; // 排除 blob: / data: 等异常协议
  if (req.headers.has('range')) return; // 分段请求直连网络，避免污染缓存

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok) {
        // 回填缓存：put 会消费响应流，必须先 clone
        await cache.put(url.href, res.clone());
      }
      return res;
    } catch (err) {
      // 离线兜底：页面导航请求回退到应用外壳
      if (req.mode === 'navigate') {
        const shell = (await cache.match('./')) || (await cache.match('./index.html'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
