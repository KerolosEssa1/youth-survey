-- =====================================================================
-- 0008 — دوال التحقق والإرسال ورفع الملفات (Public API)
-- =====================================================================
--   • public.submit_response(p_answers jsonb)   : إرسال مجهول آمن + ذرّي.
--   • public.register_upload(...)               : حجز مسار رفع آمن (خادمي/وسيط فقط).
--   • public.confirm_upload(...)                : تأكيد رفع فعلي موثوق (خادمي/وسيط فقط).
--   • app_private.validate_answer_value(...)    : تحقق خادمي لكل نوع سؤال.
--   • app_private.is_allowed_mime(type, mime)   : قائمة MIME موحَّدة لكلا الدالتين.
--
-- قواعد مساعدات الأمان:
--   • كل دالة حساسة SECURITY DEFINER من مالك الجدول (postgres).
--   • set search_path = '' وكل مرجع مؤهَّل بالكامل لمنع search_path hijack.
--   • لا تُمنح دوال app_private في واجهة REST (المخطط غير مكشوف).
--   • صلاحيات EXECUTE تُحدَّد في 0011_grants.sql؛ confirm_upload وregister_upload
--     لا تُمنحان لأي دور واجهة (تستدعيهما Edge Function بصلاحيات service_role فقط).
-- =====================================================================

-- ---------------------------------------------------------------------
-- مساعدات قراءة إعدادات JSON بأمان
-- ---------------------------------------------------------------------
create or replace function app_private.settings_int(p_settings jsonb, p_key text, p_default int)
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(p_settings ->> p_key, '')::int, p_default);
$$;

create or replace function app_private.settings_numeric(p_settings jsonb, p_key text, p_default numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(p_settings ->> p_key, '')::numeric, p_default);
$$;

