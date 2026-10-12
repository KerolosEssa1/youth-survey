/*
 * لوحة تحكم المسؤول (admin.html).
 *
 * المسؤوليات:
 *   • بوابة دخول مبنية على Supabase Auth + التحقق من العضوية في admin_users.
 *   • إدارة الأسئلة والخيارات (إضافة/تعديل/حذف/ترتيب/تفعيل).
 *   • عرض الردود مع بحث وترتيب وإحصاءات، وتصدير CSV.
 *   • توليد رمز QR للصفحة العامة.
 *
 * الأمان: كل عمليات الكتابة تمر عبر Supabase وتخضع لـ RLS (is_admin).
 * لا نثق بالواجهة؛ الواجهة مجرد واجهة استخدام.
 */

import { getSupabase, isConfigured } from "./supabase-client.js";
import { PUBLIC_SURVEY_URL } from "./config.js";
import { signIn, signOut, isCurrentUserAdmin } from "./auth.js";
import { buildCsv, downloadCsv } from "./csv.js";
import { renderQr, downloadQr } from "./qr.js";

const CHOICE_TYPES = ["single_choice", "multiple_choice", "dropdown"];

const TYPE_LABELS = {
  description: "نص توضيحي",
  text: "نص قصير",
  textarea: "نص طويل",
  number: "رقم",
  single_choice: "اختيار فردي",
  multiple_choice: "اختيار متعدد",
  dropdown: "قائمة منسدلة",
  yes_no: "نعم / لا",
  true_false: "صح / خطأ",
  rating: "تقييم",
  linear_scale: "مقياس خطي",
  date: "تاريخ",
  time: "وقت",
  datetime: "تاريخ ووقت",
  file_upload: "رفع ملف",
  image_upload: "رفع صورة",
};

const SETTINGS_DESCRIPTORS = {
  number: [
    { key: "min", label: "أصغر قيمة", type: "number" },
    { key: "max", label: "أكبر قيمة", type: "number" },
    { key: "step", label: "الخطوة", type: "number" },
  ],
  rating: [
    { key: "scaleMin", label: "أدنى درجة", type: "number", def: 1 },
    { key: "scaleMax", label: "أعلى درجة", type: "number", def: 5 },
  ],
  linear_scale: [
    { key: "min", label: "أصغر قيمة", type: "number", def: 1 },
    { key: "max", label: "أكبر قيمة", type: "number", def: 10 },
    { key: "step", label: "الخطوة", type: "number", def: 1 },
    { key: "minLabel", label: "وصف أدنى قيمة", type: "text" },
    { key: "maxLabel", label: "وصف أعلى قيمة", type: "text" },
  ],
  text: [{ key: "maxLength", label: "أقصى طول", type: "number", def: 500 }],
  textarea: [{ key: "maxLength", label: "أقصى طول", type: "number", def: 2000 }],
  multiple_choice: [
    { key: "minItems", label: "أقل عدد اختيارات", type: "number", def: 1 },
    { key: "maxItems", label: "أكبر عدد اختيارات", type: "number", def: 100 },
  ],
};

const state = {
  supabase: null,
  currentUser: null,
  questions: [],
  responses: [],
  answersByResponse: new Map(),
  columns: [],
  search: "",
  sort: "newest",
};

let questionModal = null;

function $(id) {
  return document.getElementById(id);
}

function showAdminNotice(message, type = "warning") {
  const el = $("adminNotice");
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove("d-none");
}

function hideAdminNotice() {
  const el = $("adminNotice");
  if (el) el.classList.add("d-none");
}

function fmtDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type;
}

function slugify(label) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .slice(0, 60);
  return base || "option";
}

function getQuestionModal() {
  if (!questionModal) {
    if (!window.bootstrap) throw new Error("تعذّر تحميل مكتبة الواجهة (Bootstrap).");
    questionModal = new window.bootstrap.Modal($("questionModal"));
  }
  return questionModal;
}

/* =====================================================================
 * الدخول والخروج
 * ===================================================================== */

