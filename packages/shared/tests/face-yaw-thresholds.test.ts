import { describe, expect, it } from "vitest";
import { CLIENT_YAW, SERVER_YAW, YAW_MARGINS, yawMarginViolations } from "../src/face-yaw-thresholds";
import { classifyFaceYaw } from "../src/face-yaw";

/**
 * Ngưỡng yaw client ↔ server ở MỘT chỗ (face-yaw-thresholds.ts). Số đo iPhone thật (2026-11-17, "Thử liveness"):
 * trái C 0,501 / S 0,552 · thẳng C −0,088 / S −0,093 · phải C −0,410 / S −0,321 → ở chiều quay server có thể thấp hơn
 * client ~0,09 về độ lớn. Biên an toàn bắt buộc giữa hai bộ ngưỡng — sửa ngưỡng sai biên thì test này fail.
 */
describe("ngưỡng yaw hiện hành", () => {
  it("server: thẳng ≤ 0,18 · quay 0,22–0,80", () => {
    expect(SERVER_YAW).toEqual({ centerMax: 0.18, turnMin: 0.22, turnMax: 0.8 });
  });
  it("client: thẳng ≤ 0,12 · quay 0,40–0,65 (không đổi)", () => {
    expect(CLIENT_YAW).toEqual({ centerMax: 0.12, turnMin: 0.4, turnMax: 0.65 });
  });
});

describe("bất biến biên an toàn client ↔ server", () => {
  it("biên tối thiểu", () => {
    expect(YAW_MARGINS).toEqual({ turnMin: 0.15, centerMax: 0.05, turnMax: 0.1 });
  });
  it("client.turnMin − server.turnMin ≥ 0,15", () => {
    expect(CLIENT_YAW.turnMin - SERVER_YAW.turnMin).toBeGreaterThanOrEqual(YAW_MARGINS.turnMin - 1e-9);
  });
  it("server.centerMax (thẳng tối đa) − client.centerMax ≥ 0,05", () => {
    expect(SERVER_YAW.centerMax - CLIENT_YAW.centerMax).toBeGreaterThanOrEqual(YAW_MARGINS.centerMax - 1e-9);
  });
  it("server.turnMax − client.turnMax ≥ 0,10", () => {
    expect(SERVER_YAW.turnMax - CLIENT_YAW.turnMax).toBeGreaterThanOrEqual(YAW_MARGINS.turnMax - 1e-9);
  });
  it("server: thẳng tối đa < quay tối thiểu < quay tối đa (không chồng lấn)", () => {
    expect(SERVER_YAW.centerMax).toBeLessThan(SERVER_YAW.turnMin);
    expect(SERVER_YAW.turnMin).toBeLessThan(SERVER_YAW.turnMax);
  });
  it("bộ ngưỡng hiện hành không vi phạm biên nào", () => {
    expect(yawMarginViolations(SERVER_YAW, CLIENT_YAW)).toEqual([]);
  });
});

describe("yawMarginViolations — bắt ngưỡng sai biên", () => {
  it.each([
    ["server quay tối thiểu quá sát client", { ...SERVER_YAW, turnMin: 0.3 }, CLIENT_YAW, "turnMin"],
    ["client thẳng quá rộng", SERVER_YAW, { ...CLIENT_YAW, centerMax: 0.15 }, "centerMax"],
    ["server quay tối đa quá sát client", { ...SERVER_YAW, turnMax: 0.7 }, CLIENT_YAW, "turnMax"],
    ["server thẳng chồng lên quay", { ...SERVER_YAW, centerMax: 0.22 }, { ...CLIENT_YAW, centerMax: 0.1 }, "serverOverlap"],
  ])("%s → %s", (_n, server, client, violation) => {
    expect(yawMarginViolations(server, client)).toContain(violation);
  });
});

describe("số đo iPhone thật theo ngưỡng mới", () => {
  it.each([
    ["trái", 0.501, 0.552, "left"],
    ["thẳng", -0.088, -0.093, "center"],
    ["phải", -0.41, -0.321, "right"],
  ])("%s: client %d và server %d → đúng tư thế", (_n, c, s, pose) => {
    expect(classifyFaceYaw(c, CLIENT_YAW)).toBe(pose);
    expect(classifyFaceYaw(s, SERVER_YAW)).toBe(pose);
  });
  it("client vừa đạt 0,40 mà server thấp hơn 0,09–0,15 (0,31 / 0,25) vẫn đạt", () => {
    expect(classifyFaceYaw(0.31, SERVER_YAW)).toBe("left");
    expect(classifyFaceYaw(-0.25, SERVER_YAW)).toBe("right");
  });
});
