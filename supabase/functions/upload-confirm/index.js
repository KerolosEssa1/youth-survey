// =====================================================================
// upload-confirm — الخطوة 3 من الرفع المجهول (وسيط خادمي فقط)
// =====================================================================
// الدور: يتحقق من وجود الكائن المرفوع فعليًا في Storage (الحجم/النوع
// الحقيقيان من metadata الكائن — لا نثق بإعلان المتصفّح)، ثم يؤكد الحجز
// عبر confirm_upload. لا يُقبل الرفع في submit_response إلا بعد هذه الخطوة
// (status='uploaded'، لا 'pending').
//
// المتغيرات البيئية: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                     SUPABASE_ANON_KEY, RATE_LIMIT_PER_MINUTE (الافتراضي 30)
//
// النشر: supabase functions deploy upload-confirm --verify-jwt true
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — يطابق register_upload والحاوية
const ALLOWED_IMAGE = ['image/png', 'image/jpeg', 'image/webp'];
const ALLOWED_FILE = [...ALLOWED_IMAGE, 'application/pdf'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, ...extraHeaders },
  });
}

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

const rateBuckets = new Map();
function rateLimited(ip) {
  const limit = Number(Deno.env.get('RATE_LIMIT_PER_MINUTE') || 30) || 30;
  const windowMs = 60_000;
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start > windowMs) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const supplied =
    req.headers.get('apikey') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!supplied || supplied !== Deno.env.get('SUPABASE_ANON_KEY')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return json({ error: 'invalid_token' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );

  // قراءة الحجز (بصلاحيات خدمية — الواجهة لا تقرأ هذا الجدول إطلاقًا)
  const { data: res, error: resErr } = await supabase
    .from('response_uploads')
    .select('token, question_id, bucket_id, object_path, response_id, status, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (resErr || !res) return json({ error: 'unknown_token' }, 404);
  if (res.response_id || res.status === 'attached') {
    return json({ error: 'token_already_used' }, 409);
  }
  if (new Date(res.expires_at).getTime() < Date.now()) {
    return json({ error: 'token_expired' }, 410);
  }

  // نوع السؤال لتحديد قائمة MIME المسموحة للتحقق المكرر (دفاع متعدد الطبقات)
  const { data: q } = await supabase
    .from('questions')
    .select('type')
    .eq('id', res.question_id)
    .maybeSingle();
  const allow =
    q?.type === 'image_upload' ? ALLOWED_IMAGE : q?.type === 'file_upload' ? ALLOWED_FILE : [];

  // قراءة الكائن الفعلي من مجلد الحجز للوصول إلى الحجم/النوع الحقيقيين
  const folder = 'pending/' + res.token;
  const { data: items, error: listErr } = await supabase.storage
    .from(res.bucket_id)
    .list(folder, { limit: 10, offset: 0 });
  if (listErr) {
    return json({ error: 'storage_list_failed', detail: listErr.message }, 500);
  }

  const expectedName = res.object_path.split('/').pop();
  const obj = (items || []).find((i) => i.name === expectedName);
  if (!obj) return json({ error: 'object_missing' }, 409);

  const meta = obj.metadata || {};
  const actualSize = Number(meta.size ?? meta.contentLength ?? obj.size ?? 0);
  const actualMime = String(meta.mimetype ?? '').toLowerCase();

  if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > MAX_BYTES) {
    return json({ error: 'invalid_actual_size' }, 409);
  }
  if (!allow.includes(actualMime)) {
    return json({ error: 'mime_not_allowed' }, 409);
  }

  // تأكيد نهائي داخل قاعدة البيانات (SECURITY DEFINER، بصلاحيات خدمية فقط)
  const { error: rpcErr } = await supabase.rpc('confirm_upload', {
    p_token: res.token,
    p_actual_size: actualSize,
    p_actual_mime: actualMime,
  });
  if (rpcErr) {
    return json({ error: 'confirm_failed', detail: rpcErr.message }, 409);
  }

  return json({ ok: true, size: actualSize, mime: actualMime });
});