/*
 * تصدير الردود إلى CSV متوافق مع Microsoft Excel.
 *
 * ملاحظة الترميز: نضيف UTF-8 BOM (\uFEFF) في بداية الملف حتى يعرض Excel
 * النصوص العربية بشكل صحيح.
 */

const UTF8_BOM = "\uFEFF";

/**
 * يحوّل قيمة خلية إلى نص CSV آمن (يحيط بعلامات اقتباس عند الحاجة).
 */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * يبني محتوى CSV من ترويسة وصفوف.
 * headers: string[]
 * rows: (string|number|null)[][]
 */
export function buildCsv(headers, rows) {
  const lines = [];
  lines.push((headers || []).map(escapeCell).join(","));
  for (const row of rows || []) {
    lines.push((row || []).map(escapeCell).join(","));
  }
  // سطران قبل BOM: بعض أدوات Excel أفضل مع نهاية سطر موحّدة.
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
