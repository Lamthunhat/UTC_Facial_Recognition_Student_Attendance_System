/** Đo thời gian từng bước (ms): mỗi mark tính từ mốc trước; trùng tên thì cộng dồn; done() kèm total. */
export function stepTimer(now: () => number = () => performance.now()) {
  const start = now();
  let last = start;
  const steps: Record<string, number> = {};
  return {
    mark(name: string) {
      const t = now();
      steps[name] = (steps[name] ?? 0) + Math.round(t - last);
      last = t;
    },
    done(): Record<string, number> {
      return { ...steps, total: Math.round(last - start) };
    },
  };
}
