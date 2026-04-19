/**
 * ToAPIs — gemini-3.1-flash-image-preview
 * 文档：https://docs.toapis.com — 先上传图片再图生图，生成任务异步轮询。
 */

import { TOAPIS_ALLOWED_ASPECTS } from "./aspect-constants";

const TOAPIS_ORIGIN = "https://toapis.com";
const NANO_MODEL = "gemini-3.1-flash-image-preview";
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 90;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1].split(";")[0] || "image/png", bytes };
  } catch {
    return null;
  }
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "png";
}

async function uploadBytes(
  apiKey: string,
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), filename);
  form.append("purpose", "generation");
  const res = await fetch(`${TOAPIS_ORIGIN}/v1/uploads/images`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const j = (await res.json()) as {
    success?: boolean;
    message?: string;
    data?: { url?: string };
  };
  if (!res.ok || j.success === false || !j.data?.url) {
    throw new Error(j.message || `ToAPIs 上传失败（HTTP ${res.status}）`);
  }
  return j.data.url;
}

async function ensureToapisImageUrl(apiKey: string, ref: string): Promise<string> {
  const t = ref.trim();
  if (t.startsWith("data:")) {
    const parsed = parseDataUrl(t);
    if (!parsed) throw new Error("无效的参考图 data URL");
    const ext = extFromMime(parsed.mime);
    return uploadBytes(apiKey, parsed.bytes, `upload.${ext}`, parsed.mime);
  }
  if (t.startsWith("https://") || t.startsWith("http://")) {
    const upstream = await fetch(t);
    if (!upstream.ok) throw new Error("无法拉取参考图 URL");
    const mime = upstream.headers.get("content-type") || "image/png";
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (buf.byteLength > 10 * 1024 * 1024) throw new Error("参考图超过 10MB（ToAPIs 上传限制）");
    const ext = extFromMime(mime);
    return uploadBytes(apiKey, buf, `ref.${ext}`, mime.split(";")[0] || "image/png");
  }
  throw new Error("参考图格式不支持（需 data URL 或 https URL）");
}

function extractTaskId(body: Record<string, unknown>): string | null {
  if (typeof body.id === "string" && body.id) return body.id;
  const d = body.data;
  if (d && typeof d === "object") {
    const o = d as { id?: string; task_id?: string };
    if (typeof o.id === "string" && o.id) return o.id;
    if (typeof o.task_id === "string") return o.task_id;
  }
  if (typeof body.task_id === "string") return body.task_id;
  return null;
}

function extractImageUrlFromPollPayload(j: Record<string, unknown>): string | null {
  const tryUrl = (x: unknown): string | null => {
    if (x && typeof x === "object" && typeof (x as { url?: string }).url === "string") {
      const u = (x as { url: string }).url;
      return u.length > 0 ? u : null;
    }
    return null;
  };

  const result = j.result;
  if (result && typeof result === "object") {
    const r = result as { data?: unknown[]; images?: unknown[] };
    const row = r.data?.[0] ?? r.images?.[0];
    const u = tryUrl(row);
    if (u) return u;
  }

  const data = j.data;
  if (data && typeof data === "object") {
    const d = data as { result?: unknown; url?: string };
    if (typeof d.url === "string") return d.url;
    if (d.result && typeof d.result === "object") {
      const r2 = d.result as { data?: unknown[] };
      const u = tryUrl(r2.data?.[0]);
      if (u) return u;
    }
  }

  const output = j.output;
  if (Array.isArray(output) && output[0]) {
    const u = tryUrl(output[0]);
    if (u) return u;
  }

  return null;
}

