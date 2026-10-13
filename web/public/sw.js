// GrowJin service worker. Its only jobs: make the app installable, and show a friendly page instead
// of the browser's error when a page is opened with no connection. Nothing else is cached, so every
// deploy is picked up straight away.

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline – GrowJin</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;color:#151816;
font:15px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:19px;margin:16px 0 6px}p{margin:0 0 20px;color:#555b57}
button{height:40px;padding:0 18px;border:0;border-radius:9px;background:#12A664;color:#fff;font:inherit;font-weight:600}</style>
</head><body><div><svg width="56" height="56" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="6" fill="#12A664"/><path d="M6 17.5 L10.5 12 L14 15 L20 7.5" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/><circle cx="20" cy="7.5" r="2.4" fill="#FF6A50"/></svg>
<h1>You're offline</h1><p>GrowJin needs a connection. Check your internet and try again.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    ),
  )
})