-- ---------------------------------------------------------------------
-- قائمة MIME الموحَّدة لنوع السؤال.
-- مصدر الحقيقة الوحيد لـ register_upload وconfirm_upload (يجب أن تطابق
-- allowed_mime_types للحاوية في 0010_storage.sql، وتُحدَّث في مكان واحد هنا).
-- ---------------------------------------------------------------------
create or replace function app_private.is_allowed_mime(p_type public.question_type, p_mime text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
           when 'image_upload' then p_mime in ('image/png', 'image/jpeg', 'image/webp')
           when 'file_upload'  then p_mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')
           else false
         end;
$$;

-- ---------------------------------------------------------------------
-- التحقق من قيمة الإجابة حسب نوع السؤال (يرفع استثناء عند الخطأ).
-- يعمل بصلاحيات من ينسخه، لكنه لا يُستدعى إلا من submit_response (مالك).
-- ---------------------------------------------------------------------
create or replace function app_private.validate_answer_value(
  p_question_id uuid,
  p_type        public.question_type,
  p_settings    jsonb,
  p_value       jsonb
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_text  text;
  v_num   numeric;
  v_min_i int;
  v_max_i int;
  v_min_n numeric;
  v_max_n numeric;
  v_step  numeric;
  v_count int;
begin
  -- مسح عام: الأمانة والتحقق من التعداد
  if (p_value is null) or (p_type = 'description') then
    raise exception 'E_VAL: no value allowed' using errcode = '22000';
  end if;

  case p_type

  when 'text', 'textarea' then
    if not app_private.jsonb_is_string(p_value) then
      raise exception 'E_VAL: text answer must be a string' using errcode = '22000';
    end if;
    v_text := p_value #>> '{}';
    v_min_i := coalesce(app_private.settings_int(p_settings, 'minLength', 0), 0);
    v_max_i := coalesce(app_private.settings_int(p_settings, 'maxLength',
                       (case when p_type = 'textarea' then 5000 else 500 end)), 5000);
    if char_length(v_text) < v_min_i then
      raise exception 'E_VAL: answer too short' using errcode = '22000';
    end if;
    if char_length(v_text) > v_max_i then
      raise exception 'E_VAL: answer too long' using errcode = '22000';
    end if;

  when 'email' then
    if not app_private.jsonb_is_string(p_value) then
      raise exception 'E_VAL: email must be a string' using errcode = '22000';
    end if;
    v_text := btrim(p_value #>> '{}');
    if v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' or char_length(v_text) > 320 then
      raise exception 'E_VAL: invalid email address' using errcode = '22000';
    end if;

  when 'url' then
    if not app_private.jsonb_is_string(p_value) then
      raise exception 'E_VAL: url must be a string' using errcode = '22000';
    end if;
    v_text := btrim(p_value #>> '{}');
    if char_length(v_text) > 2048
       or lower(left(v_text, 7)) not in ('http://', 'https:/') then
      raise exception 'E_VAL: invalid url' using errcode = '22000';
    end if;

  when 'number' then
    if not app_private.jsonb_is_number(p_value) then
      raise exception 'E_VAL: number answer must be numeric' using errcode = '22000';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    v_min_n := coalesce(app_private.settings_numeric(p_settings, 'min', '-infinity'::numeric), '-infinity');
    v_max_n := coalesce(app_private.settings_numeric(p_settings, 'max', 'infinity'::numeric), 'infinity');
    v_step  := coalesce(app_private.settings_numeric(p_settings, 'step', 0), 0);
    if v_num < v_min_n or v_num > v_max_n then
      raise exception 'E_VAL: number out of range' using errcode = '22000';
    end if;
    if v_step > 0 and mod(v_num, v_step) <> 0 then
      raise exception 'E_VAL: number does not match step' using errcode = '22000';
    end if;

  when 'single_choice', 'dropdown' then
    if not app_private.jsonb_is_string(p_value) then
      raise exception 'E_VAL: choice answer must be a string' using errcode = '22000';
    end if;
    v_text := p_value #>> '{}';
    if not exists (
      select 1 from public.question_options o
      where o.question_id = p_question_id and o.value = v_text and o.is_active
    ) then
      raise exception 'E_VAL: invalid choice value' using errcode = '22000';
    end if;

  when 'multiple_choice' then
    if jsonb_typeof(p_value) <> 'array' then
      raise exception 'E_VAL: multiple choice answer must be an array' using errcode = '22000';
    end if;
    v_count := jsonb_array_length(p_value);
    if v_count = 0 then
      raise exception 'E_VAL: multiple choice needs at least one value' using errcode = '22000';
    end if;
    if (select count(distinct e.v) from jsonb_array_elements(p_value) as e(v)) <> v_count then
      raise exception 'E_VAL: duplicate choice values' using errcode = '22000';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_value) as e(v)
      where not (app_private.jsonb_is_string(e.v)
                 and exists (select 1 from public.question_options o
                             where o.question_id = p_question_id and o.value = e.v #>> '{}' and o.is_active))
    ) then
      raise exception 'E_VAL: invalid multiple choice value' using errcode = '22000';
    end if;
    v_min_i := coalesce(app_private.settings_int(p_settings, 'minItems', 1), 1);
    v_max_i := coalesce(app_private.settings_int(p_settings, 'maxItems', 100), 100);
    if v_count < v_min_i or v_count > v_max_i then
      raise exception 'E_VAL: multiple choice count out of range' using errcode = '22000';
    end if;

  when 'yes_no', 'true_false' then
    if not app_private.jsonb_is_bool(p_value) then
      raise exception 'E_VAL: boolean answer must be true/false' using errcode = '22000';
    end if;

  when 'rating' then
    if not app_private.jsonb_is_number(p_value) then
      raise exception 'E_VAL: rating must be numeric' using errcode = '22000';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num <> trunc(v_num) then
      raise exception 'E_VAL: rating must be a whole number' using errcode = '22000';
    end if;
    v_min_n := coalesce(app_private.settings_numeric(p_settings, 'scaleMin', 1), 1);
    v_max_n := coalesce(app_private.settings_numeric(p_settings, 'scaleMax', 5), 5);
    if v_num < v_min_n or v_num > v_max_n then
      raise exception 'E_VAL: rating out of range' using errcode = '22000';
    end if;

  when 'linear_scale' then
    if not app_private.jsonb_is_number(p_value) then
      raise exception 'E_VAL: linear scale must be numeric' using errcode = '22000';
    end if;
    v_num := (p_value #>> '{}')::numeric;
    v_min_n := coalesce(app_private.settings_numeric(p_settings, 'min', 1), 1);
    v_max_n := coalesce(app_private.settings_numeric(p_settings, 'max', 10), 10);
    v_step  := coalesce(app_private.settings_numeric(p_settings, 'step', 1), 1);
    if v_num < v_min_n or v_num > v_max_n then
      raise exception 'E_VAL: linear scale out of range' using errcode = '22000';
    end if;
    if v_step <= 0 or mod(v_num - v_min_n, v_step) <> 0 then
      raise exception 'E_VAL: linear scale does not match step' using errcode = '22000';
    end if;

  when 'date' then
    if not app_private.jsonb_is_string(p_value)
       or p_value #>> '{}' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'E_VAL: invalid date (YYYY-MM-DD)' using errcode = '22000';
    end if;

  when 'time' then
    if not app_private.jsonb_is_string(p_value)
       or p_value #>> '{}' !~ '^\d{2}:\d{2}(:\d{2})?$' then
      raise exception 'E_VAL: invalid time (HH:MM[:SS])' using errcode = '22000';
    end if;

  when 'datetime' then
    if not app_private.jsonb_is_string(p_value) then
      raise exception 'E_VAL: datetime must be a string' using errcode = '22000';
    end if;
    begin
      perform ((p_value #>> '{}')::timestamptz);
    exception when others then
      raise exception 'E_VAL: invalid datetime' using errcode = '22000';
    end;

  when 'file_upload', 'image_upload' then
    -- الشكل: مصفوفة من رموز رفع (tokens) نصية. التحقق من الربط يتم في submit_response.
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then
      raise exception 'E_VAL: upload answer must be a non-empty array' using errcode = '22000';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_value) as e(v)
      where not app_private.jsonb_is_string(e.v)
    ) then
      raise exception 'E_VAL: upload tokens must be strings' using errcode = '22000';
    end if;

  else
    raise exception 'E_VAL: unsupported question type' using errcode = '22000';
  end case;
end;
$$;

-- ---------------------------------------------------------------------
-- submit_response: إرسال استجابة مجهولة ذرّيًا.
--   المدخل: مصفوفة JSON من {"question_id": uuid, "value": <json>}
--   النتيجة: void (لا نُعيد أي معرّف كي لا نمنح الزائر ما يفيد بقراءة استجابته).
-- ---------------------------------------------------------------------
create or replace function public.submit_response(p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id uuid := gen_random_uuid();
  v_answer      jsonb;
  v_qid         uuid;
  v_q           record;
  v_val         jsonb;
  v_answer_ids  jsonb := '[]'::jsonb;
  v_text        text;
  v_label       text;
  v_num         numeric;
  v_bool        boolean;
  v_date        date;
  v_time        time;
  v_ts          timestamptz;
  v_json        jsonb;
  v_count       int := 0;
  v_req         record;
  v_token       uuid;
  v_up          record;
  v_item        jsonb;
  v_up_agg      jsonb := '[]'::jsonb;
begin
  -- (1) شكل المدخلات
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'E_ANSWERS: expected a JSON array' using errcode = '22023';
  end if;

  -- (2) إنشاء الاستجابة أولًا (ذرّي: أي خطأ لاحق يلغي كل شيء)
  insert into public.responses (id) values (v_response_id);

  -- (3) حلقة التحقق والتخزين
  for v_answer in select value from jsonb_array_elements(p_answers)
  loop
    if jsonb_typeof(v_answer) <> 'object' then
      raise exception 'E_ANSWERS: each answer must be an object' using errcode = '22023';
    end if;

    v_qid := (v_answer->>'question_id')::uuid;
    if v_qid is null then
      raise exception 'E_ANSWERS: question_id required' using errcode = '22023';
    end if;
    v_val := v_answer->'value';

    select id, title, type, is_required, is_active, position, settings
      into v_q
      from public.questions q
     where q.id = v_qid;
    if v_q.id is null then
      raise exception 'E_ANSWERS: unknown question' using errcode = '22000';
    end if;
    if not v_q.is_active then
      raise exception 'E_ANSWERS: question is not active' using errcode = '22000';
    end if;
    if v_q.type = 'description' then
      raise exception 'E_ANSWERS: description field cannot hold an answer' using errcode = '22000';
    end if;

    -- التحقق الخادمي حسب النوع
    perform app_private.validate_answer_value(v_qid, v_q.type, v_q.settings, v_val);

    -- توحيد القيم
    v_text := null; v_label := null; v_num := null; v_bool := null;
    v_date := null; v_time := null; v_ts := null; v_json := null;

    case v_q.type
    when 'text', 'textarea', 'email', 'url' then
      v_text := app_private.jsonb_as_text(v_val);

    when 'single_choice', 'dropdown' then
      v_text := app_private.jsonb_as_text(v_val);
      select o.label into v_label
        from public.question_options o
       where o.question_id = v_qid and o.value = v_text and o.is_active;

    when 'multiple_choice' then
      -- نحفظ قيمة + لقطة نص الخيار معًا (مصفوفة مرتّبة حسب الإدخال)
      select jsonb_agg(
               jsonb_build_object('value', e.v #>> '{}', 'label', o.label) order by e.ord
             )
        into v_json
        from jsonb_array_elements(v_val) with ordinality as e(v, ord)
        join public.question_options o
          on o.question_id = v_qid and o.value = e.v #>> '{}' and o.is_active;

    when 'yes_no', 'true_false' then
      v_bool := (v_val #>> '{}')::boolean;

    when 'number', 'rating', 'linear_scale' then
      v_num := (v_val #>> '{}')::numeric;

    when 'date' then
      v_date := (v_val #>> '{}')::date;

    when 'time' then
      v_time := (v_val #>> '{}')::time;

    when 'datetime' then
      v_ts := (v_val #>> '{}')::timestamptz;

    when 'file_upload', 'image_upload' then
      -- كل token يجب أن يكون حجزًا صالحًا لهذا السؤال وغير مُستخدَم
      v_up_agg := '[]'::jsonb;
      for v_item in select value from jsonb_array_elements(v_val)
      loop
        v_token := (v_item #>> '{}')::uuid;
        select * into v_up from public.response_uploads u where u.token = v_token;
        if v_up.id is null then
          raise exception 'E_UPLOAD: unknown upload token' using errcode = '22000';
        end if;
        if v_up.question_id is distinct from v_qid then
          raise exception 'E_UPLOAD: upload token belongs to another question' using errcode = '22000';
        end if;
        if v_up.response_id is not null then
          raise exception 'E_UPLOAD: upload token already used' using errcode = '22000';
        end if;
        -- لا يُقبل إلا رفع مؤكَّد فعليًا (confirm_upload) — لا "حجز pending" بلا كائن.
        if v_up.status <> 'uploaded' then
          raise exception 'E_UPLOAD: upload token is not confirmed' using errcode = '22000';
        end if;
        if v_up.expires_at < now() then
          raise exception 'E_UPLOAD: upload token is expired' using errcode = '22000';
        end if;
        -- إرفاق ذرّي وحيد الاستخدام: الشرط يمنع السباق حتى مع طلبين متزامنين
        -- (لو سبق طلب آخر وأرفق الصف أولًا فلن يطابق هذا UPDATE أي صف => رفض).
        update public.response_uploads
           set response_id = v_response_id, status = 'attached'
         where id = v_up.id
           and response_id is null
           and status = 'uploaded'
           and expires_at >= now();
        if not found then
          raise exception 'E_UPLOAD: upload token already used' using errcode = '22000';
        end if;
        v_up_agg := v_up_agg || jsonb_build_object(
          'upload_id', v_up.id::text,
          'path', v_up.object_path,
          'filename', v_up.original_filename,
          'mime', coalesce(v_up.actual_mime, v_up.declared_mime),
          'size', coalesce(v_up.actual_size, v_up.declared_size)
        );
      end loop;
      v_json := v_up_agg;

    else
      raise exception 'E_ANSWERS: unsupported question type' using errcode = '22000';
    end case;

    insert into public.response_answers (
      response_id, question_id, question_type, question_title, question_position,
      value_text, value_label, value_number, value_bool, value_date, value_time,
      value_timestamptz, value_json
    ) values (
      v_response_id, v_qid, v_q.type, v_q.title, v_q.position,
      v_text, v_label, v_num, v_bool, v_date, v_time, v_ts, v_json
    );

    v_answer_ids := v_answer_ids || to_jsonb(v_qid);
    v_count := v_count + 1;
    if v_count > 300 then
      raise exception 'E_ANSWERS: too many answers' using errcode = '54000';
    end if;
  end loop;

  -- (4) التحقق من الأسئلة الإلزامية النشطة
  for v_req in
    select q.id, q.title
      from public.questions q
     where q.is_active and q.is_required and q.type <> 'description'
  loop
    if not (v_answer_ids ? v_req.id::text) then
      raise exception 'E_REQUIRED: missing required question' using errcode = '23502';
    end if;
  end loop;

  -- كل شيء نجح داخل دالة واحدة => الالتزام ذرّي.
end;
$$;

-- ---------------------------------------------------------------------
-- register_upload: حجز مسار رفع دون تمكين الواجهة من مسارات عشوائية.
--   - يتحقق من نوع السؤال ونوع الملف والحجم (حدود صارمة).
--   - يولّد token عشوائي ومسارًا داخل "pending/<token>/".
--   - يعيد JSON يستهلكه الوسيط الخادمي (Edge Function) لتوقيع upload URL.
--   - تُنشأ هنا حالة 'pending' فقط؛ لا يكتمل الرفع إلا بـ confirm_upload.
-- ---------------------------------------------------------------------
create or replace function public.register_upload(
  p_question_id uuid,
  p_filename    text,
  p_mime        text,
  p_size        bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q      record;
  v_token  uuid := gen_random_uuid();
  v_safe   text;
  v_path   text;
  v_limit  bigint := 10485760; -- 10 MB
begin
  select id, type, is_active into v_q
    from public.questions q where q.id = p_question_id;
  if v_q.id is null then
    raise exception 'E_UPLOAD: unknown question' using errcode = '22000';
  end if;
  if not v_q.is_active then
    raise exception 'E_UPLOAD: question is not active' using errcode = '22000';
  end if;
  if v_q.type not in ('file_upload', 'image_upload') then
    raise exception 'E_UPLOAD: question does not accept files' using errcode = '22000';
  end if;

  if p_size is null or p_size <= 0 or p_size > v_limit then
    raise exception 'E_UPLOAD: invalid size (max 10 MB)' using errcode = '22000';
  end if;

  if coalesce(p_mime, '') = '' or not app_private.is_allowed_mime(v_q.type, lower(p_mime)) then
    raise exception 'E_UPLOAD: file type not allowed' using errcode = '22000';
  end if;

  -- تنقية اسم الملف (لا مسارات، لا أحرف تحكم، طول محدود).
  -- نرفض أولًا الأسماء الطويلة جدًا قبل أي regexp (حماية من استهلاك CPU
  -- عبر اسم ضخم). كل ما ليس حرفًا/رقمًا/نقطة/شرطة/شرطة سفلية (بما فيها
  -- '/' '\\' وأحرف التحكم) يتحول إلى '_'.
  if char_length(coalesce(p_filename, '')) > 255 then
    raise exception 'E_UPLOAD: filename too long' using errcode = '22000';
  end if;
  v_safe := regexp_replace(coalesce(p_filename, ''), '[^a-zA-Z0-9._-]', '_', 'g');
  v_safe := left(v_safe, 120);
  if v_safe = '' or v_safe = '.' or v_safe = '..' or btrim(v_safe, '._-') = '' then
    v_safe := 'file.bin';
  end if;

  v_path := 'pending/' || v_token::text || '/' || v_safe;

  insert into public.response_uploads (
    token, question_id, bucket_id, object_path, original_filename,
    declared_mime, declared_size
  ) values (
    v_token, p_question_id, 'survey-uploads', v_path, v_safe,
    lower(p_mime), p_size
  );

  return jsonb_build_object(
    'token',       v_token::text,
    'bucket',      'survey-uploads',
    'path',        v_path,
    'expires_at',  (now() + interval '30 minutes')::timestamptz
  );
end;
$$;

-- ---------------------------------------------------------------------
-- confirm_upload: تأكيد رفع فعلي موثوق (يستدعيه الوسيط الخادمي فقط).
--   - يتحقق من وجود الحجز وعدم انتهائه وعدم استخدامه.
--   - يسجّل الحجم والنوع الفعليين (يُقرآن من خزن الكائنات عبر الوسيط).
--   - يحوّل الحالة إلى 'uploaded'؛ لا يُقبل في submit_response إلا بعد ذلك.
--   - دفاع متعدد الطبقات: يعيد فحص النوع الفعلي مقابل قائمة MIME الموحَّدة.
--   - لا تُمنح لأي دور واجهة في 0011_grants.sql (تستدعى بصلاحيات service_role).
-- ---------------------------------------------------------------------
create or replace function public.confirm_upload(
  p_token        uuid,
  p_actual_size  bigint,
  p_actual_mime  text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_up     record;
  v_qt     public.question_type;
  v_limit  bigint := 10485760; -- 10 MB (يطابق v_limit في register_upload)
begin
  select * into v_up
    from public.response_uploads u
   where u.token = p_token;

  if v_up.id is null then
    raise exception 'E_UPLOAD: unknown upload token' using errcode = '22000';
  end if;
  if v_up.response_id is not null then
    raise exception 'E_UPLOAD: upload token already used' using errcode = '22000';
  end if;
  if v_up.expires_at < now() then
    raise exception 'E_UPLOAD: upload token is expired' using errcode = '22000';
  end if;

  if p_actual_size is null or p_actual_size <= 0 or p_actual_size > v_limit then
    raise exception 'E_UPLOAD: invalid actual file size' using errcode = '22000';
  end if;

  -- إعادة فحص النوع الفعلي مقابل القائمة الموحَّدة (دفاع متعدد الطبقات؛
  -- يبقى صالحًا حتى لو اختلفت منطق الوسيط).
  if v_up.question_id is not null then
    select q.type into v_qt from public.questions q where q.id = v_up.question_id;
    if v_qt = 'image_upload'
       and coalesce(lower(p_actual_mime), '') not in ('image/png', 'image/jpeg', 'image/webp') then
      raise exception 'E_UPLOAD: image type not allowed' using errcode = '22000';
    end if;
    if v_qt = 'file_upload'
       and coalesce(lower(p_actual_mime), '') not in
           ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') then
      raise exception 'E_UPLOAD: file type not allowed' using errcode = '22000';
    end if;
  end if;

  update public.response_uploads
     set status       = 'uploaded',
         actual_size  = p_actual_size,
         actual_mime  = lower(p_actual_mime),
         confirmed_at = now()
   where id = v_up.id
     and response_id is null;
  if not found then
    raise exception 'E_UPLOAD: upload token already used' using errcode = '22000';
  end if;
end;
$$;