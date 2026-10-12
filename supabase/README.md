# supabase/ — قاعدة بيانات ووثائق

> ✅ المشروع جاهز للاستخدام. يجب تنفيذ الخطوات يدويًا على مشروع Supabase
> الخاص بك (لا يتم أي نشر تلقائي من هذا المستودع). اتبع الترتيب في آخر الملف.

## الملفات التنفيذية (تُشغَّل بالترتيب في SQL Editor)

| # | الملف | المحتوى |
|---|-------|---------|
| 1 | `migrations/0001_extensions_enums_helpers.sql` | pgcrypto، مخطط `app_private`، نوع `question_type`، دوال مساعدة |
| 2 | `migrations/0002_profiles.sql` | جدول `profiles` + Trigger إنشاء تلقائي من `auth.users` |
| 3 | `migrations/0003_admin_users.sql` | جدول `admin_users` + دالة `app_private.is_admin()` |
| 4 | `migrations/0004_questions_options.sql` | `questions` + `question_options` (إعدادات، قيود، فهارس) |
| 5 | `migrations/0005_responses_answers.sql` | `responses` + `response_answers` (لقطات تاريخية) |
| 6 | `migrations/0006_response_uploads.sql` | جدول حجز رفع الملفات/الصور |
| 7 | `migrations/0007_audit_log.sql` | `audit_log` + Triggers تدقيق |
| 8 | `migrations/0008_functions_public_api.sql` | `submit_response` + `register_upload` + `confirm_upload` + التحقق لكل نوع |
| 9 | `migrations/0009_rls_policies.sql` | تفعيل RLS + السياسات لكل جدول |
| 10 | `migrations/0010_storage.sql` | حاوية خاصة `survey-uploads` + سياسات Storage |
| 11 | `migrations/0011_grants.sql` | Revoke/Grant بأقل امتياز (`register_upload`/`confirm_upload` خادمية فقط) |

**قاعدة إلزامية:** لا تضع أبدًا `service_role` key في أي ملف واجهة
(`assets/js/config.js` يحوي `anon` فقط).

## البيانات الأولية (Seed)

| الملف | المحتوى |
|---|---|
| `seed/seed_questions.sql` | أسئلة وخيارات جاهزة لاستبيان اللقاء الشبابي |

- آمن لإعادة التشغيل: معرّفات ثابتة + `on conflict (id) do nothing`، فلا يُنشئ
  تكرارًا ولا يستبدل أي تعديل لاحق من لوحة التحكم.
- لا يحتوي أسئلة `file_upload`/`image_upload` (الرفع معطَّل حتى اختبار تدفق الرفع).
- لا يجمع أي بيانات شخصية.
- يُشغَّل بعد `0001`→`0011` من **SQL Editor**.


## Edge Functions (الوسيط الخادمي للرفع المجهول)

| الدالة | المسار | الدور |
|---|---|---|
| `upload-request` | `functions/upload-request/index.js` | يقبل طلب رفع (anon key + rate limit)، يستدعي `register_upload` بـ service_role، ويوقّع `upload URL` لنفس المسار المُحجَّز |
| `upload-confirm` | `functions/upload-confirm/index.js` | يقرأ الحجم/النوع الفعليين من Storage، يتحقق من الحدود، ثم يستدعي `confirm_upload` (→ `status='uploaded'`) |

- المتغيرات البيئية (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`)
  يوفرها Supabase تلقائيًا؛ لا تُكتب قيمها في أي ملف.
- تُنشر بالانفصال عن موقع GitHub Pages:
  `supabase functions deploy upload-request --verify-jwt true`
  `supabase functions deploy upload-confirm --verify-jwt true`

## الوثائق

- `docs/01-schema.md` — شرح الجداول والعلاقات.
- `docs/02-rls-matrix.md` — مصفوفة سياسات RLS لكل جدول ودور.
- `docs/03-storage.md` — تصميم الحاوية الخاصة وتدفّق الرفع الآمن.
- `docs/04-bootstrap-first-admin.md` — إجراء إنشاء أول مسؤول بأمان.
- `docs/05-security-tradeoffs.md` — القرارات الأمنية والمقايضات.
- `docs/06-test-plan.md` — خطة الاختبار.

## خطوات التشغيل (يدويًا — بالترتيب)

1. أنشئ مشروع Supabase، ثم من **Project Settings → API** انسخ `Project URL`
   و `anon public key` وضعهما في `assets/js/config.js` (مع `PUBLIC_SURVEY_URL`).
2. من **SQL Editor** نَفِّذ الملفات `0001` → `0011` بالترتيب (نفس المشروع).
3. نَفِّذ `seed/seed_questions.sql` لتعبئة أسئلة بدائية (اختياري لكن مُوصى به).
4. انشر دالتي الرفع (فقط عند الرغبة في تفعيل الرفع — راجع `docs/03-storage.md`):
   `supabase functions deploy upload-request --verify-jwt true` ثم
   `supabase functions deploy upload-confirm --verify-jwt true`.
5. أنشئ أول مسؤول وفق `docs/04-bootstrap-first-admin.md`
   (Authentication → Users → Add user، ثم إدراج صف في `admin_users`).
6. اختبر وفق `docs/06-test-plan.md`.

> ملاحظة: إنشاء/تعديل الأسئلة من لوحة التحكم يدعم كل الأنواع ما عدا
> `file_upload`/`image_upload` (معطَّلان في الواجهة).