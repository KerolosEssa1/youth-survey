/*
 * واجهة الاستبيان العامة (index.html).
 *
 * تحمّل الأسئلة النشطة من Supabase وتعرضها حسب النوع، تتحقق من الإجابات،
 * وترسلها بشكل مجهول الهوية عبر RPC submit_response.
 */

import { getSupabase, isConfigured } from "./supabase-client.js";

const CHOICE_TYPES = ["single_choice", "multiple_choice", "dropdown"];
const UNSUPPORTED_TYPES = ["file_upload", "image_upload"];

const state = {
  questions: [],
  optionsByQuestion: new Map(),
  submitting: false,
};

function rootEl() {
  return document.getElementById("surveyRoot");
}

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showNotice(message, type = "warning") {
  const notice = document.getElementById("configNotice");
  if (!notice) return;
  notice.className = `alert alert-${type}`;
  notice.textContent = message;
  notice.classList.remove("d-none");
}

function hideLoading() {
  const loading = document.getElementById("loadingState");
  if (loading) loading.classList.add("d-none");
}

function setProgress(done, total) {
  const wrap = document.getElementById("progressWrap");
  const bar = document.getElementById("progressBar");
  if (!wrap || !bar) return;
  if (total <= 0) {
    wrap.classList.add("d-none");
    return;
  }
  wrap.classList.remove("d-none");
  const pct = Math.round((done / total) * 100);
  bar.style.width = pct + "%";
  bar.setAttribute("aria-valuenow", String(pct));
}

async function fetchQuestions(supabase) {
  const { data: questions, error } = await supabase
    .from("questions")
    .select("id,title,description,type,is_required,position,settings")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const list = questions || [];
  const optionsByQuestion = new Map();
  const choiceIds = list.filter((q) => CHOICE_TYPES.includes(q.type)).map((q) => q.id);

  if (choiceIds.length) {
    const { data: options, error: oErr } = await supabase
      .from("question_options")
      .select("question_id,label,value,position")
      .in("question_id", choiceIds)
      .eq("is_active", true)
      .order("position", { ascending: true });
    if (oErr) throw oErr;
    for (const o of options || []) {
      if (!optionsByQuestion.has(o.question_id)) optionsByQuestion.set(o.question_id, []);
      optionsByQuestion.get(o.question_id).push(o);
    }
  }

  return { list, optionsByQuestion };
}

function fieldName(q) {
  return "q_" + q.id;
}

function makeInput(q, type, attrs = {}) {
  const input = document.createElement("input");
  input.type = type;
  input.className = "form-control";
  input.name = fieldName(q);
  input.id = fieldName(q) + "_" + (attrs.key || Math.random().toString(36).slice(2, 6));
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "key") continue;
    if (v === undefined || v === null || v === false) continue;
    input.setAttribute(k, String(v));
  }
  return input;
}

function renderChoice(q, options, multiple) {
  const wrap = create("div", "option-list");
  const inputType = multiple ? "checkbox" : "radio";
  (options || []).forEach((o, i) => {
    const id = `${fieldName(q)}_opt_${i}`;
    const check = create("div", "form-check");
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = inputType;
    input.name = fieldName(q);
    input.id = id;
    input.value = o.value;
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = o.label;
    check.appendChild(input);
    check.appendChild(label);
    wrap.appendChild(check);
  });
  if (!options || options.length === 0) {
    wrap.appendChild(create("p", "question-help mb-0", "لا توجد خيارات متاحة حاليًا."));
  }
  return wrap;
}

function renderRadio(q, entries) {
  const wrap = create("div", "option-list");
  entries.forEach((entry, i) => {
    const id = `${fieldName(q)}_v_${i}`;
    const check = create("div", "form-check");
    const input = document.createElement("input");
    input.className = "form-check-input";
    input.type = "radio";
    input.name = fieldName(q);
    input.id = id;
    input.value = String(entry.value);
    const label = document.createElement("label");
    label.className = "form-check-label";
    label.setAttribute("for", id);
    label.textContent = entry.label;
    check.appendChild(input);
    check.appendChild(label);
    wrap.appendChild(check);
  });
  return wrap;
}

