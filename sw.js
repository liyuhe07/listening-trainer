/* Offline support: the app shell is served from the cache when the network is unavailable.
   Pages and scripts are fetched from the network first (so updates show up at once); the runtime and model
   files never change for a given path, so they are served from the cache first. */
const SHELL = 'lt-shell-v2', STATIC = 'lt-static-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'app/styles.css', 'app/library.css', 'app/core.js', 'app/db.js', 'app/transcript.js', 'app/blanks.js', 'app/ai.js', 'app/pack.js', 'app/section.js', 'app/itn.js', 'app/proofread.js', 'app/app.js', 'app/library.js',
  'app/align/worker.js', 'app/align/fbank.js', 'app/align/text.js', 'app/align/ctc.js', 'app/align/engine.js', 'app/align/transcribe.js', 'app/align/speakers.js', 'data/wordlist.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lt-') && ![SHELL, STATIC, 'lt-model-v1'].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/(vendor|models)\//.test(url.pathname)) {
    e.respondWith(caches.open(STATIC).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok && r.status === 200) c.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
