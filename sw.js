/* Firebase Cloud Messaging: รองรับแจ้งเตือนเบื้องหลังบน PWA */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyDSmg6A9G6NG-9hFnV2EcEjdmMgSOZqFUw",
  authDomain: "longdo-pos-notifications.firebaseapp.com",
  projectId: "longdo-pos-notifications",
  storageBucket: "longdo-pos-notifications.firebasestorage.app",
  messagingSenderId: "110373918366",
  appId: "1:110373918366:web:13ca8412a1501484f98d8f"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const d = payload.data || {};
  self.registration.showNotification(n.title || "Long Do Bar", {
    body: n.body || "มีออเดอร์ใหม่เข้ามา",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "longdo-order-" + (d.order_id || Date.now()),
    data: d
  });
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL("bar.html", self.location).href;
  event.waitUntil(self.clients.matchAll({type:"window", includeUncontrolled:true}).then(list => {
    for (const client of list) if ("focus" in client) return client.focus();
    return self.clients.openWindow(target);
  }));
});

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
