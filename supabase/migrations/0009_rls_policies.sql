-- =====================================================================
-- 0009 — سياسات RLS لكل الجداول العامة
-- =====================================================================
-- المبادئ:
--   • مبدأ الامتياز الأصغر: لا INSERT/UPDATE/DELETE عام على الإطلاق.
--   • الزائر (anon) لا يقرأ استجابة ولا إجابة ولا رفعًا ولا سجل التدقيق.
--   • أيauthenticated غير مُسجَّل كمسؤول يعامل مثل anon في كل البيانات الحساسة.
--   • الواجهة العامة تقرأ فقط الأسئلة والخيارات النشطة (لتعرض الاستبيان).
--   • المسؤول يحدد حصريًا عبر app_private.is_admin() (من admin_users).
--   • الكتابة في الجداول الحساسة فقط عبر دوال SECURITY DEFINER من المالك.
-- =====================================================================

-- الجداول في تطبيق المشاركة يجب أن تكون بلا معرّف مشارك:
alter table public.questions      enable row level security;
alter table public.question_options enable row level security;
alter table public.profiles       enable row level security;
alter table public.admin_users    enable row level security;
alter table public.responses      enable row level security;
alter table public.response_answers enable row level security;
alter table public.response_uploads enable row level security;
alter table public.audit_log      enable row level security;

-- =====================================================================
-- responses + response_answers: لا شيء للزائر، قراءة للمسؤول فقط.
-- لا توجد سياسات INSERT إطلاقًا => تُنشأ فقط عبر submit_response (المالك).
-- (drop if exists قبل كل create لإعادة تشغيل الملف بأمان.)
-- =====================================================================
drop policy if exists "responses_admin_select" on public.responses;
create policy "responses_admin_select"
  on public.responses for select
  to authenticated
  using (app_private.is_admin());

drop policy if exists "response_answers_admin_select" on public.response_answers;
create policy "response_answers_admin_select"
  on public.response_answers for select
  to authenticated
  using (app_private.is_admin());

-- =====================================================================
-- response_uploads: نفس النهج — لا وصول للزائر، admin-select فقط.
-- =====================================================================
drop policy if exists "response_uploads_admin_select" on public.response_uploads;
create policy "response_uploads_admin_select"
  on public.response_uploads for select
  to authenticated
  using (app_private.is_admin());

-- =====================================================================
-- audit_log: قراءة المسؤول فقط. الكتابة عبر Triggers DEFINER.
-- =====================================================================
drop policy if exists "audit_log_admin_select" on public.audit_log;
create policy "audit_log_admin_select"
  on public.audit_log for select
  to authenticated
  using (app_private.is_admin());

-- =====================================================================
-- admin_users: لا يمكن لأي دور واجهة الكتابة أو منح أي صلاحية.
-- القراءة: صاحبه فقط، أو أي مسؤول (للإدارة).
-- =====================================================================
drop policy if exists "admin_users_read_self_or_admin" on public.admin_users;
create policy "admin_users_read_self_or_admin"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid() or app_private.is_admin());

-- =====================================================================
-- profiles: المستخدم يقرأ/يحدّث ملفه فقط.
-- =====================================================================
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =====================================================================
-- questions: عامة تقرأ النشط فقط؛ المسؤول يقرأ الكل ويدير إنشاء/تعديل/حذف.
-- =====================================================================
drop policy if exists "questions_public_read_active" on public.questions;
create policy "questions_public_read_active"
  on public.questions for select
  to anon, authenticated
  using (is_active);

drop policy if exists "questions_admin_read_all" on public.questions;
create policy "questions_admin_read_all"
  on public.questions for select
  to authenticated
  using (app_private.is_admin());

drop policy if exists "questions_admin_insert" on public.questions;
create policy "questions_admin_insert"
  on public.questions for insert
  to authenticated
  with check (app_private.is_admin());

drop policy if exists "questions_admin_update" on public.questions;
create policy "questions_admin_update"
  on public.questions for update
  to authenticated
  using (app_private.is_admin())
  with check (app_private.is_admin());

drop policy if exists "questions_admin_delete" on public.questions;
create policy "questions_admin_delete"
  on public.questions for delete
  to authenticated
  using (app_private.is_admin());

-- =====================================================================
-- question_options: نفس النهج — عامة تقرأ خيارات الأسئلة النشطة فقط.
-- =====================================================================
drop policy if exists "question_options_public_read_active" on public.question_options;
create policy "question_options_public_read_active"
  on public.question_options for select
  to anon, authenticated
  using (
    is_active
    and exists (
      select 1 from public.questions q
      where q.id = question_id and q.is_active
    )
  );

drop policy if exists "question_options_admin_read_all" on public.question_options;
create policy "question_options_admin_read_all"
  on public.question_options for select
  to authenticated
  using (app_private.is_admin());

drop policy if exists "question_options_admin_insert" on public.question_options;
create policy "question_options_admin_insert"
  on public.question_options for insert
  to authenticated
  with check (app_private.is_admin());

drop policy if exists "question_options_admin_update" on public.question_options;
create policy "question_options_admin_update"
  on public.question_options for update
  to authenticated
  using (app_private.is_admin())
  with check (app_private.is_admin());

drop policy if exists "question_options_admin_delete" on public.question_options;
create policy "question_options_admin_delete"
  on public.question_options for delete
  to authenticated
  using (app_private.is_admin());