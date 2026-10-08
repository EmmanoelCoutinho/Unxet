// Service worker do Unxet.
// Estratégia conservadora: só faz cache do shell (index.html) e dos assets
// com hash do Vite. Chamadas ao Supabase e outras origens nunca passam por aqui.

const CACHE = "unxet-v1";
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Guarda o index.html novo e remove assets de deploys antigos que ele
// não referencia mais, para o cache não crescer a cada deploy.
async function updateShell(response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(SHELL, response);
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    // Só JS/CSS: imagens são referenciadas pelo bundle, não pelo HTML.
    if (/^\/assets\/.*\.(js|css)$/.test(pathname) && !html.includes(pathname)) {
      await cache.delete(request);
    }
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro (sempre a versão mais nova), cache só se offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) event.waitUntil(updateShell(response.clone()));
          return response;
        })
        .catch(() => caches.match(SHELL))
    );
    return;
  }

  // Assets do build têm hash no nome, então são imutáveis: cache primeiro.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
