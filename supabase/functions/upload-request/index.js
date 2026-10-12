// =====================================================================
// upload-request — الخطوة 1 من الرفع المجهول (نقطة دخول خادمية وحيدة)
// =====================================================================
// الدور: نقطة اتصال الواجهة الوحيدة لطلب رفع ملف/صورة.
//   • يتحقق من مفتاح الواجهة (anon) ومعدّل الطلبات لكل IP.
//   • يستدعي register_upload بصلاحيات service_role — لا تملك الواجهة أي
//     EXECUTE عليه (انظر 0011_grants.sql).
//   • يُوقّع upload URL مخصصًا للمسار المُحجَّز خادميًا فقط (لا خيار مسار
//     حرّ للزائر) ويعيد { token, signedUrl } للواجهة.
//
// المتغيرات البيئية (يوفرها Supabase تلقائيًا — لا تُكتب في أي ملف واجهة):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//   RATE_LIMIT_PER_MINUTE (اختياري؛ الافتراضي 15)
//
// النشر: supabase functions deploy upload-request --verify-jwt true
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — يطابق register_upload والحاوية (0010)

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

function isUuid(v) {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function clientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

// حدّ معدّل بسيط لكل مثيل (أفضل جهد): نافذة زمنية منزلقة لكل IP.
// مقصود أن يخفف الإساءة؛ التقييد الحاسم متعدد المثيلات يُترك لبوابة المنصة.
const rateBuckets = new Map();
function rateLimited(ip) {
  const limit = Number(Deno.env.get('RATE_LIMIT_PER_MINUTE') || 15) || 15;
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

  // المصادقة: يتطلب تقديم anon key (لا يقبل أي JWT مستخدم آخر).
  // deploy --verify-jwt true يرفض الطلبات بلا JWT؛ هنا نضمن أنه anon تحديدًا.
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

  const questionId = body.questionId;
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const byteSize = Number(body.byteSize);

  // تحقق أولي بالشكل فقط؛ التحقق الحاسم والفاعل في register_upload (ـDB).
  if (!isUuid(questionId)) return json({ error: 'invalid_question_id' }, 400);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_BYTES) {
    return json({ error: 'invalid_size' }, 400);
  }
  if (!fileName) return json({ error: 'invalid_filename' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );

  const { data, error } = await supabase.rpc('register_upload', {
    p_question_id: questionId,
    p_filename: fileName,
    p_mime: mimeType,
    p_size: byteSize,
  });
  if (error) {
    return json({ error: 'register_failed', detail: error.message }, 400);
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(data.bucket)
    .createSignedUploadUrl(data.path, { upsert: false });
  if (signError) {
    return json({ error: 'sign_failed', detail: signError.message }, 500);
  }

  return json({
    token: data.token,
    bucket: data.bucket,
    path: data.path,
    signedUrl: signed.signedUrl,
    expiresAt: data.expires_at,
  });
});