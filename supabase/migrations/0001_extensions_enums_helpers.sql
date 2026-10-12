-- =====================================================================
-- 0001 — الإضافات، الأنواع، والمخطط الداخلي، ودوال المساعدة
-- youth-survey — Stage 4 / Phase 2 (ملف للمراجعة فقط — لا يُنفَّذ الآن)
-- =====================================================================
--
-- ملاحظات عامة:
--   • جميع المعرّفات (identifiers) بالإنجليزية، والتعليقات بالعربية.
--   • كل الدوال الحساسة في المخطط app_private (غير مكشوف عبر PostgREST).
--   • كل دالة SECURITY DEFINER تضبط search_path = '' وتستخدم أسماءً مؤهّلة بالكامل.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) الإضافات
-- ---------------------------------------------------------------------
-- pgcrypto لتوفير gen_random_uuid() (متاح افتراضيًا في PG13+ لكن نضمنه).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- (2) المخطط الداخلي app_private
--    غير مُدرج ضمن "Exposed schemas" في PostgREST، لذا لا يمكن استدعاء
--    دواله مباشرة من الواجهة، لكن يمكن لسياسات RLS ولدوال DEFINER استخدامه.
-- ---------------------------------------------------------------------
create schema if not exists app_private;

comment on schema app_private is
  'دوال ومكوّنات داخلية غير مكشوفة عبر واجهة REST. لا تُمنح صلاحيات عامة.';

-- ---------------------------------------------------------------------
-- (3) نوع السؤال (كل الأنواع المتفق عليها)
-- ---------------------------------------------------------------------
-- تنبيه مستقبلي: إضافة قيمة جديدة تتم بـ ALTER TYPE ... ADD VALUE، وهي
-- غير معاملاتية (لا يمكن تشغيلها داخل Transaction في إصدارات معينة من PG).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'question_type' and typnamespace = 'public'::regnamespace) then
    create type public.question_type as enum (
      'text',            -- نص قصير
      'textarea',        -- نص طويل
      'email',           -- بريد إلكتروني
      'number',          -- رقم
      'url',             -- رابط
      'single_choice',   -- اختيار واحد (راديو)
      'multiple_choice', -- اختيار متعدد (checkbox)
      'dropdown',        -- قائمة منسدلة
      'yes_no',          -- نعم/لا
      'true_false',      -- صح/خطأ
      'rating',          -- تقييم (نجوم/أرقام)
      'linear_scale',    -- مقياس خطي قابل للضبط
      'date',            -- تاريخ
      'time',            -- وقت
      'datetime',        -- تاريخ ووقت
      'file_upload',     -- رفع ملف
      'image_upload',    -- رفع صورة
      'description'      -- حقل وصفي/تعليمات فقط (لا يقبل إجابة)
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- (4) دالة تحديث updated_at
-- ---------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app_private.set_updated_at() is
  'Trigger عام يضبط updated_at = now() قبل التحديث.';

-- ---------------------------------------------------------------------
-- (5) التحقق من أن النص القادم قيمة JSON نصية فقط (وليس كائنًا/مصفوفة)
--     تُستخدم داخل دوال التحقق.
-- ---------------------------------------------------------------------
create or replace function app_private.jsonb_is_string(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'string';
$$;

create or replace function app_private.jsonb_is_number(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'number';
$$;

create or replace function app_private.jsonb_is_bool(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null and jsonb_typeof(p_value) = 'boolean';
$$;

-- إرجاع النص من قيمة JSON نصية (فارغ إذا لم تكن نصًا)
create or replace function app_private.jsonb_as_text(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when app_private.jsonb_is_string(p_value) then p_value #>> '{}' else null end;
$$;
