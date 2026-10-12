/*
 * عميل Supabase مشترك لجميع الصفحات.
 *
 * ملاحظة أمان الحمولة (Stage 4 Phase 2):
 * كنا نستورد عميل CDN استيرادًا ثابتًا في أعلى الملف؛ إذا تعذّر الوصول إلى
 * CDN فكان يفشل تحميل الوحدة كلها ولا تظهر رسالة "غير مُعد" حتى. الحل الآمن:
 * تحميل عميل CDN بشكل كسول (lazy) عند الحاجة فقط وإذا كان المشروع مُعدًا.
 * عند عدم الإعداد لا يُطلب أي مورد من الشبكة إطلاقًا.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;

export function getSupabase() {
  if (!isConfigured) return Promise.resolve(null);

  if (!clientPromise) {
    clientPromise = import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    ).then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    );
  }

  return clientPromise;
}