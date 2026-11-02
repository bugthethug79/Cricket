'use strict';

const VERSION = 'cricket-0.1.0-2';
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
  '/assets/icons/chat.svg',
  '/assets/icons/close.svg',
  '/assets/icons/leave.svg',
  '/assets/icons/link.svg',
  '/assets/icons/mic.svg',
  '/assets/icons/mic-off.svg',
  '/assets/icons/camera-off.svg',
  '/assets/icons/screen.svg',
  '/assets/icons/send.svg',
  '/assets/icons/user.svg',
  '/assets/icons/video.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
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
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
