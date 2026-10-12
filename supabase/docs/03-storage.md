# 03 — تصميم Storage للرفع المجهول الآمن

## القيد الأساسي (يُشرح أولًا)

**زائر مجهول بلا حساب لا يمكنه رفع ملفات مباشرة إلى حاوية خاصة "بأمان تام"**
بوسائل RLS وحدها لثلاثة أسباب جوهرية:

1. **لا فحص محتوى حقيقي في RLS:** سياسات `storage.objects` تعمل على `name`
   والـ metadata، بينما يُشار إلى نوع الملف (MIME) في رأس الطلب، ومحرّك RLS
   لا يمنح قدرة فحص ملف الثنائيات الفعلي (content sniffing) قبل قبوله.
2. **لا كبح إساءة/تحديد معدّل:** التحقق في RLS يُنفَّذ بلا حالة جلسة، فيمكن
   لأي زائر ملء الحاوية (DoS بالمحتوى) أو تجربة مسارات/أسماء بشكل عشوائي.
3. **أي سياسة INSERT لـ anon توسّع سطح الهجوم** نحو أي مسار يُقبل في `with check`.

لهذا **القرار**: لا سياسة INSERT على `storage.objects` لأي دور واجهة.
الحاوية خاصة (`public=false`) مع حدود حاوية:
- `file_size_limit = 10 MB`
- `allowed_mime_types = image/png, image/jpeg, image/webp, application/pdf`

## التدفق المعتمد (آمِن — Edge Function، مُنفَّذ)

```
1) الواجهة  ──POST /functions/v1/upload-request {questionId, fileName, mimeType, byteSize}──▶ Edge
             Edge: يتحقق من anon key + حدّ معدّل لكل IP،
                   يستدعي register_upload(...) بصلاحيات service_role (DB)
                   → يحجز pending/<token>/<name>، ثم يوقّع upload URL لنفس المسار.
             ◀── { token, bucket, path, signedUrl, expiresAt }

2) الواجهة  ──PUT signedUrl (الجسم = الملف)──▶ Storage
             (لا سياسة INSERT لـ anon؛ التوقيع يسمح بكتابة هذا المسار المحدد فقط، بلا upsert)

3) الواجهة  ──POST /functions/v1/upload-confirm {token}──▶ Edge
             Edge: يقرأ الكائن الفعلي من Storage (الحجم/النوع من metadata)،
                   يتحقق من القائمة المسموحة والحد (10 MB)،
                   ثم يستدعي confirm_upload(...) → status='uploaded' + confirmed_at.
             ◀── { ok: true, size, mime }

4) الواجهة  ──rpc submit_response([...{question_id, value:[token]}])──▶ DB
             DB: يربط الرفع بالاستجابة (attached) ذرّيًا وبشكل وحيد الاستخدام.
```

لماذا هذا آمن؟
- المسار مُولَّد خادميًا (`pending/<token>/<name>`); لا يملك الزائر أي اختيار مسار.
- signed upload URL قصير الأمد ومحدد بمسار واحد، وبلا `upsert` (لا استبدال كائن قائم).
- `register_upload` و`confirm_upload` **غير ممنوحتين لأي دور واجهة** (0011)؛ الواجهة
  لا تستدعيهما مباشرة — تمرّ إلزامًا عبر Edge Function بصلاحيات `service_role`.
- `service_role` لا يدخل الواجهة إطلاقًا (يبقى في بيئة الخادم فقط).
- لا يُربط أي رفع في `submit_response` إلا بعد **تأكيد فعلي** (`status='uploaded'`)،
  والحجم/النوع يُقرآن من الكائن الحقيقي لا من إعلان المتصفّح.
- كبح الإساءة: حدّ معدّل لكل IP في الدالتين، وحصر زمني `expires_at` (30 دقيقة)،
  وربط وحيد الاستخدام (شرط `response_id is null` يمنع السباق).

## لماذا لا نستخدم RLS مباشرة (البديل المحذوف)

كان يوجد سابقًا بديل بسياسة INSERT لـ anon داخل `pending/<token>/` مع
`app_private.is_pending_upload`. **أُزيل نهائيًا** (من 0010 والدالة من 0008)،
لأنه يسمح بـ:

- **MIME spoofing:** رفع فيروس باسم `.png` مع رأس نوع ضمن الميما المسموحة (بلا فحص ثنائيات).
- **DoS بلا rate limit:** إغراق الحاوية برفعات متعددة بلا كبح.
- **غموض التفويض:** توسيع صلاحيات `anon` على `storage.objects` بلا وسيط موثوق.

## الحجم/الأنواع المسموحة (يجب إبقاؤها متطابقة)

ثلاث نسخ من نفس القائمة — أي تعديل يجب أن يشملها جميعًا:

| الموضع | الصيغة |
|---|---|
| `0010_storage.sql` | `allowed_mime_types` على مستوى الحاوية |
| `app_private.is_allowed_mime` (0008) | مصدر الحقيقة في `register_upload` |
| `upload-confirm/index.js` | `ALLOWED_IMAGE` / `ALLOWED_FILE` |

القيم: صور `image/png, image/jpeg, image/webp`؛ ملفات تضيف `application/pdf`. الحد 10 MB.

## قراءة الملفات والتنزيل

- المسؤول يقرأ عبر سياسة `uploads_admin_select` (JWT مصادَق + `is_admin`).
- التنزيل: عبر `createSignedUrl` بجانب المسؤول، أو `download` بالـ JWT.
- الزائر العام: لا قراءة ولا `public` URL (الحاوية خاصة).

## مكافحة إساءة الرفع

- `expires_at` (30 دقيقة) لكل حجز؛ بعدها يُرفض في `confirm_upload` و`submit_response`.
- إرفاق وحيد الاستخدام: لا يمكن ربط token باستجابة مرتين، ولا ربط token واحد
  باستجابتين عبر طلبين متزامنين (شرط مرفق `UPDATE ... WHERE response_id IS NULL`).
- حدّ معدّل لكل IP داخل دالتي Edge (`RATE_LIMIT_PER_MINUTE`، الافتراضي 15/30) —
  «أفضل جهد» لكل مثيل؛ التقييد الحاسم متعدد المثيلات يُضبط على بوابة المنصة.
- تنظيف الحجوزات المنتهية/غير المكتملة: يدويًا عبر سياسة `uploads_admin_delete`،
  أو مهمة مجدولة (غير مُنفَّذة بعد — عنصر متابعة).
- الخصوصية: IP يُستخدم لحظيًا للتقييد فقط ولا يُخزَّن في قاعدة البيانات؛ ملاحظة أن
  سجلات منصة Edge قد تحتوي IP (يُضبط الاحتفاظ بها في إعدادات المشروع).