function showLoginError(message) {
  const el = $("loginError");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("d-none");
}

function clearLoginError() {
  const el = $("loginError");
  if (el) el.classList.add("d-none");
}

async function handleLogin(event) {
  event.preventDefault();
  clearLoginError();
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) {
    showLoginError("يرجى إدخال البريد الإلكتروني وكلمة المرور.");
    return;
  }

  const button = $("loginButton");
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "جارٍ تسجيل الدخول…";
  try {
    await signIn(email, password);
    const admin = await isCurrentUserAdmin();
    if (!admin) {
      await signOut();
      showLoginError("هذا الحساب لا يملك صلاحية الوصول إلى لوحة التحكم.");
      return;
    }
    await enterApp();
  } catch (err) {
    showLoginError("تعذّر تسجيل الدخول: " + (err.message || "خطأ غير متوقع"));
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

async function handleLogout() {
  try {
    await signOut();
  } finally {
    window.location.reload();
  }
}

async function enterApp() {
  $("authGate").classList.add("d-none");
  $("adminApp").classList.remove("d-none");

  const session = await state.supabase.auth.getSession();
  const email = session?.data?.session?.user?.email || "";
  state.currentUser = session?.data?.session?.user || null;
  const emailEl = $("adminEmail");
  if (emailEl) emailEl.textContent = email;

  await loadQuestions();
  await loadResponses();
  setupQr();
}

/* =====================================================================
 * الأسئلة
 * ===================================================================== */

async function loadQuestions() {
  const sb = state.supabase;
  const { data: questions, error } = await sb
    .from("questions")
    .select("id,title,description,type,is_required,is_active,position,settings")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const list = questions || [];
  const optionsByQuestion = new Map();
  if (list.length) {
    const { data: options, error: oErr } = await sb
      .from("question_options")
      .select("id,question_id,label,value,position,is_active")
      .order("position", { ascending: true });
    if (oErr) throw oErr;
    for (const o of options || []) {
      if (!optionsByQuestion.has(o.question_id)) optionsByQuestion.set(o.question_id, []);
      optionsByQuestion.get(o.question_id).push(o);
    }
  }
  state.questions = list.map((q) => ({ ...q, options: optionsByQuestion.get(q.id) || [] }));
  renderQuestionsList();
  renderStats();
}

function makeManageButton(action, id, icon, title, extraClass = "btn-outline-secondary") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn btn-sm ${extraClass}`;
  btn.dataset.action = action;
  btn.dataset.id = id;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  const i = document.createElement("i");
  i.className = `bi ${icon}`;
  btn.appendChild(i);
  return btn;
}

function renderQuestionsList() {
  const container = $("questionsList");
  container.className = "";
  container.innerHTML = "";

  if (!state.questions.length) {
    container.className = "empty-state card-soft p-3";
    const i = document.createElement("i");
    i.className = "bi bi-list-check";
    const p = document.createElement("p");
    p.className = "mb-0";
    p.textContent = "لا توجد أسئلة بعد. أضف أول سؤال.";
    container.appendChild(i);
    container.appendChild(p);
    return;
  }

  state.questions.forEach((q, index) => {
    const item = document.createElement("div");
    item.className = "question-manage-item" + (q.is_active ? "" : " is-disabled");
    item.dataset.id = q.id;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    const handleIcon = document.createElement("i");
    handleIcon.className = "bi bi-grip-vertical";
    handle.appendChild(handleIcon);
    item.appendChild(handle);

    const body = document.createElement("div");
    body.className = "flex-grow-1";

    const header = document.createElement("div");
    header.className = "d-flex flex-wrap align-items-center gap-2 mb-1";
    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.textContent = typeLabel(q.type);
    header.appendChild(badge);
    if (q.is_required) {
      const req = document.createElement("span");
      req.className = "required-mark";
      req.textContent = "إلزامي";
      header.appendChild(req);
    }
    if (!q.is_active) {
      const off = document.createElement("span");
      off.className = "badge bg-secondary";
      off.textContent = "معطّل";
      header.appendChild(off);
    }
    body.appendChild(header);

    const title = document.createElement("div");
    title.className = "fw-bold";
    title.textContent = q.title;
    body.appendChild(title);

    if (q.description) {
      const desc = document.createElement("div");
      desc.className = "question-help mb-0";
      desc.textContent = q.description;
      body.appendChild(desc);
    }

    if (CHOICE_TYPES.includes(q.type) && q.options.length) {
      const opts = document.createElement("div");
      opts.className = "question-help mb-0 mt-1";
      opts.textContent = "الخيارات: " + q.options.map((o) => o.label).join("، ");
      body.appendChild(opts);
    }

    item.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "d-flex flex-column flex-sm-row gap-1";
    const up = makeManageButton("up", q.id, "bi-arrow-up", "تحريك للأعلى");
    const down = makeManageButton("down", q.id, "bi-arrow-down", "تحريك للأسفل");
    if (index === 0) up.disabled = true;
    if (index === state.questions.length - 1) down.disabled = true;
    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(makeManageButton("edit", q.id, "bi-pencil", "تعديل", "btn-outline-primary"));
    actions.appendChild(
      makeManageButton(
        "toggle",
        q.id,
        q.is_active ? "bi-toggle-on" : "bi-toggle-off",
        q.is_active ? "تعطيل" : "تفعيل",
        q.is_active ? "btn-outline-success" : "btn-outline-secondary"
      )
    );
    actions.appendChild(makeManageButton("delete", q.id, "bi-trash", "حذف", "btn-outline-danger"));
    item.appendChild(actions);

    container.appendChild(item);
  });
}

async function moveQuestion(id, direction) {
  const index = state.questions.findIndex((q) => q.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= state.questions.length) return;

  const current = state.questions[index];
  const target = state.questions[targetIndex];
  let a = current.position;
  let b = target.position;
  if (a === b) {
    a = index;
    b = targetIndex;
  }

  const sb = state.supabase;
  const { error: e1 } = await sb.from("questions").update({ position: b }).eq("id", current.id);
  if (e1) throw e1;
  const { error: e2 } = await sb.from("questions").update({ position: a }).eq("id", target.id);
  if (e2) throw e2;

  await loadQuestions();
}

async function toggleQuestion(id) {
  const q = state.questions.find((x) => x.id === id);
  if (!q) return;
  const { error } = await state.supabase
    .from("questions")
    .update({ is_active: !q.is_active })
    .eq("id", id);
  if (error) throw error;
  await loadQuestions();
}

async function deleteQuestion(id) {
  const q = state.questions.find((x) => x.id === id);
  if (!q) return;
  const ok = window.confirm(`حذف السؤال «${q.title}»؟ لا يمكن التراجع.`);
  if (!ok) return;
  const { error } = await state.supabase.from("questions").delete().eq("id", id);
  if (error) throw error;
  await loadQuestions();
}

function renderStats() {
  const qEl = $("statQuestions");
  if (qEl) qEl.textContent = String(state.questions.length);
}

/* =====================================================================
 * نافذة السؤال
 * ===================================================================== */

function clearModalError() {
  const el = $("questionFormError");
  if (el) el.classList.add("d-none");
}

function showModalError(message) {
  const el = $("questionFormError");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("d-none");
}

function addOptionRow(label = "", value = "") {
  const list = $("optionsList");
  const row = document.createElement("div");
  row.className = "option-row d-flex gap-2 mb-2";

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.className = "form-control opt-label";
  labelInput.placeholder = "نص الخيار";
  labelInput.maxLength = 500;
  labelInput.value = label;

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "form-control opt-value";
  valueInput.placeholder = "القيمة (بالإنجليزية)";
  valueInput.maxLength = 200;
  valueInput.value = value;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-outline-danger";
  remove.title = "إزالة الخيار";
  remove.dataset.action = "remove-option";
  const i = document.createElement("i");
  i.className = "bi bi-x-lg";
  remove.appendChild(i);

  row.appendChild(labelInput);
  row.appendChild(valueInput);
  row.appendChild(remove);
  list.appendChild(row);
}

function collectOptions() {
  const rows = Array.from(document.querySelectorAll("#optionsList .option-row"));
  const used = new Set();
  const options = [];
  for (const row of rows) {
    const label = row.querySelector(".opt-label").value.trim();
    if (!label) continue;
    let value = row.querySelector(".opt-value").value.trim() || slugify(label);
    let candidate = value;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${value}_${n}`;
      n += 1;
    }
    used.add(candidate);
    options.push({ label, value: candidate });
  }
  return options;
}

