-- ============================================================
-- แอป Android (APK): เก็บ token แจ้งเตือน FCM ของเครื่องพนักงาน
-- รันใน Supabase SQL Editor ของโปรเจกต์ Order ครั้งเดียว (รันซ้ำได้)
-- ============================================================
create table if not exists public.staff_devices (
  token      text primary key,
  user_id    uuid not null default auth.uid(),
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);
alter table public.staff_devices enable row level security;

drop policy if exists "staff manage own devices" on public.staff_devices;
create policy "staff manage own devices" on public.staff_devices
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Edge Function อ่านด้วย service role (ข้าม RLS) จึงไม่ต้องมี policy เพิ่ม

-- ล้าง token ที่ไม่ได้อัปเดตเกิน 90 วัน (เครื่องที่เลิกใช้)
create or replace function public.purge_stale_staff_devices() returns void
language sql security definer set search_path = public as
$$ delete from public.staff_devices where updated_at < now() - interval '90 days' $$;
