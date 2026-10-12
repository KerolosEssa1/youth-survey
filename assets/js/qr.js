/*
 * توليد رمز QR للرابط النهائي المنشور للصفحة العامة مع إمكانية تنزيله.
 *
 * يُحمَّل مصدر التوليد (qrcode — رخصة MIT) من CDN بشكل كسول عند أول استخدام
 * فقط، حتى لا نضيف أي طلب شبكة على الصفحات التي لا تحتاج QR.
 */

const QR_LIB_URL = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm";

let libPromise = null;
let lastCanvas = null;

function loadQrLib() {
  if (!libPromise) {
    libPromise = import(QR_LIB_URL);
  }
  return libPromise;
}

/**
 * يولّد رمز QR داخل الحاوية المحددة ويعيد عنصر canvas.
 */
export async function renderQr(container, url) {
  const value = String(url || "").trim();
  if (!value) throw new Error("الرجاء إدخال رابط صالح.");

  const QRCode = await loadQrLib();
  if (!QRCode || typeof QRCode.toCanvas !== "function") {
    throw new Error("تعذّر تحميل مكتبة رمز QR.");
  }

  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);

  await QRCode.toCanvas(canvas, value, { width: 240, margin: 2 });

  lastCanvas = canvas;
  return canvas;
}

/**
 * ينزّل صورة رمز QR الأخيرة كملف PNG.
 */
export function downloadQr(filename = "survey-qr.png") {
  if (!lastCanvas) throw new Error("لا يوجد رمز لتَنزيله.");
  const link = document.createElement("a");
  link.href = lastCanvas.toDataURL("image/png");
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
