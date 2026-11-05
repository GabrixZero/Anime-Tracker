// ShowVault · service worker (S18, modo offline). Regras:
//  1) App (HTML/CSS/JS/imagens do próprio site): REDE PRIMEIRO. Com internet, sempre vem a versão nova (e é guardada);
//     sem internet, usa a última guardada. Assim nunca se mistura arquivo velho com novo quando há rede.
//  2) Catálogo público (/api/media/trending|batch|search|<id>): também rede primeiro, com cópia para consulta offline.
//     É igual para todo mundo, então não vaza nada entre contas.
//  3) NADA mais da API é interceptado: /api/auth e /api/user (contas, biblioteca) vão sempre direto à rede e NUNCA são guardados.
//     A biblioteca do usuário mora no aparelho (localStorage) e sincroniza sozinha quando a internet volta (syncService).
//  4) Atualização: mude SW_VERSION a cada release que altere este arquivo. O navegador troca o worker sozinho
//     (skipWaiting + clients.claim) e apaga os caches das versões antigas no "activate".
'use strict';

const SW_VERSION = 's18-1';
const SHELL_CACHE = `showvault-shell-${SW_VERSION}`;
const DATA_CACHE = `showvault-data-${SW_VERSION}`;
const DATA_MAX_ENTRIES = 150;

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/img/poster-placeholder.svg',
  '/img/still-placeholder.svg',
  '/img/icons/icon-192.png'
];
const PUBLIC_MEDIA = /^\/api\/media\/(trending|batch|search|\d+)$/;

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(SHELL.map(url => cache.add(url).catch(() => {}))); // um arquivo que falhe não impede a instalação
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith('showvault-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - DATA_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === 'basic') {
      cache
        .put(request, response.clone())
        .then(() => (cacheName === DATA_CACHE ? trim(cache) : null))
        .catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (fallbackUrl ? await cache.match(fallbackUrl) : null);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fontes e imagens de terceiros: o navegador cuida
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    if (PUBLIC_MEDIA.test(url.pathname)) event.respondWith(networkFirst(request, DATA_CACHE));
    return; // contas e biblioteca: direto à rede, sem cache
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/index.html'));
    return;
  }
  event.respondWith(networkFirst(request, SHELL_CACHE));
});