function renderTypeFields(type, settings = {}) {
  const fieldsWrap = $("settingsFields");
  const optionsSection = $("optionsSection");
  fieldsWrap.innerHTML = "";

  const descriptors = SETTINGS_DESCRIPTORS[type] || [];
  if (!descriptors.length) {
    fieldsWrap.classList.add("d-none");
  } else {
    fieldsWrap.classList.remove("d-none");
    for (const d of descriptors) {
      const col = document.createElement("div");
      col.className = "col-12 col-md-4";
      const label = document.createElement("label");
      label.className = "form-label";
      label.setAttribute("for", "set_" + d.key);
      label.textContent = d.label;
      const input = document.createElement("input");
      input.type = d.type;
      input.className = "form-control";
      input.id = "set_" + d.key;
      input.dataset.settingKey = d.key;
      const existing = settings[d.key];
      if (existing !== undefined && existing !== null && existing !== "") {
        input.value = existing;
      } else if (d.def !== undefined) {
        input.placeholder = String(d.def);
      }
      col.appendChild(label);
      col.appendChild(input);
      fieldsWrap.appendChild(col);
    }
  }

  const isChoice = CHOICE_TYPES.includes(type);
  optionsSection.classList.toggle("d-none", !isChoice);
  if (isChoice && !document.querySelector("#optionsList .option-row")) {
    addOptionRow();
  }
}

