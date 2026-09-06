// RankUp — Service Worker
// Cachea lo esencial para que la app instale bien como PWA y cargue más
// rápido en visitas repetidas. No intenta cachear llamadas a Firebase.
//
// v2: antes servíamos TODO (incluido el index.html) con estrategia
// "caché primero, red en segundo plano" — eso significaba que, al
// desplegar una versión nueva, el navegador seguía viendo el index.html
// viejo (que apunta al JS compilado viejo) hasta que alguien vaciaba la
// caché a mano. Con muchas pestañas/PWA sin cerrar nunca (típico en
// móvil), eso podía tardar días en autocorregirse.
//
// Ahora:
//  - El HTML (navegación / "/") siempre se pide primero a la red. Si no
//    hay conexión, se usa la copia en caché como último recurso.
//  - Los archivos estáticos con hash en el nombre (los .js/.css que genera
//    Vite en /assets/, que cambian de nombre en cada build) sí se sirven
//    caché-primero: es seguro, porque un build nuevo nunca reutiliza el
//    mismo nombre de archivo, así que nunca hay "versión vieja" que servir
//    por error.
//  - Subir CACHE_NAME fuerza a borrar cualquier caché de una versión
//    anterior del propio Service Worker.
const CACHE_NAME = "rankup-shell-v2";
const SHELL_FILES = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

// Permite que la pestaña abierta le pida al SW nuevo que tome el control
// ya mismo (ver index.html) — skipWaiting() en "install" ya lo hace solo,
// esto es un respaldo por si algún navegador retrasa esa llamada.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Un archivo estático "seguro para cachear agresivo" es uno con un hash de
// contenido en el nombre (p.ej. /assets/index-CxsoNnrR.js) — Vite genera
// nombres así para todo lo que compila. El index.html y otras rutas de
// navegación NO llevan hash, así que nunca deben servirse caché-primero.
const isHashedAsset = (url) =>
  /\/assets\/.+-[a-zA-Z0-9_-]{6,}\.(js|css|woff2?|png|jpg|svg|gif)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nunca tocar Firebase ni peticiones a otros orígenes, ni nada que no sea GET.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Peticiones de navegación (cargar la página / index.html): red primero,
  // caché solo como último recurso sin conexión. Así nunca se sirve una
  // versión vieja de la app mientras haya internet.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Assets con hash en el nombre: caché primero (rápido), red de refresco
  // en segundo plano por si acaso, pero nunca bloquea ni sirve algo viejo
  // bajo un nombre nuevo — el hash ya garantiza que "nuevo nombre = nuevo
  // contenido".
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Todo lo demás (manifest, iconos, GIFs de ejercicios, etc.): red
  // primero, caché como respaldo — evita servir recursos desactualizados
  // sin perder la ventaja de funcionar offline si falla la red.
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});
