-- =====================================================================
-- 0002 — profiles
-- =====================================================================
-- ملفات تعريف المستخدمين المصادَقين (المسؤولين عمومًا). لا تُستخدم للإجابة
-- على الاستبيان؛ المشاركة مجهولة تمامًا ولا تُربط بأي حساب.
-- =====================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 120),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'ملف شخصي لكل مستخدم مصادَق (auth.users). لا علاقة له بالاستجابات المجهولة.';

-- ---------------------------------------------------------------------
-- إنشاء صف profile تلقائيًا عند إنشاء مستخدم جديد في auth.users.
-- يُنفَّذ بصلاحيات المالك (SECURITY DEFINER) لأن الواجهة لا تملك الكتابة هنا.
-- ---------------------------------------------------------------------
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_user();

-- تحديث updated_at
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function app_private.set_updated_at();
