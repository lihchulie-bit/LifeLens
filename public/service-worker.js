"use strict";

const CACHE_NAME = "lifelens-cache-v53-study-insights-taskid-duration";
const OFFLINE_URL = "./offline.html";

const CORE_FILES = [
  "./", "./index.html", "./login.html", "./planner.html", "./dashboard.html", "./insights.html",
  "./offline.html", "./style.css", "./landing.css", "./dashboard-charts.css", "./insights.css",
  "./pwa-ui.css", "./manifest.json", "./js/main.js", "./js/auth.js",
  "./js/firebase.js", "./js/planner.js", "./js/analysis.js", "./js/assistant.js",
  "./js/focus.js", "./js/learning.js", "./js/dashboard.js", "./js/parser.js",
  "./js/storage.js", "./js/utils.js", "./js/landing.js", "./js/pwa.js", "./js/insights.js",
  "./assets/logo.png", "./assets/icon-192.png", "./assets/icon-512.png",
  "./assets/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE_FILES.map((file) => cache.add(file)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await caches.match(event.request)) || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  const isCode = ["script", "style", "worker"].includes(event.request.destination);
  if (isCode) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(event.request)) || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return new Response("Offline", { status: 503 });
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients.length) return clients[0].focus();
    return self.clients.openWindow?.("./planner.html");
  })());
});

// mobile-navbar-dark-fix-v1
