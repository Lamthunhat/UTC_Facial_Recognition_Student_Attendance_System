import { faceYaw } from "@utc/shared/face-yaw";
import { CLIENT_YAW, SERVER_YAW } from "@utc/shared/face-yaw-thresholds";
import { syntheticHead } from "@utc/shared/head-model";
import { describe, expect, it } from "vitest";
import { classifyYaw, CLIENT_POSE, createPoseTracker, poseGuidance, yawFromKeypoints } from "@/lib/student/face-pose";

/**
 * Hướng dẫn quay đầu ở trình duyệt (MediaPipe Face Detector — BlazeFace short-range) — CHỈ hướng dẫn, server quyết định.
 * Yaw CÙNG công thức server (@utc/shared/face-yaw): kẹp(5 × (mũi.x − tâm 2 mắt.x) / bề rộng bbox, ±1), ảnh KHÔNG lật;
 * SV quay sang TRÁI của mình → yaw > 0. BlazeFace: keypoint chuẩn hoá 0–1, bbox tính bằng điểm ảnh.
 */
const W = 1280;
const H = 720;
/** Mô hình đầu tổng hợp → đầu ra kiểu BlazeFace (keypoint chuẩn hoá, bbox px). */
function blaze(deg: number) {
  const h = syntheticHead(deg, { cx: 640, cy: 360, scale: 300 });
  return { kps: h.blaze.kps.map((p) => ({ x: p.x / W, y: p.y / H })), boxWidth: h.box.x2 - h.box.x1, ref: h };
}

describe("yawFromKeypoints (BlazeFace 6 điểm)", () => {
  it("= faceYaw dùng chung với server (tính bằng điểm ảnh)", () => {
    const b = blaze(25);
    expect(yawFromKeypoints(b.kps, b.boxWidth, W, H)).toBeCloseTo(faceYaw(b.ref.blaze.eyeA, b.ref.blaze.eyeB, b.ref.blaze.nose, b.boxWidth)!, 9);
  });

  it("đơn điệu -80° → +80°, không đổi dấu, trong [-1, 1]", () => {
    let prev = -Infinity;
    for (let deg = -80; deg <= 80; deg += 5) {
      const b = blaze(deg);
      const y = yawFromKeypoints(b.kps, b.boxWidth, W, H)!;
      expect(y, `${deg}°`).toBeGreaterThan(prev);
      expect(Math.sign(y), `${deg}°`).toBe(Math.sign(deg));
      expect(Math.abs(y)).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it("thiếu keypoint / bbox rỗng → null", () => {
    expect(yawFromKeypoints([], 100, W, H)).toBeNull();
    expect(yawFromKeypoints(blaze(10).kps.slice(0, 2), 100, W, H)).toBeNull();
    expect(yawFromKeypoints(blaze(10).kps, 0, W, H)).toBeNull();
  });
});

describe("poseGuidance — câu hướng dẫn (ngưỡng client, thang mới)", () => {
  it("không thấy mặt / nhiều mặt", () => {
    expect(poseGuidance("left", 0, null)).toEqual({ ok: false, message: "Không thấy khuôn mặt" });
    expect(poseGuidance("left", 2, 0.5).message).toBe("Chỉ một người trong khung");
  });
  it("quay chưa đủ → 'Quay thêm sang …'; đủ → 'Giữ yên'; QUÁ MẠNH → 'Quay vừa phải'", () => {
    expect(poseGuidance("left", 1, 0.2)).toEqual({ ok: false, message: "Quay thêm sang trái" });
    expect(poseGuidance("left", 1, -0.5)).toEqual({ ok: false, message: "Quay thêm sang trái" });
    expect(poseGuidance("left", 1, CLIENT_YAW.turnMin)).toEqual({ ok: true, message: "Giữ yên" });
    expect(poseGuidance("left", 1, CLIENT_YAW.turnMax + 0.05)).toEqual({ ok: false, message: "Quay vừa phải" });
    expect(poseGuidance("right", 1, -0.5)).toEqual({ ok: true, message: "Giữ yên" });
    expect(poseGuidance("right", 1, -0.9)).toEqual({ ok: false, message: "Quay vừa phải" });
  });
  it("nhìn thẳng: |yaw| ≤ 0,12 (client) — chặt hơn server 0,18", () => {
    expect(poseGuidance("center", 1, 0.2)).toEqual({ ok: false, message: "Nhìn thẳng" });
    expect(poseGuidance("center", 1, 0.9)).toEqual({ ok: false, message: "Nhìn thẳng" });
    expect(poseGuidance("center", 1, 0.1)).toEqual({ ok: true, message: "Giữ yên" });
  });
  it("theo mô hình đầu: quay ~30° → đạt; ~60° → 'Quay vừa phải'", () => {
    const at = (deg: number) => {
      const b = blaze(deg);
      return yawFromKeypoints(b.kps, b.boxWidth, W, H);
    };
    expect(poseGuidance("left", 1, at(30)).ok).toBe(true);
    expect(poseGuidance("right", 1, at(-30)).ok).toBe(true);
    expect(poseGuidance("left", 1, at(60)).message).toBe("Quay vừa phải");
  });
});

describe("createPoseTracker — tự chụp khi đạt góc và ổn định ~300 ms; quá 10 s thì nhắc lại", () => {
  it("đạt góc liên tục ≥ 300 ms → capture; bị gián đoạn (kể cả quay quá mạnh) thì đếm lại", () => {
    const t = createPoseTracker("left", 0);
    expect(t.feed(0, 1, 0.2).status).toBe("adjust");
    expect(t.feed(100, 1, 0.5).status).toBe("hold");
    expect(t.feed(300, 1, 0.5).status).toBe("hold");
    expect(t.feed(350, 1, 0.9).status).toBe("adjust"); // quay quá mạnh → đếm lại
    expect(t.feed(400, 1, 0.5).status).toBe("hold");
    expect(t.feed(699, 1, 0.5).status).toBe("hold");
    expect(t.feed(700, 1, 0.5).status).toBe("capture");
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
    expect(t.feed(10_100, 1, 0).status).toBe("adjust");
    expect(t.feed(20_000, 1, 0).status).toBe("timeout");
  });
});

describe("classifyYaw — trang chẩn đoán hiển thị theo cả hai bộ ngưỡng", () => {
  it("cùng ngữ nghĩa server: thẳng / trái / phải / quá mạnh / chưa rõ", () => {
    expect(classifyYaw(0.1, SERVER_YAW)).toBe("center");
    expect(classifyYaw(0.5, SERVER_YAW)).toBe("left");
    expect(classifyYaw(-0.5, SERVER_YAW)).toBe("right");
    expect(classifyYaw(0.9, SERVER_YAW)).toBe("too_far");
    expect(classifyYaw(0.2, SERVER_YAW)).toBe("unclear");
    expect(classifyYaw(0.25, SERVER_YAW)).toBe("left");
    expect(classifyYaw(0.7, CLIENT_YAW)).toBe("too_far"); // client chặt hơn
    expect(classifyYaw(0.7, SERVER_YAW)).toBe("left");
  });
});
