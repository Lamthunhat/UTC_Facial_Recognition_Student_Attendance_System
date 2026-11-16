import { describe, expect, it } from "vitest";
import { CLIENT_YAW, SERVER_YAW } from "@utc/shared/face-yaw-thresholds";
import { clientYawField, parseProbeResult, parseYawDebug, yawDebugRows, yawReasonText, yawThresholdsText } from "@/lib/student/yaw-debug";

/**
 * Công cụ so sánh yaw client ↔ server (CHỈ preview/dev — server quyết định bật qua nonce `yawDebug: true`).
 * Phần thuần: đọc báo cáo server, dựng bảng so sánh, đóng gói yaw client gửi kèm khung.
 */
const thresholds = {
  server: { centerMax: 0.18, turnMin: 0.22, turnMax: 0.8 },
  client: { centerMax: 0.12, turnMin: 0.4, turnMax: 0.65 },
};
const report = {
  thresholds,
  reason: "LIVENESS_FAILED",
  frames: [
    { frame: 1, expected: "left", faces: 1, serverYaw: 0.201, serverPose: "unclear", clientYaw: 0.452, ok: false },
    { frame: 2, expected: "center", faces: 1, serverYaw: 0.02, serverPose: "center", clientYaw: -0.01, ok: true },
    { frame: 3, expected: "right", faces: 0, serverYaw: null, serverPose: "no_face", clientYaw: null, ok: false },
  ],
};

describe("parseYawDebug", () => {
  it("báo cáo hợp lệ → giữ nguyên", () => {
    expect(parseYawDebug(report)).toEqual(report);
  });
  it.each([[undefined], [null], ["x"], [{ frames: "x" }], [{ ...report, frames: [{ frame: 1 }] }], [{ ...report, thresholds: undefined }]])(
    "không hợp lệ %j → null",
    (v) => {
      expect(parseYawDebug(v)).toBeNull();
    },
  );
});

describe("yawDebugRows — bảng so sánh từng khung", () => {
  it("mong đợi, yaw client/server (3 số), chênh lệch, tư thế theo ngưỡng từng bên, kết quả", () => {
    const rows = yawDebugRows(parseYawDebug(report)!);
    expect(rows).toEqual([
      { frame: 1, expected: "trái", client: "0.452 (trái)", server: "0.201 (chưa rõ)", delta: "-0.251", ok: false },
      { frame: 2, expected: "thẳng", client: "-0.010 (thẳng)", server: "0.020 (thẳng)", delta: "+0.030", ok: true },
      { frame: 3, expected: "phải", client: "—", server: "không thấy mặt", delta: "—", ok: false },
    ]);
  });
  it("nhiều mặt → nêu rõ", () => {
    const r = parseYawDebug({ ...report, frames: [{ ...report.frames[0], faces: 2, serverYaw: null, serverPose: "multiple_faces" }] })!;
    expect(yawDebugRows(r)[0].server).toBe("2 mặt");
  });
});

describe("yawReasonText", () => {
  it.each([
    [null, "Qua liveness"],
    ["LIVENESS_FAILED", "LIVENESS_FAILED — sai tư thế ít nhất một khung"],
    ["SAME_PERSON_FAILED", "SAME_PERSON_FAILED — tư thế đúng nhưng 3 khung không cùng một người"],
    ["LIVE_NO_FACE", "LIVE_NO_FACE — có khung không thấy mặt"],
    ["LIVE_MULTIPLE_FACES", "LIVE_MULTIPLE_FACES — có khung nhiều mặt"],
  ])("%s", (reason, text) => {
    expect(yawReasonText(reason as never)).toBe(text);
  });
});

describe("clientYawField — trường form gửi kèm khung", () => {
  it("JSON 3 phần tử, làm tròn 3 số, null giữ nguyên", () => {
    expect(clientYawField([0.45678, null, -0.4])).toBe("[0.457,null,-0.4]");
  });
  it("NaN / vô cực → null", () => {
    expect(clientYawField([Number.NaN, Infinity, 0])).toBe("[null,null,0]");
  });
});

describe("parseProbeResult — phản hồi POST /api/student/liveness-probe (trang chẩn đoán)", () => {
  it("{passed, yawDebug} hợp lệ", () => {
    expect(parseProbeResult({ passed: false, yawDebug: report })).toEqual({ passed: false, report });
  });
  it.each([[null], [{ passed: "yes", yawDebug: report }], [{ passed: true }], [{ passed: true, yawDebug: { frames: [] } }]])("không hợp lệ %j → null", (v) => {
    expect(parseProbeResult(v)).toBeNull();
  });
});

describe("yawThresholdsText — ngưỡng hiển thị ở trang chẩn đoán + bảng so sánh", () => {
  it("server (ngưỡng mới 0,22)", () => {
    expect(yawThresholdsText(SERVER_YAW)).toBe("thẳng ≤ 0.18 · quay 0.22–0.80 · > 0.80 quá mạnh");
  });
  it("client", () => {
    expect(yawThresholdsText(CLIENT_YAW)).toBe("thẳng ≤ 0.12 · quay 0.40–0.65 · > 0.65 quá mạnh");
  });
});
