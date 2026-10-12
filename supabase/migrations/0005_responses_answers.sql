-- =====================================================================
-- 0005 — responses + response_answers
-- =====================================================================
-- المشاركة مجهولة: لا يوجد user_id ولا IP ولا أي معرّف شخصي.
-- الإجابات تحفظ نسخة من نص السؤال ونوعه وترتيبه لضمان بقاء التاريخ سليمًا
-- حتى لو عُدّل السؤال أو عُطّل أو حُذف.
-- =====================================================================

create table if not exists public.responses (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'submitted'
                   check (status in ('submitted', 'void')),
  locale         text check (locale is null or char_length(locale) <= 20),
  schema_version integer not null default 1 check (schema_version >= 1),
  submitted_at   timestamptz not null default now()
);

comment on table public.responses is
  'استجابة واحدة (مجموعة إجابات). لا تُربط بأي هوية. تُنشأ فقط عبر دالة submit_response.';

create index if not exists responses_submitted_at_idx
  on public.responses (submitted_at desc);
create index if not exists responses_status_idx
  on public.responses (status);

-- ---------------------------------------------------------------------
-- response_answers: إجابة واحدة لكل سؤال لكل استجابة.
--   • response_id ON DELETE CASCADE: حذف الاستجابة يحذف إجاباتها (إجراء إداري فقط).
--   • question_id ON DELETE SET NULL: حذف السؤال لا يحذف الإجابة التاريخية أبدًا.
--   • نحفظ snapshot: question_type, question_title, question_position.
-- ---------------------------------------------------------------------
create table if not exists public.response_answers (
  id                 uuid primary key default gen_random_uuid(),
  response_id        uuid not null references public.responses(id) on delete cascade,
  question_id        uuid references public.questions(id) on delete set null,
  -- لقطات تاريخية (snapshots) لا تتغيّر مع تعديل السؤال:
  question_type      public.question_type not null,
  question_title     text not null,
  question_position  integer,
  -- أعمدة القيم حسب نوع السؤال (عمود واحد فعّال لكل نوع):
  value_text         text,        -- text, textarea, email, url, single_choice, dropdown
  value_label        text,        -- لقطة نصّ الخيار المختار (للاختيار الفردي)
  value_number       numeric,     -- number, rating, linear_scale
  value_bool         boolean,     -- yes_no, true_false
  value_date         date,        -- date
  value_time         time,        -- time
  value_timestamptz  timestamptz, -- datetime
  value_json         jsonb,       -- multiple_choice (مصفوفة خيارات)، file/image (مراجع رفع)
  created_at         timestamptz not null default now(),
  -- يجب أن تحوي كل إجابة (غير الوصفية) قيمة واحدة على الأقل.
  constraint response_answers_has_value check (
    question_type = 'description'
    or value_text is not null
    or value_number is not null
    or value_bool is not null
    or value_date is not null
    or value_time is not null
    or value_timestamptz is not null
    or value_json is not null
  )
);

comment on table public.response_answers is
  'إجابات فردية مع لقطة نص/نوع السؤال لحفظ التاريخ.';
comment on column public.response_answers.question_id is
  'قد يصبح NULL إذا حُذف السؤال فعليًا؛ تبقى اللقطة والبيانات سليمة.';

create index if not exists response_answers_response_id_idx
  on public.response_answers (response_id);
create index if not exists response_answers_question_id_idx
  on public.response_answers (question_id);

-- إجابة واحدة فقط لكل سؤال داخل الاستجابة (يُسمح بتكرار NULL بعد حذف السؤال).
create unique index if not exists response_answers_response_question_uidx
  on public.response_answers (response_id, question_id)
  where question_id is not null;