function renderRating(q, min, max) {
  const wrap = create("div", "rating-scale");
  for (let n = min; n <= max; n += 1) {
    const id = `${fieldName(q)}_r_${n}`;
    const item = create("div", "rating-item");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = fieldName(q);
    input.id = id;
    input.value = String(n);
    const label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = String(n);
    item.appendChild(input);
    item.appendChild(label);
    wrap.appendChild(item);
  }
  return wrap;
}

function renderLinearScale(q, settings) {
  const min = numOr(settings.min, 1);
  const max = numOr(settings.max, 10);
  const step = numOr(settings.step, 1);
  const wrap = create("div");
  const range = document.createElement("input");
  range.type = "range";
  range.className = "form-range";
  range.name = fieldName(q);
  range.id = fieldName(q) + "_range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(min);
  const out = create("div", "d-flex justify-content-between small text-muted mt-1");
  out.appendChild(create("span", null, settings.minLabel || String(min)));
  const current = create("strong", null, String(min));
  out.appendChild(current);
  out.appendChild(create("span", null, settings.maxLabel || String(max)));
  range.addEventListener("input", () => {
    range.dataset.touched = "1";
    current.textContent = range.value;
  });
  wrap.appendChild(range);
  wrap.appendChild(out);
  return wrap;
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function renderQuestion(q) {
  const card = create("div", "question-card");
  card.dataset.questionId = q.id;
  card.dataset.type = q.type;

  if (q.type === "description") {
    card.appendChild(create("h2", "h5 fw-bold mb-2", q.title));
    if (q.description) card.appendChild(create("p", "question-help mb-0", q.description));
    return card;
  }

  const label = create("label", "question-label");
  label.textContent = q.title;
  if (q.is_required) {
    const mark = create("span", "required-mark", " *");
    mark.setAttribute("aria-hidden", "true");
    label.appendChild(mark);
  }
  card.appendChild(label);
  if (q.description) card.appendChild(create("p", "question-help", q.description));

  const settings = q.settings || {};
  const options = state.optionsByQuestion.get(q.id) || [];

  switch (q.type) {
    case "textarea":
      card.appendChild(makeInput(q, "textarea", { rows: 4, maxlength: settings.maxLength || 2000 }));
      break;
    case "text":
    case "email":
    case "url":
      card.appendChild(
        makeInput(q, q.type === "email" ? "email" : q.type === "url" ? "url" : "text", {
          inputmode: q.type === "text" ? "text" : undefined,
          maxlength: settings.maxLength || 500,
        })
      );
      break;
    case "number":
      card.appendChild(
        makeInput(q, "number", {
          min: settings.min,
          max: settings.max,
          step: settings.step || "any",
          inputmode: "decimal",
        })
      );
      break;
    case "single_choice":
      card.appendChild(renderChoice(q, options, false));
      break;
    case "dropdown": {
      const select = document.createElement("select");
      select.className = "form-select";
      select.name = fieldName(q);
      select.id = fieldName(q) + "_select";
      select.appendChild(create("option", null, "— اختر —")).value = "";
      (options.length ? options : []).forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        select.appendChild(opt);
      });
      card.appendChild(select);
      break;
    }
    case "multiple_choice":
      card.appendChild(renderChoice(q, options, true));
      break;
    case "yes_no":
      card.appendChild(
        renderRadio(q, [
          { label: "نعم", value: true },
          { label: "لا", value: false },
        ])
      );
      break;
    case "true_false":
      card.appendChild(
        renderRadio(q, [
          { label: "صح", value: true },
          { label: "خطأ", value: false },
        ])
      );
      break;
    case "rating":
      card.appendChild(renderRating(q, numOr(settings.scaleMin, 1), numOr(settings.scaleMax, 5)));
      break;
    case "linear_scale":
      card.appendChild(renderLinearScale(q, settings));
      break;
    case "date":
      card.appendChild(makeInput(q, "date"));
      break;
    case "time":
      card.appendChild(makeInput(q, "time"));
      break;
    case "datetime":
      card.appendChild(makeInput(q, "datetime-local"));
      break;
    default:
      card.appendChild(
        create(
          "p",
          "question-help mb-0 text-danger",
          UNSUPPORTED_TYPES.includes(q.type)
            ? "هذا النوع (رفع ملف/صورة) غير متاح حاليًا."
            : "نوع سؤال غير مدعوم."
        )
      );
  }

  return card;
}

