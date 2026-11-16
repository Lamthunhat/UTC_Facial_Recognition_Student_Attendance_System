import { classifyFaceYaw, type YawPose, type YawThresholds } from "@utc/shared/face-yaw";

/**
 * Công cụ so sánh yaw client ↔ server — CHỈ preview/dev. Server quyết định bật (nonce trả `yawDebug: true`); khi đó
 * client gửi kèm `clientYaw` (yaw MediaPipe lúc chụp từng khung) và server trả `yawDebug` (yaw SCRFD từng khung + lý do)
 * trong cả 201 lẫn lỗi liveness. Production: server không bật → client không gửi, không hiện gì. Thuần, test được.
 */
type ExpectedPose = "left" | "right" | "center";
type ServerPose = YawPose | "no_face" | "multiple_faces";
export type YawDebugReason = "LIVENESS_FAILED" | "LIVE_NO_FACE" | "LIVE_MULTIPLE_FACES" | "SAME_PERSON_FAILED";

export interface YawDebugReport {
  thresholds: { server: YawThresholds; client: YawThresholds };
  reason: YawDebugReason | null;
  frames: {
    frame: number;
    expected: ExpectedPose;
    faces: number;
    serverYaw: number | null;
    serverPose: ServerPose;
    clientYaw: number | null;
    ok: boolean;
  }[];
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || num(v);
const isThresholds = (t: unknown): t is YawThresholds =>
  !!t && typeof t === "object" && ["centerMax", "turnMin", "turnMax"].every((k) => num((t as Record<string, unknown>)[k]));

/** Đọc báo cáo từ phản hồi (body 201 hoặc error.yawDebug). Sai dạng → null (không hiện bảng). */
export function parseYawDebug(v: unknown): YawDebugReport | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const th = r.thresholds as Record<string, unknown> | undefined;
  if (!th || !isThresholds(th.server) || !isThresholds(th.client) || !Array.isArray(r.frames)) return null;
  const framesOk = r.frames.every((f: Record<string, unknown> | null) =>
    !!f &&
    num(f.frame) &&
    typeof f.expected === "string" &&
    num(f.faces) &&
    numOrNull(f.serverYaw) &&
    typeof f.serverPose === "string" &&
    numOrNull(f.clientYaw) &&
    typeof f.ok === "boolean",
  );
  return framesOk ? (v as YawDebugReport) : null;
}

const POSE_VI: Record<ServerPose, string> = {
  left: "trái",
  right: "phải",
  center: "thẳng",
  too_far: "QUÁ MẠNH",
  unclear: "chưa rõ",
  no_face: "không thấy mặt",
  multiple_faces: "nhiều mặt",
};

const f3 = (n: number) => n.toFixed(3);

export interface YawDebugRow {
  frame: number;
  expected: string;
  client: string;
  server: string;
  /** server − client */
  delta: string;
  ok: boolean;
}

/** Một dòng mỗi khung; tư thế client theo ngưỡng client, tư thế server theo ngưỡng server (đều lấy từ báo cáo). */
export function yawDebugRows(r: YawDebugReport): YawDebugRow[] {
  return r.frames.map((f) => {
    const client = f.clientYaw === null ? "—" : `${f3(f.clientYaw)} (${POSE_VI[classifyFaceYaw(f.clientYaw, r.thresholds.client)]})`;
    const server =
      f.serverPose === "no_face"
        ? POSE_VI.no_face
        : f.serverPose === "multiple_faces"
          ? `${f.faces} mặt`
          : `${f.serverYaw === null ? "—" : f3(f.serverYaw)} (${POSE_VI[f.serverPose]})`;
    const d = f.serverYaw !== null && f.clientYaw !== null ? f.serverYaw - f.clientYaw : null;
    return {
      frame: f.frame,
      expected: POSE_VI[f.expected],
      client,
      server,
      delta: d === null ? "—" : `${d >= 0 ? "+" : ""}${f3(d)}`,
      ok: f.ok,
    };
  });
}

const REASON_VI: Record<YawDebugReason, string> = {
  LIVENESS_FAILED: "sai tư thế ít nhất một khung",
  SAME_PERSON_FAILED: "tư thế đúng nhưng 3 khung không cùng một người",
  LIVE_NO_FACE: "có khung không thấy mặt",
  LIVE_MULTIPLE_FACES: "có khung nhiều mặt",
};

export function yawReasonText(reason: YawDebugReason | null): string {
  return reason === null ? "Qua liveness" : `${reason} — ${REASON_VI[reason] ?? "lỗi khác"}`;
}

/** Giá trị trường form `clientYaw`: JSON 3 phần tử, làm tròn 3 số; không hữu hạn → null. */
export function clientYawField(yaws: (number | null)[]): string {
  return JSON.stringify(yaws.map((y) => (y !== null && Number.isFinite(y) ? Math.round(y * 1000) / 1000 : null)));
}