function collectSettings(type) {
  const descriptors = SETTINGS_DESCRIPTORS[type] || [];
  const settings = {};
  for (const d of descriptors) {
    const input = document.getElementById("set_" + d.key);
    if (!input) continue;
    const raw = input.value.trim();
    if (raw === "") {
      if (d.def !== undefined) settings[d.key] = d.def;
      continue;
    }
    settings[d.key] = d.type === "number" ? Number(raw) : raw;
  }
  return settings;
}

function openQuestionModal(question) {
  clearModalError();
  const modal = getQuestionModal();

  $("questionId").value = question?.id || "";
  $("questionModalLabel").textContent = question ? "تعديل سؤال" : "إضافة سؤال";
  $("questionTitle").value = question?.title || "";
  $("questionDescription").value = question?.description || "";
  $("questionType").value = question?.type || "text";
  $("questionRequired").checked = Boolean(question?.is_required);
  $("questionActive").checked = question ? Boolean(question.is_active) : true;

  const list = $("optionsList");
  list.innerHTML = "";
  if (question && CHOICE_TYPES.includes(question.type)) {
    for (const o of question.options || []) {
      addOptionRow(o.label, o.value);
    }
  }

  renderTypeFields($("questionType").value, question?.settings || {});
  modal.show();
}

async function saveQuestion(event) {
  event.preventDefault();
  clearModalError();

  const id = $("questionId").value || null;
  const title = $("questionTitle").value.trim();
  const description = $("questionDescription").value.trim() || null;
  const type = $("questionType").value;
  const isRequired = type === "description" ? false : $("questionRequired").checked;
  const isActive = $("questionActive").checked;

  if (!title) {
    showModalError("نص السؤال مطلوب.");
    return;
  }

  const options = CHOICE_TYPES.includes(type) ? collectOptions() : [];
  if (CHOICE_TYPES.includes(type) && options.length === 0) {
    showModalError("أضف خيارًا واحدًا على الأقل.");
    return;
  }

  const settings = collectSettings(type);
  const saveButton = $("saveQuestionButton");
  saveButton.disabled = true;

  try {
    const sb = state.supabase;
    let questionId = id;

    if (id) {
      const { error } = await sb
        .from("questions")
        .update({ title, description, type, is_required: isRequired, is_active: isActive, settings })
        .eq("id", id);
      if (error) throw error;
      const { error: delErr } = await sb.from("question_options").delete().eq("question_id", id);
      if (delErr) throw delErr;
    } else {
      const maxPos = state.questions.reduce((m, q) => Math.max(m, q.position ?? 0), -1);
      const { data, error } = await sb
        .from("questions")
        .insert({
          title,
          description,
          type,
          is_required: isRequired,
          is_active: isActive,
          settings,
          position: maxPos + 1,
          created_by: state.currentUser?.id || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      questionId = data.id;
    }

    if (options.length) {
      const rows = options.map((o, i) => ({
        question_id: questionId,
        label: o.label,
        value: o.value,
        position: i,
        is_active: true,
      }));
      const { error: insErr } = await sb.from("question_options").insert(rows);
      if (insErr) {
        if (!id) await sb.from("questions").delete().eq("id", questionId);
        throw insErr;
      }
    }

    getQuestionModal().hide();
    await loadQuestions();
    showAdminNotice("تم حفظ السؤال بنجاح.", "success");
  } catch (err) {
    showModalError("تعذّر حفظ السؤال: " + (err.message || "خطأ غير متوقع"));
  } finally {
    saveButton.disabled = false;
  }
}

/* =====================================================================
 * الردود
 * ===================================================================== */

function formatAnswer(a) {
  switch (a.question_type) {
    case "text":
    case "textarea":
    case "email":
    case "url":
    case "single_choice":
    case "dropdown":
      return a.value_label || a.value_text || "";
    case "multiple_choice":
      return Array.isArray(a.value_json)
        ? a.value_json.map((x) => x.label || x.value).join("، ")
        : "";
    case "yes_no":
      return a.value_bool === true ? "نعم" : a.value_bool === false ? "لا" : "";
    case "true_false":
      return a.value_bool === true ? "صح" : a.value_bool === false ? "خطأ" : "";
    case "number":
    case "rating":
    case "linear_scale":
      return a.value_number != null ? String(a.value_number) : "";
    case "date":
      return a.value_date || "";
    case "time":
      return a.value_time || "";
    case "datetime":
      return a.value_timestamptz ? fmtDateTime(a.value_timestamptz) : "";
    case "file_upload":
    case "image_upload":
      return Array.isArray(a.value_json)
        ? a.value_json.map((x) => x.filename).filter(Boolean).join("، ")
        : "";
    default:
      return "";
  }
}

async function loadResponses() {
  const sb = state.supabase;

  const { count, error: countErr } = await sb
    .from("responses")
    .select("id", { count: "exact", head: true });
  if (countErr) throw countErr;

  const { data: responses, error } = await sb
    .from("responses")
    .select("id,status,submitted_at")
    .order("submitted_at", { ascending: false })
    .limit(2000);
  if (error) throw error;

  const list = responses || [];
  const answersByResponse = new Map();
  const columnMap = new Map();

  if (list.length) {
    const ids = list.map((r) => r.id);
    const { data: answers, error: aErr } = await sb
      .from("response_answers")
      .select(
        "response_id,question_id,question_type,question_title,question_position,value_text,value_label,value_number,value_bool,value_date,value_time,value_timestamptz,value_json"
      )
      .in("response_id", ids);
    if (aErr) throw aErr;

    for (const a of answers || []) {
      if (!answersByResponse.has(a.response_id)) answersByResponse.set(a.response_id, new Map());
      answersByResponse.get(a.response_id).set(a.question_id || "t:" + a.question_title, a);

      const key = a.question_id || "t:" + a.question_title;
      if (!columnMap.has(key)) {
        columnMap.set(key, {
          key,
          title: a.question_title,
          position: a.question_position ?? 9999,
          type: a.question_type,
        });
      }
    }
  }

  state.responses = list.map((r) => {
    const answerMap = answersByResponse.get(r.id) || new Map();
    return { ...r, _answers: answerMap };
  });
  state.answersByResponse = answersByResponse;
  state.columns = Array.from(columnMap.values()).sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.title.localeCompare(b.title, "ar");
  });

  for (const r of state.responses) {
    const parts = [fmtDateTime(r.submitted_at)];
    for (const c of state.columns) {
      const a = r._answers.get(c.key);
      parts.push(a ? formatAnswer(a) : "");
    }
    r._search = parts.join(" ").toLowerCase();
  }

  renderResponsesTable();
  renderResponsesStats(count ?? list.length);
}