function renderForm() {
  const root = rootEl();
  root.innerHTML = "";

  const form = document.createElement("form");
  form.id = "surveyForm";
  form.noValidate = true;

  state.questions.forEach((q) => form.appendChild(renderQuestion(q)));

  const actions = create("div", "d-flex justify-content-between align-items-center gap-2 mt-3");
  const hint = create("span", "text-muted small", "لن يتم طلب أي بيانات شخصية.");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-brand btn-lg";
  submit.id = "submitButton";
  submit.textContent = "إرسال الإجابات";
  actions.appendChild(hint);
  actions.appendChild(submit);
  form.appendChild(actions);

  form.addEventListener("submit", onSubmit);
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);

  root.appendChild(form);
  updateProgress();
}

function answeredCount() {
  let answered = 0;
  for (const q of state.questions) {
    if (q.type === "description") continue;
    const card = rootEl().querySelector(`[data-question-id="${q.id}"]`);
    if (card && !isEmptyValue(readValue(q, card))) answered += 1;
  }
  return answered;
}

function answerableCount() {
  return state.questions.filter((q) => q.type !== "description").length;
}

function updateProgress() {
  setProgress(answeredCount(), answerableCount());
}

function readValue(q, card) {
  if (!card) return null;
  const name = fieldName(q);
  switch (q.type) {
    case "text":
    case "textarea":
    case "email":
    case "url": {
      const input = card.querySelector(`[name="${name}"]`);
      const v = input ? input.value.trim() : "";
      return v === "" ? null : v;
    }
    case "number":
    case "rating": {
      const checked = card.querySelector(`[name="${name}"]:checked`);
      if (q.type === "number") {
        const input = card.querySelector(`[name="${name}"]`);
        if (!input || input.value.trim() === "") return null;
        const n = Number(input.value);
        return Number.isFinite(n) ? n : null;
      }
      return checked ? Number(checked.value) : null;
    }
    case "linear_scale": {
      const input = card.querySelector(`[name="${name}"]`);
      if (!input || input.dataset.touched !== "1") return null;
      const n = Number(input.value);
      return Number.isFinite(n) ? n : null;
    }
    case "single_choice":
    case "dropdown": {
      const checked = card.querySelector(`[name="${name}"]:checked`);
      if (checked) return checked.value;
      const select = card.querySelector(`[name="${name}"]`);
      if (select && select.value) return select.value;
      return null;
    }
    case "multiple_choice": {
      const checked = Array.from(card.querySelectorAll(`[name="${name}"]:checked`));
      return checked.length ? checked.map((c) => c.value) : null;
    }
    case "yes_no":
    case "true_false": {
      const checked = card.querySelector(`[name="${name}"]:checked`);
      return checked ? checked.value === "true" : null;
    }
    case "date":
    case "time":
    case "datetime": {
      const input = card.querySelector(`[name="${name}"]`);
      return input && input.value ? input.value : null;
    }
    default:
      return null;
  }
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateValue(q, value) {
  const settings = q.settings || {};
  if (q.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value)) {
    return "صيغة البريد الإلكتروني غير صحيحة.";
  }
  if (q.type === "url" && !/^https?:\/\//i.test(value)) {
    return "الرابط يجب أن يبدأ بـ http:// أو https://.";
  }
  if (q.type === "number") {
    const min = Number(settings.min);
    const max = Number(settings.max);
    if (Number.isFinite(min) && value < min) return `أصغر قيمة مسموحة ${min}.`;
    if (Number.isFinite(max) && value > max) return `أكبر قيمة مسموحة ${max}.`;
  }
  if (q.type === "rating") {
    const min = numOr(settings.scaleMin, 1);
    const max = numOr(settings.scaleMax, 5);
    if (!Number.isInteger(value) || value < min || value > max) {
      return `اختر قيمة بين ${min} و${max}.`;
    }
  }
  if (q.type === "linear_scale") {
    const min = numOr(settings.min, 1);
    const max = numOr(settings.max, 10);
    if (value < min || value > max) return `اختر قيمة بين ${min} و${max}.`;
  }
  if (q.type === "multiple_choice") {
    const min = numOr(settings.minItems, 1);
    const max = numOr(settings.maxItems, 100);
    if (value.length < min) return `اختر ${min} على الأقل.`;
    if (value.length > max) return `اختر ${max} كحد أقصى.`;
  }
  return null;
}

