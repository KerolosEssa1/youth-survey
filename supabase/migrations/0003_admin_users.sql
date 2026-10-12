-- =====================================================================
-- 0003 — admin_users + دالة is_admin()
-- =====================================================================
-- جدول صلاحيات المسؤولين. هو "مصدر الحقيقة" الوحيد لتحديد المسؤول.
-- لا يُمنح أي دور واجهة (anon/authenticated) صلاحية INSERT/UPDATE/DELETE
-- عليه إطلاقًا؛ لذا لا يمكن لأي زائر ترقية نفسه إلى مسؤول.
-- =====================================================================

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  is_active  boolean not null default true,
  is_owner   boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  note       text check (note is null or char_length(note) <= 500)
);

comment on table public.admin_users is
  'قائمة المسؤولين المصرّح لهم. لا تُدار إلا عبر المالك/service_role (SQL Editor أو Edge Function).';

create index if not exists admin_users_active_idx on public.admin_users (is_active);

-- ---------------------------------------------------------------------
-- is_admin(): تُستخدم داخل سياسات RLS للتحقق من صلاحية المستخدم الحالي.
--   • SECURITY DEFINER: تتجاوز RLS على admin_users لقراءة الصف.
--   • search_path='': تمنع hijack عبر مخططات المستخدم.
--   • لا تأخذ أي بارامتر: تعتمد فقط على auth.uid() لتفادي كشف حالة مسؤول آخر.
-- ---------------------------------------------------------------------
create or replace function app_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.is_active
  );
$$;

comment on function app_private.is_admin() is
  'هل المستخدم الحالي مسؤول نشط؟ تعتمد على auth.uid() فقط.';
