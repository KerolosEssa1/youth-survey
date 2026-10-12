# youth-survey — استبيان اللقاء الشبابي

تطبيق استبيان عربي (RTL) مجهول الهوية:

- **الواجهة:** HTML + CSS + JavaScript + Bootstrap 5 RTL (ملفات ثابتة).
- **قاعدة البيانات والمصادقة:** Supabase (PostgreSQL + Auth).
- **الاستضافة:** GitHub Pages (بدون أي Backend أو PHP).

## بنية المشروع

```
youth-survey/
├── index.html                 # الصفحة العامة للاستبيان
├── admin.html                 # لوحة تحكم المسؤول
├── 404.html                   # صفحة خطأ اختيارية
├── .nojekyll                  # يعطّل Jekyll على GitHub Pages
├── .gitignore
├── README.md
├── .github/workflows/deploy.yml
├── assets/
│   ├── images/meeting-logo.jpg
│   ├── css/styles.css
│   └── js/
│       ├── config.js           # إعدادات عامة (Project URL + anon key)
│       ├── supabase-client.js  # عميل Supabase مشترك
│       ├── auth.js             # المصادقة والتحقق من المسؤول
│       ├── survey.js           # تحميل الأسئلة والإرسال المجهول
│       ├── admin.js            # إدارة الأسئلة والردود
│       ├── csv.js              # تصدير CSV (Excel + عربي)
│       └── qr.js               # توليد رمز QR
└── supabase/                   # قاعدة البيانات: migrations + seed + توثيق
    ├── migrations/             # ملفات SQL بالترتيب (0001 → 0011)
    ├── seed/                   # بيانات أولية (seed_questions.sql)
    ├── functions/              # Edge Functions لتدفق الرفع الآمن
    └── docs/                   # schema, RLS matrix, storage, bootstrap, tradeoffs, test
```

## حالة التنفيذ

- **Phase 1:** هيكل الملفات، الصفحتان `index.html` و `admin.html`، التصميم،
  وتصحيح مسارات/ملفات يتيمة.
- **Phase 2:** مخطط قاعدة البيانات و RLs والدوال الآمنة و Storage في
  `supabase/migrations/` والوثائق في `supabase/docs/`.
- **Phase 3:** تدفق الرفع المجهول الآمن عبر Edge Functions
  (`upload-request` / `upload-confirm`).
- **Phase 4 (الاستخدام الفعلي):** الاستبيان العام الديناميكي، لوحة تحكم كاملة
  (CRUD/ترتيب/تفعيل/حذف)، عرض الردود + بحث + ترتيب + تصدير CSV، رمز QR،
  وبيانات أولية في `supabase/seed/`.

> لا يتم أي نشر تلقائي من هذا المستودع، ولم تُنفَّذ أي migration على مشروع حقيقي.
> اتبع خطوات الإعداد أدناه يدويًا.

## متطلبات التشغيل المحلي

ملفات المشروع عبارة عن ES Modules، لذا **يجب** تقديمها عبر خادم HTTP محلي
(لا تعمل عبر `file://`). على سبيل المثال باستخدام XAMPP:

```
http://localhost/youth-survey/
http://localhost/youth-survey/admin.html
```

## إعداد Supabase (يدوي — بالترتيب)

1. أنشئ مشروعًا على [supabase.com](https://supabase.com).
2. من **Project Settings → API** انسخ `Project URL` و `anon public key`.
3. ضع القيمتين في `assets/js/config.js` (مع `PUBLIC_SURVEY_URL` للرابط المنشور):
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...";
   export const PUBLIC_SURVEY_URL = "https://USERNAME.github.io/youth-survey/";
   ```
   > لا تضع أبدًا `service_role` key في أي ملف واجهة.
4. من **SQL Editor** نفّذ ملفات `supabase/migrations/` بالترتيب `0001` → `0011`.
5. نفّذ `supabase/seed/seed_questions.sql` لتعبئة أسئلة بدائية (`on conflict do nothing`).
6. أنشئ أول مسؤول وفق `supabase/docs/04-bootstrap-first-admin.md`
   (Authentication → Users → Add user، ثم إدراج صف في `admin_users`).
7. (اختياري) فعّل الرفع بنشر دالتي Edge وفق `supabase/README.md` و`docs/03-storage.md`.

التفاصيل الكاملة في [`supabase/README.md`](supabase/README.md).

## النشر على GitHub Pages

- الرابط سيكون بالشكل: `https://USERNAME.github.io/youth-survey/`.
- جميع المسارات في المشروع **نسبية** (`./assets/...`) لذا تعمل تحت المسار الفرعي للمستودع.
- ملف `.nojekyll` موجود لمنع معالجة Jekyll.
- النشر إما:
  - عبر **Settings → Pages → Deploy from a branch** (الفرع `main` / المجلد `/root`)، أو
  - عبر **GitHub Actions** باستخدام `.github/workflows/deploy.yml`.
- بعد معرفة الرابط النهائي المنشور، يُستخدم لتوليد رمز QR ومشاركته.

> تم تجهيز المشروع بالكامل للاستخدام، لكن لم يُنفَّذ أي نشر أو migration
> تلقائيًا من هذا المستودع.
