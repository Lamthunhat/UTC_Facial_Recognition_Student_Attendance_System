import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Tiện ích e2e dùng chung. JWT_SECRET đọc từ biến môi trường hoặc apps/web/.env.local (không in ra). */
export function jwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const line = readFileSync(join(__dirname, "../../.env.local"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("JWT_SECRET="));
  const v = line?.slice("JWT_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  if (!v) throw new Error("Thiếu JWT_SECRET (biến môi trường hoặc apps/web/.env.local)");
  return v;
}

/** JWT phiên SV HS256 — cùng định dạng packages/backend/src/auth/jwt.ts. */
export function studentToken(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "student", sid: "e2e-csp", sub: randomUUID(), iss: "utc-face-attendance", iat: now, exp: now + 600 });
  const sig = createHmac("sha256", jwtSecret()).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
