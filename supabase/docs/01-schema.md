# 01 — الجداول والعلاقات

## مخطط ER مبسّط

```
auth.users
   │ 1
   └─── 0..1 ── profiles            (ملف المستخدم المصادَق)
   └─── 0..1 ── admin_users         (صلاحية المسؤول)
        granted_by ──▶ auth.users

questions 1 ── 0..n question_options   (خيارات أسئلة الاختيار فقط)
questions 1 ── 0..n response_answers   (ON DELETE SET NULL)
responses 1 ── 0..n response_answers   (ON DELETE CASCADE)
questions 1 ── 0..n response_uploads   (ON DELETE SET NULL)
responses 1 ── 0..n response_uploads   (ON DELETE CASCADE)

audit_log  — سجل مستقل (actor ↝ auth.users غير ملزَم)
```

## وصف الجداول

### `auth.users` (Supabase)
جدول النظام. لا نعدّله إلا عبر إنشاء مستخدم (Dashboard/SDK admin) — وليس من الواجهة.

### `profiles`
- `id` = `auth.users.id` (FK, CASCADE).
- يُنشأ صف تلقائيًا عبر Trigger `app_private.handle_new_user()`.
- يخصّ المسؤولين عمومًا؛ لا علاقة له بالمشاركات المجهولة.

### `admin_users`
- `user_id` = `auth.users.id` (FK, CASCADE).
- `is_active`, `is_owner`, `granted_by`, `granted_at`, `note`.
- **لا كتابة لأي دور واجهة إطلاقًا** (GRANT-less + لا RLS policy إدراج).

### `questions`
- `title` (نص السؤال)، `description` (مساعدة)، `type` (من `question_type`)،
  `is_required`, `is_active`, `position`, `settings JSONB`, `created_by`.
- `settings` يخزن حدود تحقق النوع: للنص `minLength/maxLength`، للرقم `min/max/step`،
  للمقياس `min/max/step/minLabel/maxLabel`، للاختيار المتعدد `minItems/maxItems`.
- التعطيل (وليس الحذف) هو مسار الحياة الطبيعية للأسئلة.

### `question_options`
- خيارات `single_choice / multiple_choice / dropdown`.
- `unique (question_id, value)`.
- `ON DELETE CASCADE` من `questions` (الخيارات جزء من الإعداد لا من التاريخ).

### `responses`
- **مجهولة بالتصميم**: لا `user_id`, لا IP, لا أي معرّف شخصي.
- `status ('submitted','void')`, `locale`, `schema_version`, `submitted_at`.
- تُنشأ فقط داخل `submit_response` (SECURITY DEFINER). لا RLS INSERT.

### `response_answers`
- كل إجابة تحمل **لقطة (snapshot)** من السؤال: `question_type`, `question_title`,
  `question_position`.
- `question_id` بـ `ON DELETE SET NULL` ← حذف سؤال **لا** يمسّ التاريخ.
- `response_id` بـ `ON DELETE CASCADE` ← حذف استجابة يمسّ إجاباتها (إجراء إداري فقط عند الحاجة).
- عمود قيمة واحد فعّال حسب النوع:
  - `value_text` → text/textarea/email/url/single_choice/dropdown
  - `value_label` → لقطة نصّ الخيار المختار (اختيار فردي)
  - `value_number` → number/rating/linear_scale
  - `value_bool` → yes_no/true_false
  - `value_date`, `value_time`, `value_timestamptz` → date/time/datetime
  - `value_json` → multiple_choice (مصفوفة `{value,label}`) و file/image (مصفوفة مراجع رفع)
- قيد `response_answers_has_value`: أي إجابة غير وصفية تملك قيمة واحدة على الأقل.

### `response_uploads`
- حجز مسار رفع لكل ملف/صورة: `token` فريد، `object_path` مُولَّد، الحالة
  `pending → uploaded → attached`، انتهاء صلاحية (30 دقيقة)، و`confirmed_at`
  لحظة تأكيد الرفع.
- الواجهة لا تقرأ هذا الجدول (لا SELECT لـ anon). الربط يتم في `submit_response`.
- يقوم `register_upload` بتوليد المسار `pending/<token>/<filename-sanitized>`؛ لا مسار حرّ من الزائر.
- لا يقبل `submit_response` إلا `status='uploaded'` (بعد `confirm_upload` الذي
  يتحقق من الحجم/النوع الفعليين للكائن) — لا يُربط حجز `pending` بلا كائن.

### `audit_log`
- سجل عمليات إدارة الأسئلة وإدارة المسؤولين. يُملأ عبر Triggers
  `app_private.audit_questions()` / `audit_admin_users()` (SECURITY DEFINER).
- لا إدراج من الواجهة إطلاقًا.

## خريطة أنواع الأسئلة → الأعمدة

| النوع | عمود القيمة | تحقق خادمي في `validate_answer_value` |
|---|---|---|
| `text` | value_text | طول بين minLength/maxLength (افتراضي ≤500) |
| `textarea` | value_text | طول ≤5000 افتراضيًا |
| `email` | value_text | نمط بريد + طول ≤320 |
| `number` | value_number | min/max/step |
| `url` | value_text | http/https + طول ≤2048 |
| `single_choice` | value_text + value_label | القيمة خيار نشط |
| `multiple_choice` | value_json | مصفوفة خيارات نشطة بدون تكرار + minItems/maxItems |
| `dropdown` | value_text + value_label | مثل single_choice |
| `yes_no` | value_bool | boolean |
| `true_false` | value_bool | boolean |
| `rating` | value_number | عدد صحيح ضمن scaleMin..scaleMax (افتراضي 1..5) |
| `linear_scale` | value_number | ضمن min..max بحدود step |
| `date` | value_date | `YYYY-MM-DD` |
| `time` | value_time | `HH:MM[:SS]` |
| `datetime` | value_timestamptz | ISODate صالح |
| `file_upload` | value_json | مصفوفة tokens بحالة uploaded + فحص الملف في register_upload/confirm_upload |
| `image_upload` | value_json | مصفوفة tokens بحالة uploaded + فحص الصورة في register_upload/confirm_upload |
| `description` | — (لا إجابة) | يُرفض إرسال أي إجابة له |

## الفهارس

- `questions (is_active, position)`
- `question_options (question_id, position)` + `unique(question_id, value)`
- `responses (submitted_at desc)`, `responses (status)`
- `response_answers (response_id)`, `(question_id)`,
  `unique(response_id, question_id) where question_id is not null`
- `response_uploads (response_id)`, `(question_id)`, `(status)`, `unique(token)`, `unique(bucket_id, object_path)`
- `audit_log (created_at desc)`, `(entity, entity_id)`