const CACHE='alphapilot-v12-3-0-pwa';
const APP_SHELL=['./','./index.html','./style.css?v=12.3.0','./app.js?v=12.3.0','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./offline.html','./alphapilot-brand.png','./alphapilot-total-assets.png','./alphapilot-history.png','./alphapilot-rebalance.png','./alphapilot-beta.png','./alphapilot-backup.png','./alphapilot-settings.png','./nav-dashboard.png','./nav-portfolio.png','./nav-allocation.png','./nav-rebalance.png','./nav-risk.png','./nav-history.png','./nav-expenses.png','./nav-settings.png','./nav-backup.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL))));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put('./index.html',copy));return response}).catch(async()=>await caches.match('./index.html')||await caches.match('./offline.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok&&url.origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response})));
});