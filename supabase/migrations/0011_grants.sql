-- =====================================================================
-- 0011 — Grant/Revoke (أقل امتياز)
-- =====================================================================
-- ملاحظة: Supabase يمنح افتراضيًا ALL على الجداول الجديدة في public لدورَي
-- anon/authenticated، لذلك نحتاج REVOKE صريح بدل الاكتفاء بعدم المنح.
-- RLS هو خط الدفاع الأول؛ هذا الملف خط دفاع ثانٍ (مستوى الامتياز).
-- =====================================================================

-- المخطط الداخلي: منح الاستخدام فقط (بدون ذلك لا تعمل استدعاءات RLS)
grant usage on schema app_private to anon, authenticated;

-- =====================================================================
-- دوال app_private: إلغاء كل شيء من public ثم منح الحد الأدنى
-- =====================================================================
revoke all on all functions in schema app_private from public;

-- is_admin(): مطلوبة لتقييم سياسات RLS (لا تُمكّن واجهة REST لأن المخطط غير مكشوف).
grant execute on function app_private.is_admin() to anon, authenticated;

-- is_pending_upload(): كانت مطلوبة لسياسة RLS الاختيارية للرفع المباشر — أُزيلت
-- من 0008 نهائيًا. (لن تُمنح أبدًا.)

-- =====================================================================
-- دوال API العامة
-- =====================================================================
revoke all on function public.submit_response(jsonb) from public;
revoke all on function public.register_upload(uuid, text, text, bigint) from public;
revoke all on function public.confirm_upload(uuid, bigint, text) from public;

-- submit_response: بوابة الإرسال المجهول — تبقى متاحة للواجهة.
grant execute on function public.submit_response(jsonb) to anon, authenticated;

-- register_upload + confirm_upload: يديرهما الوسيط الخادمي فقط (Edge Function
-- بصلاحيات service_role/المالك). لا يُمنحان لأي دور واجهة — الواجهة تمرّ إلزامًا
-- عبر Edge Function، فيقلّ سطح الهجوم إلى نقطة واحدة قابلة للكبح والمراقبة.

-- =====================================================================
-- جداول البيانات الحساسة: لا كتابة لأي دور واجهة، قراءة مسؤول فقط.
-- =====================================================================
revoke all on public.responses from anon;
revoke all on public.responses from authenticated;
grant select on public.responses to authenticated;

revoke all on public.response_answers from anon;
revoke all on public.response_answers from authenticated;
grant select on public.response_answers to authenticated;

revoke all on public.response_uploads from anon;
revoke all on public.response_uploads from authenticated;
grant select on public.response_uploads to authenticated;

revoke all on public.audit_log from anon;
revoke all on public.audit_log from authenticated;
grant select on public.audit_log to authenticated;

-- =====================================================================
-- admin_users: لا يمكن لأي دور واجهة الكتابة عليه إطلاقًا (منع ترقية ذاتية).
-- =====================================================================
revoke all on public.admin_users from anon;
revoke all on public.admin_users from authenticated;
grant select on public.admin_users to authenticated;

-- =====================================================================
-- profiles: قراءة/تحديث ملفه فقط
-- =====================================================================
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;

-- =====================================================================
-- questions + question_options: عامة تقرأ النشط (RLS)، والمصادَق يقدر DML
--      (RLS يشترط is_admin على كل عمليات الكتابة).
-- =====================================================================
revoke all on public.questions from anon;
revoke all on public.questions from authenticated;
grant select on public.questions to anon;
grant select, insert, update, delete on public.questions to authenticated;

revoke all on public.question_options from anon;
revoke all on public.question_options from authenticated;
grant select on public.question_options to anon;
grant select, insert, update, delete on public.question_options to authenticated;