function renderResponsesStats(total) {
  const totalEl = $("statResponses");
  if (totalEl) totalEl.textContent = String(total);

  const updatedEl = $("statUpdated");
  if (updatedEl) {
    const latest = state.responses.reduce((max, r) => {
      const t = new Date(r.submitted_at).getTime();
      return Number.isFinite(t) && t > max ? t : max;
    }, 0);
    updatedEl.textContent = latest ? fmtDateTime(new Date(latest).toISOString()) : "—";
  }
}

function visibleResponses() {
  let list = state.responses.slice();
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((r) => r._search.includes(q));
  }
  list.sort((a, b) => {
    const ta = new Date(a.submitted_at).getTime();
    const tb = new Date(b.submitted_at).getTime();
    return state.sort === "oldest" ? ta - tb : tb - ta;
  });
  return list;
}

function renderResponsesTable() {
  const head = $("responsesHead");
  const body = $("responsesBody");
  head.innerHTML = "";
  body.innerHTML = "";

  const thIndex = document.createElement("th");
  thIndex.textContent = "#";
  head.appendChild(thIndex);
  const thDate = document.createElement("th");
  thDate.textContent = "التاريخ";
  head.appendChild(thDate);
  for (const c of state.columns) {
    const th = document.createElement("th");
    th.textContent = c.title;
    th.title = c.title;
    head.appendChild(th);
  }
  const thStatus = document.createElement("th");
  thStatus.textContent = "الحالة";
  head.appendChild(thStatus);

  const list = visibleResponses();
  if (!list.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = state.columns.length + 3;
    td.className = "text-center text-muted py-4";
    td.textContent = state.responses.length
      ? "لا توجد نتائج مطابقة للبحث."
      : "لا توجد ردود بعد.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  list.forEach((r, index) => {
    const tr = document.createElement("tr");
    const tdIndex = document.createElement("td");
    tdIndex.textContent = String(index + 1);
    tr.appendChild(tdIndex);

    const tdDate = document.createElement("td");
    tdDate.className = "text-nowrap";
    tdDate.textContent = fmtDateTime(r.submitted_at);
    tr.appendChild(tdDate);

    for (const c of state.columns) {
      const td = document.createElement("td");
      const a = r._answers.get(c.key);
      td.textContent = a ? formatAnswer(a) : "";
      tr.appendChild(td);
    }

    const tdStatus = document.createElement("td");
    tdStatus.textContent = r.status === "void" ? "ملغاة" : "مُرسَلة";
    tr.appendChild(tdStatus);

    body.appendChild(tr);
  });
}

