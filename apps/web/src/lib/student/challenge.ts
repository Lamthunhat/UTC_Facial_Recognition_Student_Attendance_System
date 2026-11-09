/**
 * Thử thách quay đầu do server cấp kèm nonce (FR-045a): khung [hướng 1, nhìn thẳng, hướng 2].
 * "left" = TRÁI CỦA SV (quy ước server, ảnh gửi lên không lật). Màn hình xem trước camera trước được lật như gương,
 * nên SV quay sang trái của mình thì thấy mặt quay về phía trái màn hình → mũi tên ← khớp với điều SV thấy.
 */
export type Turn = "left" | "right";
export type Challenge = [Turn, Turn];
export type Pose = Turn | "center";

const STEP: Record<Pose, { label: string; arrow: string }> = {
  left: { label: "Quay mặt sang TRÁI", arrow: "←" },
  center: { label: "Nhìn thẳng vào camera", arrow: "•" },
  right: { label: "Quay mặt sang PHẢI", arrow: "→" },
};

export function poseSteps(challenge: Challenge): { pose: Pose; label: string; arrow: string }[] {
  return ([challenge[0], "center", challenge[1]] as Pose[]).map((pose) => ({ pose, ...STEP[pose] }));
}

export function isChallenge(v: unknown): v is Challenge {
  return Array.isArray(v) && v.length === 2 && v.every((p) => p === "left" || p === "right") && v[0] !== v[1];
}
