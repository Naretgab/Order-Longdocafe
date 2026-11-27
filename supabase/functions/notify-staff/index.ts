// Edge Function (เรียกจาก database trigger เมื่อมีออเดอร์ใหม่):
//  1) ส่งสรุปออเดอร์ + ข้อความรับออเดอร์กลับไปหาลูกค้าทาง LINE (ถ้ามี line_user_id)
//  2) ส่งแจ้งเตือนหาพนักงานทุกคนที่ลงทะเบียนไว้
// Secrets: LINE_CHANNEL_ACCESS_TOKEN, WEBHOOK_SECRET  (ปิด Verify JWT ของฟังก์ชันนี้)
import { createClient } from "npm:@supabase/supabase-js@2";

type Item = { qty: number; name: string; opts?: string[]; note?: string };
const LINE = "https://api.line.me/v2/bot/message";
const token = () => `Bearer ${Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")}`;

async function line(path: string, body: unknown) {
  const r = await fetch(`${LINE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token() },
    body: JSON.stringify(body),
  });
  return r.ok ? "ok" : `line ${path} error ${r.status} ${await r.text()}`;
}

/* ---------- FCM (HTTP v1) สำหรับแอป Android ----------
   Secret: FCM_SERVICE_ACCOUNT = เนื้อไฟล์ JSON ของ service account (Firebase → Project settings → Service accounts) */
const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = ""; bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function fcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  if (!r.ok) throw new Error("fcm oauth " + r.status + " " + await r.text());
  return (await r.json()).access_token;
}
// ส่งไปทุกเครื่องที่ลงทะเบียน; ลบ token ที่ใช้ไม่ได้แล้ว; คืนข้อความผลลัพธ์
async function sendFcm(admin: ReturnType<typeof createClient>, title: string, body: string, orderId: string): Promise<string> {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return "fcm:skip(no secret)";
  const { data: devs } = await admin.from("staff_devices").select("token");
  const tokens = (devs ?? []).map((d: { token: string }) => d.token);
  if (!tokens.length) return "fcm:skip(no devices)";
  const sa = JSON.parse(raw);
  const access = await fcmAccessToken(sa);
  let ok = 0; const dead: string[] = [];
  await Promise.all(tokens.map(async (t: string) => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
      body: JSON.stringify({ message: {
        token: t, notification: { title, body }, data: { order_id: String(orderId) },
        android: { priority: "HIGH", ttl: "300s", notification: { channel_id: "orders", sound: "alert", default_vibrate_timings: true } },
      } }),
    });
    if (r.ok) ok++; else if (r.status === 404 || r.status === 400) { const t2 = await r.text(); if (/UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND/.test(t2)) dead.push(t); }
  }));
  if (dead.length) await admin.from("staff_devices").delete().in("token", dead);
  return `fcm:${ok}/${tokens.length}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const { record: o } = await req.json();
    if (!o || o.status !== "new") return new Response("skip");
    const items: Item[] = Array.isArray(o.items) ? o.items : [];
    const results: string[] = [];

    // 1) ตอบกลับลูกค้า
    if (o.line_user_id) {
      const detail: string[] = [];
      items.forEach((i, idx) => {
        detail.push(`${idx + 1}. ${i.name} x${i.qty}`);
        (i.opts ?? []).forEach((x) => detail.push(`- ${x}`));
        if (i.note) detail.push(`   📝 ${i.note}`);
        detail.push("");
      });
      const text = [
        "📋 สรุปออเดอร์ของท่าน — Long Do Cafe & Bakery",
        `ลูกค้า: ${o.customer_name}`,
        `ประเภท: ${o.order_type}`,
        `เวลาจัดส่ง/รับ: ${o.time_text}`,
        ...(o.address ? [`ที่อยู่จัดส่ง: ${o.address}`] : []),
        "",
        ...detail,
        ...(o.note ? [`เบอร์โทร/หมายเหตุ: ${o.note}`, ""] : []),
        "ร้านได้รับออเดอร์ของท่านแล้ว รอสักครู่นะครับ เราจะทำบิลสรุปค่าใช้จ่ายให้ท่านอีกครั้ง",
      ].join("\n").trim();
      results.push("customer:" + await line("push", { to: o.line_user_id, messages: [{ type: "text", text }] }));
    }

    // 2) แจ้งเตือนพนักงาน
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    try {
      const fl = items.slice(0, 3).map((i) => `${i.name} x${i.qty}`).join(", ") + (items.length > 3 ? ` +${items.length - 3}` : "");
      const f = await sendFcm(admin, `🔔 ออเดอร์ใหม่ #${o.order_no}`, `${o.customer_name} · ${fl} · ฿${o.total}`, o.id);
      if (!f.startsWith("fcm:skip")) console.log(f);
    } catch (e) { console.error("fcm error", String(e)); }
    const { data: staff } = await admin.from("staff_line").select("user_id");
    const ids = (staff ?? []).map((s: { user_id: string }) => s.user_id);
    if (ids.length) {
      const lines = items.slice(0, 8).map((i) => `• ${i.name} x${i.qty}`);
      if (items.length > 8) lines.push(`…และอีก ${items.length - 8} รายการ`);
      const text = [
        `🔔 ออเดอร์ใหม่ #${o.order_no}`,
        `${o.customer_name} · ${o.order_type} · ${o.time_text}`,
        ...lines,
        `รวม ฿${o.total}`,
        `เปิดแอปหลังบาร์เพื่อรับออเดอร์`,
      ].join("\n");
      results.push("staff:" + await line("multicast", { to: ids.slice(0, 500), messages: [{ type: "text", text }] }));
    }
    const failed = results.some((x) => !x.endsWith(":ok"));
    return new Response(results.join(" | ") || "nothing to send", { status: failed ? 502 : 200 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
