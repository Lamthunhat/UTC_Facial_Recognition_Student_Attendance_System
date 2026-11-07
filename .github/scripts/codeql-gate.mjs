// Chặn CI theo kết quả CodeQL khi không upload được lên tab Security (repo private, không có GitHub Code Security).
// Dùng: node .github/scripts/codeql-gate.mjs <thư mục chứa *.sarif>
// Fail (exit 1) nếu có kết quả mức error/warning chưa bị suppress; mức note chỉ in ra.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Thiếu thư mục SARIF");
  process.exit(2);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".sarif"));
if (files.length === 0) {
  console.error(`Không tìm thấy file .sarif trong ${dir} — CodeQL chưa chạy xong?`);
  process.exit(2);
}

/** CVSS-like security-severity của CodeQL → nhãn mức độ. */
const severityLabel = (s) => (s >= 9 ? "Critical" : s >= 7 ? "High" : s >= 4 ? "Medium" : s > 0 ? "Low" : "-");

let blocking = 0;
let notes = 0;
for (const f of files) {
  const sarif = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  for (const run of sarif.runs ?? []) {
    const rules = new Map();
    for (const r of [...(run.tool?.driver?.rules ?? []), ...(run.tool?.extensions ?? []).flatMap((e) => e.rules ?? [])]) {
      rules.set(r.id, r);
    }
    for (const res of run.results ?? []) {
      if (res.suppressions?.length) continue;
      const rule = rules.get(res.ruleId) ?? {};
      const level = res.level ?? rule.defaultConfiguration?.level ?? "warning";
      const sev = Number(rule.properties?.["security-severity"] ?? 0);
      const loc = res.locations?.[0]?.physicalLocation;
      const where = loc ? `${loc.artifactLocation?.uri}:${loc.region?.startLine ?? "?"}` : "(không rõ vị trí)";
      const line = `[${level}] [${severityLabel(sev)}${sev ? ` ${sev}` : ""}] ${res.ruleId} — ${where}\n    ${res.message?.text ?? ""}`;
      if (level === "error" || level === "warning") {
        blocking++;
        console.log(`::error file=${loc?.artifactLocation?.uri ?? ""},line=${loc?.region?.startLine ?? 1}::${res.ruleId}: ${res.message?.text ?? ""}`);
        console.log(line);
      } else {
        notes++;
        console.log(line);
      }
    }
  }
}

console.log(`\nCodeQL: ${blocking} cảnh báo chặn (error/warning), ${notes} ghi chú (note).`);
process.exit(blocking > 0 ? 1 : 0);
