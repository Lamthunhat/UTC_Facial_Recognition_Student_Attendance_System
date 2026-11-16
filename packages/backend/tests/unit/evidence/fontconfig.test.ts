import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureFontconfig, fontconfigXml } from "../../../src/evidence/fontconfig";

/**
 * Cấu hình fontconfig riêng cho việc vẽ chữ lên ảnh bằng chứng (sharp/Pango):
 * - function Vercel không có /etc/fonts → tự cấp cấu hình chỉ trỏ tới font đóng gói;
 * - KHÔNG có <cachedir>: nhiều tiến trình cùng dựng cache fontconfig lần đầu → hỏng heap (đã tái hiện trên Windows:
 *   2/48 tiến trình chết với 0xC0000374; không cache → 0/60).
 */
afterEach(() => vi.unstubAllEnvs());

describe("fontconfigXml", () => {
  it("chỉ một thư mục font, không cachedir, thoát ký tự XML", () => {
    const xml = fontconfigXml("C:/a & b/<fonts>");
    expect(xml).toContain("<dir>C:/a &amp; b/&lt;fonts&gt;</dir>");
    expect(xml).not.toMatch(/cachedir/);
    expect(xml).toMatch(/^<\?xml/);
  });
});

describe("ensureFontconfig", () => {
  it("chưa đặt FONTCONFIG_FILE → ghi cấu hình vào thư mục tạm và đặt biến", () => {
    vi.stubEnv("FONTCONFIG_FILE", undefined as unknown as string);
    const file = ensureFontconfig("/srv/app/public/fonts");
    expect(process.env.FONTCONFIG_FILE).toBe(file);
    expect(existsSync(file!)).toBe(true);
    expect(readFileSync(file!, "utf8")).toContain("<dir>/srv/app/public/fonts</dir>");
  });
  it("đã có FONTCONFIG_FILE (quản trị đặt) → giữ nguyên", () => {
    vi.stubEnv("FONTCONFIG_FILE", "/etc/custom/fonts.conf");
    expect(ensureFontconfig("/x")).toBe("/etc/custom/fonts.conf");
    expect(process.env.FONTCONFIG_FILE).toBe("/etc/custom/fonts.conf");
  });
});
