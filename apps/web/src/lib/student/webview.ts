/**
 * Phát hiện trình duyệt nhúng trong ứng dụng (webview) — thường chặn hoặc làm hỏng camera (getUserMedia).
 * Trả tên ứng dụng để hướng dẫn "mở bằng Chrome/Safari"; null nếu là trình duyệt thường.
 */
const APPS: [RegExp, string][] = [
  [/\bZalo\b/i, "Zalo"],
  [/MessengerForiOS|\bMessenger\b|FB_IAB\/MESSENGER|Orca-Android/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/\bLine\//i, "LINE"],
];

export function detectInAppBrowser(ua: string): string | null {
  for (const [re, name] of APPS) if (re.test(ua)) return name;
  // WebView Android chung: có "; wv)" trong chuỗi nhận dạng
  if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) return "ứng dụng";
  return null;
}

export function inAppBrowserHint(app: string): string {
  return `Bạn đang mở trang trong ${app === "ứng dụng" ? "một ứng dụng" : `ứng dụng ${app}`} — camera có thể không hoạt động. Hãy mở trang bằng Chrome (Android) hoặc Safari (iPhone): bấm nút ⋯ ở góc màn hình → "Mở bằng trình duyệt".`;
}
