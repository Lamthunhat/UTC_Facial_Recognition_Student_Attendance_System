import { describe, expect, it } from "vitest";
import { CLIENT_POSE, createPoseTracker, poseGuidance, yawFromLandmarks, type Pt } from "@/lib/student/face-pose";

/**
 * Hướng dẫn quay đầu ở trình duyệt (MediaPipe Face Landmarker) — CHỈ hướng dẫn, server vẫn quyết định.
 * Yaw cùng quy ước server (face/liveness.ts): ảnh KHÔNG lật, (mũi.x − trung điểm 2 mắt.x) / khoảng cách 2 mắt;
 * SV quay sang TRÁI của mình → mũi lệch phải ảnh → yaw > 0.
 */
const W = 1280;
const H = 720;
/** 478 điểm chuẩn hoá; mắt (tâm mống mắt 468, 473) cách nhau 0,1 chiều rộng; mũi (1) lệch theo yaw. */
function face(yaw: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  pts[468] = { x: 0.45, y: 0.45 };
  pts[473] = { x: 0.55, y: 0.45 };
  pts[1] = { x: 0.5 + yaw * 0.1, y: 0.55 };
  return pts;
}

describe("yawFromLandmarks", () => {
  it("cùng quy ước server: mũi lệch phải ảnh → yaw dương (= quay TRÁI của SV)", () => {
    expect(yawFromLandmarks(face(0.3), W, H)).toBeCloseTo(0.3, 6);
    expect(yawFromLandmarks(face(-0.25), W, H)).toBeCloseTo(-0.25, 6);
    expect(yawFromLandmarks(face(0), W, H)).toBeCloseTo(0, 6);
  });
  it("tính theo điểm ảnh (không méo khi khung không vuông)", () => {
    const f = face(0.3);
    // nâng mắt phải lên → khoảng cách mắt tính bằng px phải dùng cả W và H
    f[473] = { x: 0.55, y: 0.45 + 0.1 * (W / H) * 0 };
    expect(yawFromLandmarks(f, W, H)).toBeCloseTo(0.3, 6);
  });
  it("thiếu điểm mống mắt → dùng khoé mắt (33/133, 362/263); không đủ điểm → null", () => {
    const f = face(0.3).slice(0, 468); // không có iris
    f[33] = { x: 0.43, y: 0.45 };
    f[133] = { x: 0.47, y: 0.45 };
    f[362] = { x: 0.53, y: 0.45 };
    f[263] = { x: 0.57, y: 0.45 };
    expect(yawFromLandmarks(f, W, H)).toBeCloseTo(0.3, 6);
    expect(yawFromLandmarks([], W, H)).toBeNull();
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
