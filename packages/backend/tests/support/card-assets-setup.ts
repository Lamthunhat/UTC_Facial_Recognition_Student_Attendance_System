import { execFileSync } from "node:child_process";
import path from "node:path";

/** globalSetup: chép + kiểm sha256 dữ liệu đọc thẻ vào apps/web/card-assets trước khi chạy test (giống bước build). */
export default function setup() {
  const repo = path.resolve(__dirname, "../../../..");
  execFileSync(process.execPath, [path.join(repo, "scripts/card-assets.mjs")], { stdio: "inherit" });
}
