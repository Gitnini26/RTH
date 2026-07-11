// ============================================================
// R.T.H — Service Worker
// Stratégie : cache-first pour le shell de l'app (HTML/CSS/JS/CDN),
// network-first avec fallback cache pour tout le reste.
// Incrémenter CACHE_VERSION à chaque déploiement pour invalider l'ancien cache.
// ============================================================
const CACHE_VERSION = 'rth-cache-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // addAll peut échouer si une seule ressource est indisponible (ex: hors-ligne à l'installation) —
      // on tente donc chaque ressource individuellement pour ne pas bloquer toute l'installation.
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {/* ressource indisponible pour le moment, ignorée */})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // Ne jamais intercepter les appels API (Anthropic, OpenAI, Firestore/Firebase RPC) :
  // ces requêtes doivent échouer proprement hors-ligne plutôt que renvoyer un cache obsolète.
  if (
    url.includes('api.anthropic.com') ||
    url.includes('api.openai.com') ||
    url.includes('firestore.googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('identitytoolkit.googleapis.com') ||
    url.includes('youtube.com/iframe_api') ||
    req.method !== 'GET'
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      // Network-first pour le HTML principal (pour recevoir les mises à jour dès que possible),
      // cache-first pour le reste (CDN, JS externes — changent rarement).
      const isHtml = req.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/');
      if (isHtml) {
        return fetch(req, { cache: 'no-store' })
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
            return res;
          })
          .catch(() => cached || caches.match('./index.html'));
      }
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => cached);
    })
  );
});
