import { describe, expect, it } from "vitest";
import { classifyYaw, CLIENT_POSE, createPoseTracker, poseGuidance, SERVER_POSE, yawFromKeypoints, type Pt } from "@/lib/student/face-pose";

/**
 * Hướng dẫn quay đầu ở trình duyệt (MediaPipe Face Detector — BlazeFace short-range) — CHỈ hướng dẫn, server quyết định.
 * Yaw tính như server làm với 5 điểm SCRFD (face/liveness.ts headYaw): ảnh KHÔNG lật,
 * (mũi.x − trung điểm 2 mắt.x) / khoảng cách 2 mắt; SV quay sang TRÁI của mình → mũi lệch phải ảnh → yaw > 0.
 * Keypoint BlazeFace (chuẩn hoá 0–1): [0] mắt phải, [1] mắt trái, [2] chóp mũi, [3] miệng, [4] tai phải, [5] tai trái.
 */
const W = 1280;
const H = 720;
function face(yaw: number): Pt[] {
  return [
    { x: 0.45, y: 0.45 }, // mắt
    { x: 0.55, y: 0.45 }, // mắt
    { x: 0.5 + yaw * 0.1, y: 0.55 }, // mũi
    { x: 0.5, y: 0.65 },
    { x: 0.38, y: 0.5 },
    { x: 0.62, y: 0.5 },
  ];
}

describe("yawFromKeypoints", () => {
  it("cùng quy ước server: mũi lệch phải ảnh → yaw dương (= quay TRÁI của SV)", () => {
    expect(yawFromKeypoints(face(0.3), W, H)).toBeCloseTo(0.3, 6);
    expect(yawFromKeypoints(face(-0.25), W, H)).toBeCloseTo(-0.25, 6);
    expect(yawFromKeypoints(face(0), W, H)).toBeCloseTo(0, 6);
  });
  it("khoảng cách mắt tính bằng điểm ảnh (khung không vuông vẫn đúng)", () => {
    const f = face(0);
    f[1] = { x: 0.55, y: 0.45 + (0.1 * W) / H }; // mắt lệch dọc đúng bằng khoảng cách ngang (theo px)
    f[2] = { x: 0.5 + 0.2 * 0.1 * Math.SQRT2, y: 0.55 };
    expect(yawFromKeypoints(f, W, H)).toBeCloseTo(0.2, 6);
  });
  it("thiếu keypoint / hai mắt trùng nhau → null", () => {
    expect(yawFromKeypoints([], W, H)).toBeNull();
    expect(yawFromKeypoints(face(0.1).slice(0, 2), W, H)).toBeNull();
    const f = face(0.1);
    f[1] = f[0];
    expect(yawFromKeypoints(f, W, H)).toBeNull();
  });
});

describe("poseGuidance — câu hướng dẫn", () => {
  it("không thấy mặt / nhiều mặt", () => {
    expect(poseGuidance("left", 0, null)).toEqual({ ok: false, message: "Không thấy khuôn mặt" });
    expect(poseGuidance("left", 2, 0.3).message).toBe("Chỉ một người trong khung");
  });
  it("quay chưa đủ → 'Quay thêm sang trái|phải'; đủ → 'Giữ yên'", () => {
    expect(poseGuidance("left", 1, 0.1)).toEqual({ ok: false, message: "Quay thêm sang trái" });
    expect(poseGuidance("left", 1, -0.3)).toEqual({ ok: false, message: "Quay thêm sang trái" });
    expect(poseGuidance("left", 1, CLIENT_POSE.turnMinYaw)).toEqual({ ok: true, message: "Giữ yên" });
    expect(poseGuidance("right", 1, -0.1)).toEqual({ ok: false, message: "Quay thêm sang phải" });
    expect(poseGuidance("right", 1, -0.35)).toEqual({ ok: true, message: "Giữ yên" });
  });
  it("nhìn thẳng: |yaw| ≤ ngưỡng client (chặt hơn server để có biên an toàn)", () => {
    expect(poseGuidance("center", 1, 0.2)).toEqual({ ok: false, message: "Nhìn thẳng" });
    expect(poseGuidance("center", 1, 0.05)).toEqual({ ok: true, message: "Giữ yên" });
    expect(CLIENT_POSE.centerMaxYaw).toBeLessThan(0.12); // server centerMaxYaw
    expect(CLIENT_POSE.turnMinYaw).toBeGreaterThan(0.2); // server turnMinYaw
  });
});

describe("createPoseTracker — tự chụp khi đạt góc và ổn định ~300 ms; quá 10 s thì nhắc lại", () => {
  it("đạt góc liên tục ≥ 300 ms → capture; bị gián đoạn thì đếm lại", () => {
    const t = createPoseTracker("left", 0);
    expect(t.feed(0, 1, 0.1).status).toBe("adjust");
    expect(t.feed(100, 1, 0.3).status).toBe("hold");
    expect(t.feed(300, 1, 0.3).status).toBe("hold");
    expect(t.feed(350, 1, 0.1).status).toBe("adjust"); // mất góc → đếm lại
    expect(t.feed(400, 1, 0.3).status).toBe("hold");
    expect(t.feed(699, 1, 0.31).status).toBe("hold");
    expect(t.feed(700, 1, 0.31).status).toBe("capture");
  });

  it("không thấy mặt → searching", () => {
    expect(createPoseTracker("center", 0).feed(50, 0, null)).toEqual({ status: "searching", message: "Không thấy khuôn mặt" });
  });

  it("quá 10 s chưa chụp → timeout (nhắc lại), rồi tự đếm lại thời gian từ đó", () => {
    const t = createPoseTracker("right", 0);
    expect(t.feed(9_999, 1, 0).status).toBe("adjust");
    const to = t.feed(CLIENT_POSE.stepTimeoutMs, 1, 0);
    expect(to.status).toBe("timeout");
    expect(to.message).toMatch(/Quay thêm sang phải/);
    expect(t.feed(10_100, 1, 0).status).toBe("adjust"); // khung mới bắt đầu lại
    expect(t.feed(19_999, 1, 0).status).toBe("adjust");
    expect(t.feed(20_000, 1, 0).status).toBe("timeout");
  });
});

describe("classifyYaw — phân loại theo bộ ngưỡng (trang chẩn đoán hiệu chỉnh bằng mặt thật)", () => {
  it("SERVER_POSE khớp đúng LIVENESS_RULES của server", async () => {
    const { LIVENESS_RULES } = await import("@utc/backend/face/liveness");
    expect(SERVER_POSE).toEqual({ centerMaxYaw: LIVENESS_RULES.centerMaxYaw, turnMinYaw: LIVENESS_RULES.turnMinYaw });
  });
  it("cùng ngữ nghĩa classifyPose của server: thẳng / trái / phải / không rõ", () => {
    expect(classifyYaw(0.1, SERVER_POSE)).toBe("center");
    expect(classifyYaw(0.2, SERVER_POSE)).toBe("left");
    expect(classifyYaw(-0.25, SERVER_POSE)).toBe("right");
    expect(classifyYaw(0.15, SERVER_POSE)).toBe("unclear");
    expect(classifyYaw(null, SERVER_POSE)).toBe("unclear");
    expect(classifyYaw(0.2, CLIENT_POSE)).toBe("unclear"); // client chặt hơn
  });
});
