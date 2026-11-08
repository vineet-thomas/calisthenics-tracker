// Service worker — lets the app open with no signal. NETWORK-FIRST, never cache-first:
// online, every load fetches the latest files (revalidated, so a release shows immediately);
// the saved copy is only used when the network fails or takes longer than NET_TIMEOUT_MS.
// Supabase API calls are never touched. See CLAUDE.md before changing this file.

const CACHE = "ct-shell-v1";            // bump only if the SHELL/CDN lists change
const NET_TIMEOUT_MS = 4000;
const SHELL = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const CDN = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
];
const SCOPE = new URL(self.registration.scope);
const INDEX = SCOPE.href;               // every page navigation inside the app maps to the app page

self.addEventListener("install", e=>{
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u=>new Request(new URL(u, SCOPE).href, { cache:"no-cache" })));
    await Promise.all(CDN.map(async u=>{
      try{ const r = await fetch(u, { mode:"cors", cache:"no-cache" }); if(r.ok) await cache.put(u, r); }catch(_){}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()) if(k!==CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method!=="GET") return;
  const url = new URL(req.url);
  const bare = url.origin + url.pathname;
  let key;
  if(url.origin===SCOPE.origin && url.pathname.startsWith(SCOPE.pathname)){
    key = req.mode==="navigate" ? INDEX : bare;
  } else if(CDN.includes(bare)){
    key = bare;
  } else {
    return;                             // Supabase, OCR data and everything else go straight to the network
  }
  e.respondWith(networkFirst(req, key, url.origin===SCOPE.origin));
});

async function networkFirst(req, key, sameOrigin){
  const cache = await caches.open(CACHE);
  const net = fetch(sameOrigin ? new Request(req.url, { cache:"no-cache", credentials:"same-origin" })
                               : new Request(req.url, { mode:"cors", cache:"no-cache" }))
    .then(res=>{ if(res.ok) cache.put(key, res.clone()); return res; });
  net.catch(()=>{});                    // if the saved copy is served, a late network failure is fine
  const timeout = new Promise(r=>setTimeout(()=>r("timeout"), NET_TIMEOUT_MS));
  try{
    const first = await Promise.race([net, timeout]);
    if(first!=="timeout") return first;
    const saved = await cache.match(key);
    return saved || await net;          // slow network and nothing saved: keep waiting
  }catch(err){
    const saved = await cache.match(key);
    if(saved) return saved;
    throw err;
  }
}
