-- =====================================================================
-- 0006 — response_uploads (ملفات وصور المشاركات المجهولة)
-- =====================================================================
-- سجلّ "حجز" مسار رفع لكل ملف/صورة داخل استجابة.
-- يُنشأ عبر register_upload (SECURITY DEFINER) وليس عبر RLS مباشرة،
-- ولا يُؤكَّد إلا بعد رفع فعلي عبر confirm_upload (وسيط خادمي/Edge Function).
--
-- التدفق (يُفصَّل في وثيقة storage.md):
--   1) الوسيط الخادمي (Edge Function) يستدعي register_upload(...)
--      → تُنشأ صف هنا برمز token عشوائي ومسار مُولَّد pending/<token>/<name>.
--   2) الوسيط يُوقع upload URL للمسار المَحجوز ويقرأ الحجم/النوع الفعليين
--      للكائن ثم يستدعي confirm_upload(...) → status='uploaded' + confirmed_at.
--   3) في الإرسال، submit_response يربط الصف بالاستجابة (attached) ذرّيًا.
--   لا يُقبل 'pending' في submit_response نهائيًا — الرفع لا يُربط إلا بعد
--   تأكيد فعلي (status='uploaded').
-- =====================================================================

create table if not exists public.response_uploads (
  id              uuid primary key default gen_random_uuid(),
  token           uuid not null default gen_random_uuid() unique,
  response_id     uuid references public.responses(id) on delete cascade,
  question_id     uuid references public.questions(id) on delete set null,
  bucket_id       text not null default 'survey-uploads'
                    check (bucket_id = 'survey-uploads'),
  object_path     text not null,
  original_filename text,
  declared_mime   text check (declared_mime is null or char_length(declared_mime) <= 200),
  declared_size   bigint check (declared_size is null or declared_size >= 0),
  actual_size     bigint check (actual_size is null or actual_size >= 0),
  actual_mime     text,
  confirmed_at    timestamptz,             -- لحظة تأكيد الرفع (confirm_upload)
  status          text not null default 'pending'
                    check (status in ('pending','uploaded','attached','rejected','expired')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 minutes'),
  unique (bucket_id, object_path)
);

comment on table public.response_uploads is
  'رافعات الملفات/الصور للمشاركات المجهولة. لا تصل إليها الواجهة مباشرة إطلاقًا.';

create index if not exists response_uploads_response_id_idx
  on public.response_uploads (response_id);
create index if not exists response_uploads_question_id_idx
  on public.response_uploads (question_id);
create index if not exists response_uploads_status_idx
  on public.response_uploads (status);