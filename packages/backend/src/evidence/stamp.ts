import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { log } from "../log";

/**
 * T073 — Đóng dấu ảnh bằng chứng (FR-039, FR-010d, Constitution I): giờ SERVER (giờ VN), địa chỉ ước tính từ vị trí
 * của chính SV (Goong) hoặc toạ độ, lớp, phòng — vẽ ở server lên dải tối ở đáy ảnh.
 * Chữ render bằng sharp (Pango) với `fontfile` Be Vietnam Pro đóng gói kèm (apps/web/public/fonts, có trong
 * outputFileTracingIncludes của /api/**) — function Vercel không có font hệ thống; dữ liệu người dùng được thoát
 * markup Pango trước khi vẽ.
 */
export interface StampInfo {
  serverTime: Date;
  address: string | null;
  lat: number;
  lng: number;
  classCode: string;
  room: string;
  windowLabel: string;
}

const FONT_FILE = "BeVietnamPro-SemiBold.ttf";
const FONT_FAMILY = "Be Vietnam Pro SemiBold";
const MAX_LINE = 90;

let fontWarned = false;
/** Font đóng gói: <cwd>/public/fonts (Next, kể cả Vercel) hoặc apps/web/public/fonts tính từ package (test). */
export function evidenceFontPath(): string | null {
  const cwd = process.cwd();
  for (const dir of [path.join(cwd, "public/fonts"), path.join(cwd, "../../apps/web/public/fonts")]) {
    const f = path.join(dir, FONT_FILE);
    if (existsSync(f)) return f;
  }
  if (!fontWarned) {
    fontWarned = true;
    log.error("evidence_font_missing", { file: FONT_FILE });
  }
  return null;
}

const cut = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

/** "dd/MM/yyyy HH:mm:ss" giờ VN (UTC+7). */
function vnStamp(d: Date): string {
  const v = new Date(d.getTime() + 7 * 3_600_000).toISOString();
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)} ${v.slice(11, 19)}`;
}

export function stampLines(i: StampInfo): string[] {
  return [
    cut(`${vnStamp(i.serverTime)} · ${i.windowLabel}`),
    cut(i.address ?? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}`),
    cut(`${i.classCode} · Phòng ${i.room}`),
  ];
}

export function escapePango(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Ảnh JPEG (đã sanitize) → JPEG cùng kích thước, có dải chữ ở đáy. */
export async function stampEvidence(jpeg: Buffer, info: StampInfo): Promise<Buffer> {
  const img = sharp(jpeg);
  const { width: W = 0, height: H = 0 } = await img.metadata();
  const fontPx = Math.max(11, Math.round(W / 34));
  const pad = Math.round(fontPx * 0.6);
  const fontfile = evidenceFontPath();
  const markup = `<span foreground="white">${stampLines(info).map(escapePango).join("\n")}</span>`;
  let text = await sharp({
    text: { text: markup, font: `${FONT_FAMILY} ${fontPx}`, ...(fontfile ? { fontfile } : {}), width: W - 2 * pad, rgba: true, dpi: 72, wrap: "char" },
  })
    .png()
    .toBuffer();
  let meta = await sharp(text).metadata();
  // Không để dải chữ quá 40% chiều cao (ảnh rất nhỏ): thu nhỏ khối chữ cho vừa.
  const maxTextH = Math.max(10, Math.floor(H * 0.4) - 2 * pad);
  if ((meta.height ?? 0) > maxTextH || (meta.width ?? 0) > W - 2 * pad) {
    text = await sharp(text).resize({ width: W - 2 * pad, height: maxTextH, fit: "inside" }).png().toBuffer();
    meta = await sharp(text).metadata();
  }
  const bandH = Math.min(H, (meta.height ?? 0) + 2 * pad);
  const band = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${bandH}"><rect width="100%" height="100%" fill="#000" fill-opacity="0.6"/></svg>`);
  return img
    .composite([
      { input: band, left: 0, top: H - bandH },
      { input: text, left: pad, top: H - bandH + pad },
    ])
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
