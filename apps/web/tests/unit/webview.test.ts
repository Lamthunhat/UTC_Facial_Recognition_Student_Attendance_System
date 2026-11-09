import { describe, expect, it } from "vitest";
import { detectInAppBrowser } from "@/lib/student/webview";

/** Trình duyệt nhúng trong ứng dụng (webview) thường chặn hoặc làm hỏng camera → hướng dẫn mở bằng Chrome/Safari. */
const UA = {
  zalo: "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 Zalo android/12100766 ZaloTheme/light",
  facebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.33.116;FBBV/1]",
  messenger: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/440.0]",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0.0.32.112",
  tiktok: "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6",
  androidWv: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0 Mobile Safari/537.36",
  chrome: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
  safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
};

describe("detectInAppBrowser", () => {
  it("nhận ra Zalo, Facebook, Messenger, Instagram, TikTok, WebView Android chung", () => {
    expect(detectInAppBrowser(UA.zalo)).toBe("Zalo");
    expect(detectInAppBrowser(UA.facebook)).toBe("Facebook");
    expect(detectInAppBrowser(UA.messenger)).toBe("Messenger");
    expect(detectInAppBrowser(UA.instagram)).toBe("Instagram");
    expect(detectInAppBrowser(UA.tiktok)).toBe("TikTok");
    expect(detectInAppBrowser(UA.androidWv)).toBe("ứng dụng");
  });
  it("Chrome, Safari, máy tính → null", () => {
    expect(detectInAppBrowser(UA.chrome)).toBeNull();
    expect(detectInAppBrowser(UA.safari)).toBeNull();
    expect(detectInAppBrowser(UA.desktop)).toBeNull();
  });
});