function exportCsv() {
  const list = visibleResponses();
  const headers = ["#", "التاريخ", ...state.columns.map((c) => c.title), "الحالة"];
  const rows = list.map((r, index) => {
    const row = [index + 1, fmtDateTime(r.submitted_at)];
    for (const c of state.columns) {
      const a = r._answers.get(c.key);
      row.push(a ? formatAnswer(a) : "");
    }
    row.push(r.status === "void" ? "ملغاة" : "مُرسَلة");
    return row;
  });

  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  downloadCsv(`responses-${stamp}.csv`, buildCsv(headers, rows));
}

/* =====================================================================
 * رمز QR
 * ===================================================================== */

function setupQr() {
  const urlInput = $("qrUrl");
  if (urlInput && !urlInput.value && PUBLIC_SURVEY_URL) {
    urlInput.value = PUBLIC_SURVEY_URL;
  }

  const generate = $("generateQrButton");
  const download = $("downloadQrButton");

  generate?.addEventListener("click", async () => {
    try {
      await renderQr($("qrContainer"), urlInput.value);
      if (download) download.disabled = false;
      hideAdminNotice();
    } catch (err) {
      showAdminNotice(err.message || "تعذّر توليد رمز QR.", "danger");
    }
  });

  download?.addEventListener("click", () => {
    try {
      downloadQr("youth-survey-qr.png");
    } catch (err) {
      showAdminNotice(err.message || "تعذّر تنزيل الرمز.", "danger");
    }
  });
}

