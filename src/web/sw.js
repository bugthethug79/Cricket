'use strict';

const CACHE = 'cricket';
const SHELL = [
  '/',
  '/j',
  '/assets/style.css',
  '/assets/js/app.js',
  '/assets/js/call.js',
  '/assets/js/chat.js',
  '/assets/js/crypto.js',
  '/assets/js/dom.js',
  '/assets/js/invite.js',
  '/assets/js/landing.js',
  '/assets/js/media.js',
  '/assets/js/rtc.js',
  '/assets/js/socket.js',
  '/assets/js/sound.js',
  '/assets/js/speaking.js',
  '/assets/js/state.js',
  '/assets/js/storage.js',
  '/assets/js/ui.js',
  '/assets/sounds/join.wav',
  '/assets/sounds/leave.wav',
  '/assets/sounds/notify.wav',
  '/manifest.webmanifest',
  '/assets/icons/placeholder-192.png',
  '/assets/icons/placeholder-512.png',
  '/assets/icons/chat.svg',
  '/assets/icons/close.svg',
  '/assets/icons/leave.svg',
  '/assets/icons/link.svg',
  '/assets/icons/mic.svg',
  '/assets/icons/mic-off.svg',
  '/assets/icons/headphones.svg',
  '/assets/icons/headphones-off.svg',
  '/assets/icons/camera-off.svg',
  '/assets/icons/screen.svg',
  '/assets/icons/send.svg',
  '/assets/icons/user.svg',
  '/assets/icons/video.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(url.pathname === '/j' ? '/j' : '/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      }),
    );
  }
});
