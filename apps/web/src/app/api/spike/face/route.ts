/**
 * T009 — Route spike để đo cold start / latency trên Vercel. XOÁ sau khi có quyết định Go/No-Go (T012).
 * Chỉ bật khi SPIKE_ENABLED=1 và có header Authorization: Bearer $CRON_SECRET.
 *
 * curl -X POST -H "Authorization: Bearer $CRON_SECRET" --data-binary @anh.jpg https://<preview>/api/spike/face
 */
import { NextResponse } from "next/server";
import { decodeToRgb } from "@utc/backend/face/image";
import { detectFaces } from "@utc/backend/face/detect";
import { embedFace } from "@utc/backend/face/embed";
import { getDetector, getRecognizer } from "@utc/backend/face/sessions";

export const runtime = "nodejs";
export const maxDuration = 30;

const bootedAt = Date.now();
let invocations = 0;

export async function POST(req: Request) {
  if (process.env.SPIKE_ENABLED !== "1") return new NextResponse(null, { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length === 0 || body.length > 2_000_000) {
    return NextResponse.json({ error: "Ảnh rỗng hoặc > 2 MB" }, { status: 413 });
  }
  const cold = invocations++ === 0;
  const t0 = performance.now();
  await Promise.all([getDetector(), getRecognizer()]);
  const tLoad = performance.now() - t0;
  const img = await decodeToRgb(body);
  const t1 = performance.now();
  const faces = await detectFaces(img);
  const t2 = performance.now();
  const emb = faces[0] ? await embedFace(img, faces[0].kps) : null;
  const t3 = performance.now();
  return NextResponse.json({
    cold,
    instanceAgeMs: Date.now() - bootedAt,
    faces: faces.length,
    ms: {
      loadModels: Math.round(tLoad),
      decode: Math.round(t1 - t0 - tLoad),
      detect: Math.round(t2 - t1),
      embed: Math.round(t3 - t2),
      total: Math.round(t3 - t0),
    },
    embeddingDims: emb?.length ?? 0,
  });
}
