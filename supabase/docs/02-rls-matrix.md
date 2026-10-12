# 02 — مصفوفة RLS (Row-Level Security)

الأدوار:
- **anon** — الزائر المجهول (لن يحمل JWT).
- **authenticated** — أي مستخدم مصادَق (Supabase Auth) **ليس بالضرورة مسؤولًا**.
- **admin** — `authenticated` يحقق شرط `app_private.is_admin()` (صف نشط في `admin_users`).
- **service_role / owner** — يتجاوز RLS (لا يُستخدم في الواجهة أبدًا).

> مفتاح المخطط: أي `authenticated` غير مسؤول يُعامل كـ anon في كل ما هو حساس.

| الجدول | SELECT | INSERT | UPDATE | DELETE |
|---|:-:|:-:|:-:|:-:|
| `responses` | admin فقط | ❌ لا أحد (عبر `submit_response`) | ❌ | ❌ |
| `response_answers` | admin فقط | ❌ | ❌ | ❌ |
| `response_uploads` | admin فقط | ❌ | ❌ | ❌ |
| `audit_log` | admin فقط | ❌ | ❌ | ❌ |
| `admin_users` | صاحبه أو admin | ❌ | ❌ | ❌ |
| `profiles` | صاحبه | (لا: عبر Trigger) | صاحبه فقط | ❌ |
| `questions` | anon: النشط فقط / admin: الكل | admin فقط | admin فقط | admin فقط |
| `question_options` | anon: خيارات الأسئلة النشطة فقط / admin: الكل | admin فقط | admin فقط | admin فقط |
| `storage.objects` (حاوية survey-uploads) | admin فقط | ❌ (لا سياسة) | ❌ | admin فقط |

## ملاحظات مهمة

- **الزائر يقرأ الأسئلة/الخيارات النشطة** فقط: `is_active = true` وخيارات أسئلة نشطة.
  هذا ضروري لعرض الاستبيان، ويُعدّ معلومة عامة متعمّدة.
- **الزائر لا يقرأ استجابته** ولا أي استجابة: لا سياسة SELECT إطلاقًا إلا للمسؤول.
- `submit_response` لا يُعيد أي معرّف استجابة؛ لا وجود "للملكية" من طرف الزائر.
- `admin_users` بلا سياسة إدراج/تحديث/حذف **وبلا GRANT** للكتابة لأي دور واجهة:
  منع كامل للترقية الذاتية. (خطان دفاع: GRANT + RLS.)
- كل عمليات كتابة الأسئلة تشترط `with check (app_private.is_admin())`؛ حتى لو امتلك
  `authenticated` صلاحية DML، يرفض RLS أي صف لا يمتلكه مسؤول نشط.
- سياسات `app_private.is_admin()` تُقيَّم بصلاحيات المتصل لكن الدالة SECURITY DEFINER
  فتقرأ `admin_users` بأمان (لا حاجة لعرض الجدول).

## لماذا `responses` بلا INSERT policy؟

لأن إنشاء الاستجابة يحدث **ذرّيًا داخل دالة واحدة** `submit_response` (SECURITY DEFINER
من المالك) مع التحقق والالتزام معًا. لو سمحنا INSERT مباشر لاستطعنا استقبال بيانات
غير مُتحقق منها أو تكرارات جزئية.

## كيف يقرأ المسؤول؟

- الواجهة تنفّذ `select` على الجداول بسياسات `responses_admin_select` إلخ؛ تُقيَّم
  `app_private.is_admin()` على أساس JWT الحالي → يرى العموم أو لا شيء.
- تصدير CSV يتم عبر هذه القراءة (نفس RLS).
- ملاحظة: لا نستخدم `admin_users` في `localStorage` ولا في متغيرات JavaScript أبدًا؛
  الحكم يأتي من قاعدة البيانات فقط.