async function pollUntilImageUrl(apiKey: string, taskId: string): Promise<string> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const res = await fetch(`${TOAPIS_ORIGIN}/v1/images/generations/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`ToAPIs 轮询返回非 JSON（HTTP ${res.status}）`);
    }

    const inner =
      j.data && typeof j.data === "object" ? (j.data as Record<string, unknown>) : j;
    const status =
      (typeof inner.status === "string" ? inner.status : null) ||
      (typeof j.status === "string" ? j.status : null);

    if (status === "completed") {
      const url =
        extractImageUrlFromPollPayload(j) ||
        extractImageUrlFromPollPayload(inner) ||
        extractImageUrlFromPollPayload(
          inner.result && typeof inner.result === "object"
            ? (inner.result as Record<string, unknown>)
            : {},
        );
      if (url) return url;
      throw new Error(`ToAPIs 任务已完成但未解析到图片 URL：${text.slice(0, 500)}`);
    }

    if (status === "failed") {
      const err =
        (inner.error && typeof inner.error === "object" && (inner.error as { message?: string }).message) ||
        (j.error && typeof j.error === "object" && (j.error as { message?: string }).message) ||
        (typeof inner.fail_reason === "string" ? inner.fail_reason : null) ||
        (typeof j.fail_reason === "string" ? j.fail_reason : null) ||
        (typeof j.message === "string" ? j.message : null);
      throw new Error(err || "ToAPIs 生成失败");
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("生成超时，请稍后重试");
}

export async function apiToapisGenerateHandler(
  request: Request,
  env: { TOAPIS_API_KEY?: string },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return new Response("Not Found", { status: 404 });
  }

  const apiKey = env.TOAPIS_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Server missing TOAPIS_API_KEY binding" }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Body must be a JSON object" }, 400);
  }

  const incoming = body as Record<string, unknown>;
  const prompt = incoming.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return jsonResponse({ error: "prompt is required" }, 400);
  }
  if (prompt.length > 16000) {
    return jsonResponse({ error: "prompt too long" }, 400);
  }

  const aspectRaw =
    typeof incoming.aspect === "string" && incoming.aspect.trim()
      ? incoming.aspect.trim()
      : "3:4";
  if (!TOAPIS_ALLOWED_ASPECTS.has(aspectRaw)) {
    return jsonResponse({ error: `aspect 不在允许列表内（须为两模型共用的比例之一）` }, 400);
  }
  const aspect = aspectRaw;

  const resolution =
    typeof incoming.resolution === "string" && incoming.resolution.trim()
      ? incoming.resolution.trim()
      : "2K";

  const refs: string[] = [];
  if (incoming.image !== undefined) {
    if (typeof incoming.image === "string") {
      refs.push(incoming.image);
    } else if (Array.isArray(incoming.image)) {
      for (const x of incoming.image) {
        if (typeof x === "string") refs.push(x);
      }
    }
  }

  const uploaded: string[] = [];
  try {
    for (const r of refs) {
      uploaded.push(await ensureToapisImageUrl(apiKey, r));
    }
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "参考图处理失败" }, 400);
  }

  if (uploaded.length > 14) {
    return jsonResponse({ error: "Too many reference images (max 14)" }, 400);
  }

  const genBody: Record<string, unknown> = {
    model: NANO_MODEL,
    prompt: prompt.trim(),
    size: aspect,
    n: 1,
    metadata: { resolution },
  };
  if (uploaded.length > 0) {
    genBody.image_urls = uploaded;
  }

  const genRes = await fetch(`${TOAPIS_ORIGIN}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(genBody),
  });

  const genText = await genRes.text();
  let genJson: Record<string, unknown>;
  try {
    genJson = JSON.parse(genText) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: `ToAPIs 创建任务返回非 JSON：${genText.slice(0, 200)}` }, 502);
  }

  if (!genRes.ok) {
    const msg =
      (typeof genJson.message === "string" && genJson.message) ||
      (genJson.error && typeof genJson.error === "object"
        ? String((genJson.error as { message?: string }).message || "")
        : "") ||
      genText.slice(0, 300);
    return jsonResponse({ error: msg || `ToAPIs 创建任务失败（HTTP ${genRes.status}）` }, 502);
  }

  const taskId = extractTaskId(genJson);
  if (!taskId) {
    return jsonResponse({ error: `ToAPIs 响应缺少任务 id：${genText.slice(0, 400)}` }, 502);
  }

  try {
    const imageUrl = await pollUntilImageUrl(apiKey, taskId);
    return jsonResponse({ data: [{ url: imageUrl }] }, 200);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : "生成失败" }, 502);
  }
}
