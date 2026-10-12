-- =====================================================================
-- 0010 — Supabase Storage: حاوية خاصة + سياسات
-- =====================================================================
-- قرار أمني صريح:
--   لا تُمنح الواجهة المجهولة أي كتابة مباشرة على storage.objects إطلاقًا
--   (لا سياسة INSERT عموما). السبب: لا يمكن ضمان أمان/محتوى وكبح إساءة
--   من زائر مجهول بدون وسيط خادمي موثوق (انظر docs/03-storage.md).
--
--   التدفق المعتمد: Edge Function تملك service_role تستدعي register_upload()
--   ثم تُصدِر "signed upload URL" للمسار المُحجَّز، وبعد رفع المسؤول تقرأ
--   الحجم/النوع الفعليين من خزن الكائنات وتستدعي confirm_upload().
--   (البديل الأضعف — RLS بالـtoken — حُذف من ملف الرفع وبات معطَّلًا نهائيًا.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) إنشاء الحاوية الخاصة مع حدود على مستوى الحاوية (خلفية صارمة)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-uploads',
  'survey-uploads',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- (2) سياسات storage.objects
--     RLS مفعّل على storage.objects افتراضيًا؛ نضيف سياسات فقط.
--     (drop if exists قبل كل create لإعادة تشغيل الملف بأمان.)
-- ---------------------------------------------------------------------
-- قراءة المسؤولين للملفات (عبر JWT أو signed URL يُنشئه المسؤول).
drop policy if exists "uploads_admin_select" on storage.objects;
create policy "uploads_admin_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'survey-uploads'
    and app_private.is_admin()
  );

-- حذف المسؤولين (تنظيف/إدارة) — داخل حاوية الاستبيان فقط.
drop policy if exists "uploads_admin_delete" on storage.objects;
create policy "uploads_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'survey-uploads'
    and app_private.is_admin()
  );

-- لا سياسة INSERT هنا: أي محاولة رفع من anon/authenticated مرفوضة افتراضيًا.
-- (كان يوجد بديل RLS بالـ token في الإصدارات السابقة؛ أُزيل نهائيًا — يُسبّب
--  MIME spoofing بلا فحص محتوى ولا rate limit. الرفع يمرّ حصريًا عبر Edge Function.)