/* =====================================================================
 * الربط والأحداث
 * ===================================================================== */

function bindEvents() {
  $("loginForm")?.addEventListener("submit", handleLogin);
  $("logoutButton")?.addEventListener("click", handleLogout);

  $("addQuestionButton")?.addEventListener("click", () => openQuestionModal(null));
  $("questionForm")?.addEventListener("submit", saveQuestion);
  $("questionType")?.addEventListener("change", (e) => {
    renderTypeFields(e.target.value, collectSettings(e.target.value));
  });
  $("addOptionButton")?.addEventListener("click", () => addOptionRow());

  $("optionsList")?.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="remove-option"]');
    if (btn) btn.closest(".option-row").remove();
  });

  $("questionsList")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    try {
      if (action === "edit") {
        openQuestionModal(state.questions.find((q) => q.id === id));
      } else if (action === "up") {
        await moveQuestion(id, -1);
      } else if (action === "down") {
        await moveQuestion(id, 1);
      } else if (action === "toggle") {
        await toggleQuestion(id);
      } else if (action === "delete") {
        await deleteQuestion(id);
      }
    } catch (err) {
      showAdminNotice("تعذّر تنفيذ العملية: " + (err.message || "خطأ غير متوقع"), "danger");
    }
  });

  $("responsesSearch")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    renderResponsesTable();
  });

  $("responsesSort")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderResponsesTable();
  });

  $("exportCsvButton")?.addEventListener("click", () => {
    try {
      exportCsv();
    } catch (err) {
      showAdminNotice("تعذّر تصدير CSV: " + (err.message || "خطأ غير متوقع"), "danger");
    }
  });

  document.querySelectorAll('[data-bs-toggle="pill"]').forEach((tab) => {
    tab.addEventListener("shown.bs.tab", async (e) => {
      const target = e.target.getAttribute("data-bs-target");
      try {
        if (target === "#tab-responses") await loadResponses();
        if (target === "#tab-questions") await loadQuestions();
      } catch (err) {
        showAdminNotice("تعذّر تحديث البيانات: " + (err.message || "خطأ غير متوقع"), "danger");
      }
    });
  });
}

async function init() {
  bindEvents();

  if (!isConfigured) {
    const notice = $("configNotice");
    if (notice) {
      notice.textContent =
        "لم يتم إعداد الاتصال بـ Supabase بعد. أضف SUPABASE_URL و SUPABASE_ANON_KEY في assets/js/config.js.";
      notice.classList.remove("d-none");
    }
    const loginButton = $("loginButton");
    if (loginButton) loginButton.disabled = true;
    return;
  }

  try {
    state.supabase = await getSupabase();
    const { data } = await state.supabase.auth.getSession();
    const session = data?.session;
    if (session && (await isCurrentUserAdmin())) {
      await enterApp();
    } else {
      if (session) await signOut();
      $("authGate").classList.remove("d-none");
      $("adminApp").classList.add("d-none");
    }
  } catch (err) {
    showLoginError("تعذّر تهيئة لوحة التحكم: " + (err.message || "خطأ غير متوقع"));
  }
}

document.addEventListener("DOMContentLoaded", init);
