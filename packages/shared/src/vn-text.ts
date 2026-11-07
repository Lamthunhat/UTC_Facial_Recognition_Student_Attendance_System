/** T024 — Xử lý văn bản tiếng Việt: bỏ dấu, chuẩn hoá tên, so khớp gần đúng. */

export function removeVietnameseTones(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

const TITLES = new Set(["thay", "co", "ts", "ths", "pgs", "gs", "tsk", "ks", "cn", "gv"]);

export function normalizeName(s: string, opts: { stripTitles?: boolean } = {}): string {
  let words = removeVietnameseTones(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (opts.stripTitles) {
    while (words.length > 1 && TITLES.has(words[0])) words = words.slice(1);
  }
  return words.join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Khớp tên sau khi bỏ dấu/hoa thường (FR-103a): cùng số từ, mỗi từ sai tối đa 1 ký tự
 * (để "Tú" ≠ "Tuấn") và tổng sai ≤ maxDistance (mặc định 2) — chịu được lỗi OCR nhỏ.
 */
export function namesMatch(
  a: string,
  b: string,
  opts: { maxDistance?: number; maxPerWord?: number; stripTitles?: boolean } = {},
): boolean {
  const x = normalizeName(a, opts).split(" ").filter(Boolean);
  const y = normalizeName(b, opts).split(" ").filter(Boolean);
  if (!x.length || x.length !== y.length) return false;
  let total = 0;
  for (let i = 0; i < x.length; i++) {
    const d = levenshtein(x[i], y[i]);
    if (d > (opts.maxPerWord ?? 1)) return false;
    total += d;
  }
  return total <= (opts.maxDistance ?? 2);
}