function markError(card) {
  if (card) card.classList.add("is-invalid");
}

function clearErrors() {
  rootEl().querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));
}

function setSubmitEnabled(enabled, text) {
  const btn = document.getElementById("submitButton");
  if (!btn) return;
  btn.disabled = !enabled;
  if (text) btn.textContent = text;
}

function collectAnswers() {
  const answers = [];
  const errors = [];
  for (const q of state.questions) {
    if (q.type === "description") continue;
    const card = rootEl().querySelector(`[data-question-id="${q.id}"]`);
    const value = readValue(q, card);
    if (isEmptyValue(value)) {
      if (q.is_required) errors.push(card);
      continue;
    }
    const message = validateValue(q, value);
    if (message) {
      errors.push(card);
      continue;
    }
    answers.push({ question_id: q.id, value });
  }
  return { answers, errors };
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;

  clearErrors();
  const { answers, errors } = collectAnswers();
  if (errors.length) {
    const firstCard = errors[0];
    errors.forEach(markError);
    showNotice("يرجى إكمال الحقول الإلزامية وتصحيح القيم المميّزة.", "danger");
    if (firstCard) firstCard.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  state.submitting = true;
  setSubmitEnabled(false, "جارٍ الإرسال…");
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("submit_response", { p_answers: answers });
    if (error) throw error;
    renderSuccess();
  } catch (err) {
    showNotice("تعذّر إرسال إجاباتك: " + (err.message || "خطأ غير متوقع") + ". حاول مرة أخرى.", "danger");
    setSubmitEnabled(true, "إرسال الإجابات");
  } finally {
    state.submitting = false;
  }
}

function renderSuccess() {
  setProgress(1, 1);
  const root = rootEl();
  root.innerHTML = "";
  const card = create("div", "card-soft p-4 p-md-5 text-center");
  card.appendChild(create("div", "display-5 mb-2", "🎉"));
  card.appendChild(create("h2", "h4 fw-bold mb-2", "تم استلام إجاباتك بنجاح"));
  card.appendChild(
    create(
      "p",
      "text-muted mb-4",
      "شكرًا لمشاركتك! تم تسجيل إجاباتك بشكل مجهول الهوية تمامًا."
    )
  );
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn-brand";
  again.textContent = "تعبئة استجابة جديدة";
  again.addEventListener("click", () => window.location.reload());
  card.appendChild(again);
  root.appendChild(card);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function init() {
  if (!isConfigured) {
    hideLoading();
    showNotice(
      "لم يتم إعداد الاتصال بـ Supabase بعد. أضف SUPABASE_URL و SUPABASE_ANON_KEY في assets/js/config.js.",
      "warning"
    );
    return;
  }

  try {
    const supabase = await getSupabase();
    const { list, optionsByQuestion } = await fetchQuestions(supabase);
    state.questions = list;
    state.optionsByQuestion = optionsByQuestion;
    hideLoading();

    if (!list.length) {
      const root = rootEl();
      root.innerHTML = "";
      const empty = create("div", "empty-state card-soft p-4");
      empty.appendChild(create("i", "bi bi-clipboard-x"));
      empty.appendChild(create("p", "mb-0", "لا توجد أسئلة متاحة حاليًا. يرجى المحاولة لاحقًا."));
      root.appendChild(empty);
      return;
    }

    renderForm();
  } catch (err) {
    hideLoading();
    showNotice("تعذّر تحميل الاستبيان: " + (err.message || "خطأ غير متوقع"), "danger");
  }
}

document.addEventListener("DOMContentLoaded", init);
