-- =====================================================================
-- 0007 — audit_log (سجل تدقيق)
-- =====================================================================
-- سجل إضافي لعمليات إدارة الأسئلة وإدارة المسؤولين، لتتبع من غيّر ماذا ومتى.
-- لا يُكتب سوى عبر دوال SECURITY DEFINER (Triggers) لضمان عدم تلاعب الواجهة.
-- الواجهة (anon): لا وصول إطلاقًا. authenticated: قراءة للمسؤولين فقط (RLS لاحقًا).
-- =====================================================================

create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text not null check (action in ('insert','update','delete')),
  entity     text not null,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'سجل تدقيق لعمليات إدارة حساسة. يُملأ تلقائيًا عبر Triggers DEFINER.';

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);
create index if not exists audit_log_entity_idx
  on public.audit_log (entity, entity_id);

-- ---------------------------------------------------------------------
-- دالة التدقيق العامة (لا حساسة تُمرَّر من المتصل — فقط من trigger)
-- ---------------------------------------------------------------------
create or replace function app_private.log_audit(
  p_actor  uuid,
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_detail jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (actor, action, entity, entity_id, detail)
  values (p_actor, p_action, p_entity, p_entity_id, p_detail);
end;
$$;

-- ---------------------------------------------------------------------
-- أداة تسجيل للأسئلة
-- ---------------------------------------------------------------------
create or replace function app_private.audit_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.log_audit(
    auth.uid(),
    lower(tg_op)::text,
    'questions',
    new.id::text,
    jsonb_build_object(
      'title', new.title,
      'type', new.type,
      'is_active', new.is_active
    )
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists questions_audit on public.questions;
create trigger questions_audit
after insert or update or delete on public.questions
for each row execute function app_private.audit_questions();

-- ---------------------------------------------------------------------
-- أداة تسجيل لإدارة المسؤولين (إضافة/إزالة/تعطيل)
-- ---------------------------------------------------------------------
create or replace function app_private.audit_admin_users()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.log_audit(
    auth.uid(),
    lower(tg_op)::text,
    'admin_users',
    coalesce(new.user_id, old.user_id)::text,
    jsonb_build_object(
      'is_active', coalesce(new.is_active, old.is_active),
      'is_owner', coalesce(new.is_owner, old.is_owner),
      'note', coalesce(new.note, old.note)
    )
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists admin_users_audit on public.admin_users;
create trigger admin_users_audit
after insert or update or delete on public.admin_users
for each row execute function app_private.audit_admin_users();