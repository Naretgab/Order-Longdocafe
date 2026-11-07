// Service worker ขั้นต่ำสำหรับหลังบาร์: ทำให้ติดตั้งเป็นแอปได้ และเปิดหน้าได้แม้เน็ตหลุดชั่วคราว
// ข้อมูลออเดอร์ดึงสดจาก Supabase เสมอ ไม่ถูกแคช
const CACHE = "longdo-bar-v1";
const SHELL = ["bar.html", "icon-192.png", "icon-512.png", "bar.webmanifest"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(ks=> Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e=>{
  const req = e.request;
  if(req.method !== "GET" || new URL(req.url).origin !== location.origin) return; // Supabase/CDN ผ่านตรง
  e.respondWith(
    fetch(req).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=> c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(()=> caches.match(req).then(r=> r || caches.match("bar.html")))
  );
});
