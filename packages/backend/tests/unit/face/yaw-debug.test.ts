import { CLIENT_YAW, SERVER_YAW } from "@utc/shared/face-yaw-thresholds";
import { syntheticHead } from "@utc/shared/head-model";
import { describe, expect, it } from "vitest";
import type { Point } from "../../../src/face/align";
import { headYaw } from "../../../src/face/liveness";
import { parseClientYaw, yawDebugEnabled, yawDebugReport } from "../../../src/face/yaw-debug";

/**
 * Công cụ so sánh yaw client ↔ server (CHỈ preview/dev): server trả yaw từng khung + lý do lỗi để hiệu chỉnh ngưỡng bằng
 * mặt thật. Production: tắt hoàn toàn (không trả, không log). Dữ liệu: mô hình đầu tổng hợp.
 */
const face = (deg: number) => {
  const h = syntheticHead(deg);
  return { box: h.box, kps: h.scrfd.kps as Point[] };
};

describe("yawDebugEnabled — chỉ preview/dev, production luôn tắt (fail closed)", () => {
  it.each([
    [{ VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production" }, true],
    [{ VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" }, false],
    [{ VERCEL: "1", NODE_ENV: "production" }, false], // Vercel mà thiếu VERCEL_ENV → tắt
    [{ VERCEL: "1", VERCEL_ENV: "development", NODE_ENV: "development" }, true], // vercel dev
    [{ NODE_ENV: "development" }, true], // pnpm dev cục bộ
    [{ NODE_ENV: "production" }, false], // next start cục bộ
    [{ NODE_ENV: "test" }, false],
    [{}, false],
  ])("%j → %s", (src, want) => {
    expect(yawDebugEnabled(src)).toBe(want);
  });

  it("VERCEL_ENV lạ (gõ nhầm) → tắt", () => {
    expect(yawDebugEnabled({ VERCEL: "1", VERCEL_ENV: "Preview" })).toBe(false);
  });
});

describe("parseClientYaw — metadata client gửi kèm khung (JSON 3 phần tử số|null trong [-1, 1])", () => {
  it("hợp lệ", () => {
    expect(parseClientYaw("[0.45,-0.02,null]")).toEqual([0.45, -0.02, null]);
  });
  it.each([
    [undefined],
    [null],
    [42],
    ["không phải json"],
    ["[0.1,0.2]"], // thiếu khung
    ["[0.1,0.2,0.3,0.4]"],
    ['[0.1,"x",0.3]'],
    ["[0.1,2,0.3]"], // ngoài [-1, 1]
    ['{"a":1}'],
    [`[${"0".repeat(300)},0,0]`], // quá dài
  ])("không hợp lệ %j → null", (raw) => {
    expect(parseClientYaw(raw)).toBeNull();
  });
});

describe("yawDebugReport — yaw server từng khung + tư thế + lý do", () => {
  it("làm đúng thử thách [left, center, right]: mọi khung ok, yaw server = headYaw (làm tròn 3 số), kèm yaw client", () => {
    const frames = [[face(30)], [face(0)], [face(-30)]];
    const r = yawDebugReport(frames, ["left", "right"], [0.5, 0.01, -0.48], null);
    expect(r.reason).toBeNull();
    expect(r.thresholds).toEqual({ server: SERVER_YAW, client: CLIENT_YAW });
    expect(r.frames.map((f) => [f.frame, f.expected, f.serverPose, f.ok])).toEqual([
      [1, "left", "left", true],
      [2, "center", "center", true],
      [3, "right", "right", true],
    ]);
    const y1 = headYaw(frames[0][0].kps, frames[0][0].box);
    expect(r.frames[0].serverYaw).toBe(Math.round(y1 * 1000) / 1000);
    expect(r.frames.map((f) => f.clientYaw)).toEqual([0.5, 0.01, -0.48]);
    expect(r.frames.every((f) => f.faces === 1)).toBe(true);
  });

  it("quay quá mạnh / quay ngược / không mặt / nhiều mặt → khung đó không ok, tư thế nêu rõ", () => {
    const tiny = { box: { x1: 0, y1: 0, x2: 20, y2: 20 }, kps: face(0).kps }; // < 40 px: không tính
    const frames = [[face(85)], [tiny], [face(0), face(10)]];
    const r = yawDebugReport(frames, ["left", "right"], null, "LIVENESS_FAILED");
    expect(r.reason).toBe("LIVENESS_FAILED");
    expect(r.frames.map((f) => [f.serverPose, f.faces, f.ok])).toEqual([
      ["too_far", 1, false],
      ["no_face", 0, false],
      ["multiple_faces", 2, false],
    ]);
    expect(r.frames[1].serverYaw).toBeNull();
    expect(r.frames[2].serverYaw).toBeNull();
    expect(r.frames.map((f) => f.clientYaw)).toEqual([null, null, null]);

    const reversed = yawDebugReport([[face(-30)], [face(0)], [face(30)]], ["left", "right"], null, "LIVENESS_FAILED");
    expect(reversed.frames.map((f) => f.ok)).toEqual([false, true, false]);
  });

  it("không đủ 3 khung → vẫn báo các khung có, không ném lỗi", () => {
    const r = yawDebugReport([[face(30)]], ["left", "right"], [0.4, 0, -0.4], "LIVENESS_FAILED");
    expect(r.frames).toHaveLength(1);
  });
});
