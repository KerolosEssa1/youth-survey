-- =====================================================================
-- 0004 — questions + question_options
-- =====================================================================
-- تعريفات الأسئلة وخياراتها. هذه "إعدادات" وليست تاريخًا: يمكن تعديلها أو
-- تعطيلها. الإجابات التاريخية تحفظ نسخة (snapshot) من نص السؤال ونوعه.
--
-- ملاحظة: لا نعتمد الحذف الفعلي للأسئلة في التشغيل العادي (نستخدم is_active).
-- الحذف الفعلي (service_role) لا يحذف الإجابات التاريخية لأن عمود
-- response_answers.question_id يستخدم ON DELETE SET NULL.
-- =====================================================================

create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 1000),
  description text check (description is null or char_length(description) <= 4000),
  type        public.question_type not null,
  is_required boolean not null default false,
  is_active   boolean not null default true,
  position    integer not null default 0 check (position >= 0),
  -- إعدادات خاصة بكل نوع (حدود، مقياس، طول...). يجب أن تكون كائن JSON.
  settings    jsonb not null default '{}'::jsonb
                check (jsonb_typeof(settings) = 'object'),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- الحقل الوصفي لا يمكن أن يكون إلزاميًا.
  constraint questions_description_not_required
    check (type <> 'description' or is_required = false)
);

comment on table public.questions is
  'تعريفات أسئلة الاستبيان. التعديل/التعطيل لا يؤثر على الإجابات المحفوظة.';
comment on column public.questions.settings is
  'JSONB لإعدادات النوع: مثال للنص {minLength,maxLength}, للرقم {min,max,step}, '
  'للمقياس الخطي {min,max,minLabel,maxLabel,step}, للاختيار المتعدد {minItems,maxItems}.';

create index if not exists questions_active_position_idx
  on public.questions (is_active, position);

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
before update on public.questions
for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------
-- question_options: خيارات أنواع الاختيار فقط.
-- ON DELETE CASCADE من questions: الخيارات جزء من الإعداد لا من التاريخ.
-- ---------------------------------------------------------------------
create table if not exists public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 500),
  value       text not null check (char_length(btrim(value)) between 1 and 200),
  position    integer not null default 0 check (position >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (question_id, value)
);

comment on table public.question_options is
  'خيارات أسئلة الاختيار (single_choice, multiple_choice, dropdown).';

create index if not exists question_options_question_position_idx
  on public.question_options (question_id, position);
