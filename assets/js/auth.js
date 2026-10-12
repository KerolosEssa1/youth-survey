/*
 * المصادقة والتحقق من صلاحية المسؤول.
 *
 * المرحلة الحالية: تنفيذ فعلي.
 * التحقق من صلاحية المسؤول يعتمد حصريًا على قاعدة البيانات (admin_users + RLS)
 * وليس على localStorage أو متغير JavaScript.
 */

import { getSupabase, isConfigured } from "./supabase-client.js";

export async function getSession() {
  if (!isConfigured) return null;
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthStateChange(callback) {
  if (!isConfigured) return { unsubscribe() {} };
  let subscription = { unsubscribe() {} };
  getSupabase().then((supabase) => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(callback);
    subscription = data.subscription;
  });
  return subscription;
}

export async function signIn(email, password) {
  if (!isConfigured) throw new Error("Supabase غير مُعد.");
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim(),
    password: String(password || ""),
  });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  if (!isConfigured) return;
  const supabase = await getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * هل المستخدم الحالي مسؤول نشط؟
 * موثوق لأن RLS على admin_users لا تُرجع صفًا لغير المسؤول
 * (سياسة admin_users_read_self_or_admin).
 */
export async function isCurrentUserAdmin() {
  if (!isConfigured) return false;
  const session = await getSession();
  const uid = session?.user?.id;
  if (!uid) return false;

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", uid)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
