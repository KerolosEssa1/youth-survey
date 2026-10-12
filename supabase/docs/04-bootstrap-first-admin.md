# 04 — إنشاء أول مسؤول (Bootstrap) بأمان

## المبدأ

لا يجوز لأي مستخدم (حتى مصادَق) أن يمنح نفسه صلاحية مسؤول. إنشاء المسؤول الأول
**قرار مالك مشروع موثوق** يتم خارج الواجهة تمامًا، وبصلاحيات تتجاوز RLS.

## الخيار الموصى به: Dashboard + SQL Editor

1. **أنشئ حساب المستخدم** في **Authentication → Users → Add user** بـ
   email/password (سيُلزم المستخدم عبر دعوة/إعادة تعيين كلمة مرور، أو
   `confirm` مباشرة) — هذا ينشئ صفًا في `auth.users`.
2. تأكد أن البريد هو بريد قابض اليد (صاحب المشروع) وليست أي بريد آخر.
3. افتح **SQL Editor** في نفس المشروع ونفّذ:

```sql
-- تحقق أولًا من وجود المستخدم:
select id, email, created_at
from auth.users
where email = 'owner@example.com';

-- ثم أنشئ الصف الأول (المالك):
insert into public.admin_users (user_id, is_active, is_owner, note)
select id, true, true, 'first admin (bootstrap)'
from auth.users
where email = 'owner@example.com'
on conflict (user_id) do nothing;
```

4. تحقق:

```sql
select u.email, a.is_active, a.is_owner, a.granted_at
from public.admin_users a
join auth.users u on u.id = a.user_id;
```

- المنفِّذ في SQL Editor يعمل كـ `postgres` (service_role) فيتجاوز RLS — هذا مقصود
  ومحتكر للمالك.
- لا نُعيد هذه العملية عبر أي RPC عام. لا يوجد RPC "أول مسؤول".

> بعد إضافة الصف أعلاه يستطيع صاحب الحساب الدخول من `admin.html`؛ تتحقق صفحة
> الدخول من وجود صف نشط في `admin_users` (عبر RLS
> `admin_users_read_self_or_admin`). تأكد من **تأكيد البريد الإلكتروني** للحساب
> (أو إنشائه بـ `Auto Confirm`) حتى يسمح Supabase Auth بتسجيل الدخول.

## الخيار البديل (آلي، موثق): Edge Function تعمل مرة واحدة

- تُنشأ Edge Function مؤقتة تملك `service_role` وتقرأ متغير بيئة `ADMIN_EMAIL`:
  - تتحقق أن `admin_users` فارغة (لم يُبسَّط البداية).
  - تتحقق من وجود المستخدم ثم تُدرج الصف `is_owner=true`.
  - تُعطَّل/تُحذف بعد الاستخدام.
- هذا يسمح بتشغيله عبر أمر بمفتاح صاحب المشروع فقط ولا يتعرض للمتأكد.

## تحذيرات

- لا `INSERT` عام/واجهة على `admin_users` — لا RLS policy + لا GRANT (defense-in-depth).
- لا نستخدم `localStorage`/متغيرات JavaScript لتقرير "هل أنا مسؤول".
- أول من يُدخِل سيصبح `is_owner`؛ من لديه `is_owner` يمكنه (عبر SQL Editor فقط)
  إدارة بقية المسؤولين لاحقًا.
- ترقية أي مستخدم لاحقًا: نفس النمط عبر SQL Editor أو وظيفة إدارية مفوضة
  بصلاحيات مالك — وليس من الواجهة.