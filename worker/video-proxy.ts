/**
 * 火山方舟「视频生成」异步任务：创建 + 查询（由前端轮询查询，避免单次 Worker 内大量 subrequest）。
 * POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
 * GET  https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}
 */

const ARK_VIDEO_CREATE = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const DEFAULT_VIDEO_MODEL = "doubao-seedance-2-0-260128";

const ALLOWED_RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]);
const ALLOWED_RES = new Set(["480p", "720p", "1080p"]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

async function arkFetch(
  apiKey: string,
  url: string,
  options: { method: "GET" | "POST"; body?: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "accept-encoding": "identity",
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json; charset=utf-8";
  }
  return fetch(url, { method: options.method, headers, body: options.body });
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: string };

export async function apiVideoCreateHandler(
  request: Request,
  env: { ARK_API_KEY: string },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = env.ARK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Server missing ARK_API_KEY binding" }, 500);
  }

  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Request body too large" }, 413);
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

  const images = incoming.images;
  if (!Array.isArray(images) || images.length === 0) {
    return jsonResponse({ error: "images must be a non-empty string array (data URLs or https URLs)" }, 400);
  }
  if (images.length > 8) {
    return jsonResponse({ error: "Too many images (max 8)" }, 400);
  }
  const imageUrls: string[] = [];
  for (const x of images) {
    if (typeof x !== "string" || !x.trim()) {
      return jsonResponse({ error: "Each image must be a non-empty string" }, 400);
    }
    const u = x.trim();
    if (!u.startsWith("data:") && !u.startsWith("https://") && !u.startsWith("http://")) {
      return jsonResponse({ error: "Each image must be a data URL or http(s) URL" }, 400);
    }
    imageUrls.push(u);
  }

  const model =
    typeof incoming.model === "string" && incoming.model.trim()
      ? incoming.model.trim()
      : DEFAULT_VIDEO_MODEL;

  const ratioRaw = typeof incoming.ratio === "string" ? incoming.ratio.trim() : "9:16";
  if (!ALLOWED_RATIOS.has(ratioRaw)) {
    return jsonResponse({ error: "Invalid ratio" }, 400);
  }

  const resolutionRaw = typeof incoming.resolution === "string" ? incoming.resolution.trim() : "720p";
  if (!ALLOWED_RES.has(resolutionRaw)) {
    return jsonResponse({ error: "Invalid resolution" }, 400);
  }

  let duration: number;
  if (incoming.duration === -1) {
    duration = -1;
  } else if (typeof incoming.duration === "number" && Number.isInteger(incoming.duration)) {
    duration = incoming.duration;
  } else {
    duration = 6;
  }
  if (duration !== -1 && (duration < 4 || duration > 15)) {
    return jsonResponse({ error: "duration must be -1 or integer in [4, 15]" }, 400);
  }

  const generateAudio = typeof incoming.generate_audio === "boolean" ? incoming.generate_audio : true;
  const watermark = typeof incoming.watermark === "boolean" ? incoming.watermark : false;

  const content: ContentPart[] = [{ type: "text", text: prompt.trim() }];
  for (const url of imageUrls) {
    content.push({
      type: "image_url",
      image_url: { url },
      role: "reference_image",
    });
  }

  const payload: Record<string, unknown> = {
    model,
    content,
    ratio: ratioRaw,
    resolution: resolutionRaw,
    duration,
    generate_audio: generateAudio,
    watermark,
  };

  if (typeof incoming.return_last_frame === "boolean") {
    payload.return_last_frame = incoming.return_last_frame;
  }
  if (typeof incoming.service_tier === "string" && incoming.service_tier.trim()) {
    payload.service_tier = incoming.service_tier.trim();
  }

  const upstream = await arkFetch(apiKey, ARK_VIDEO_CREATE, { method: "POST", body: JSON.stringify(payload) });

  const text = await upstream.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return jsonResponse({ error: text.slice(0, 400) || "Upstream non-JSON" }, upstream.ok ? 502 : upstream.status);
  }

  if (!upstream.ok) {
    const err =
      json && typeof json === "object"
        ? (json as { error?: { message?: string }; message?: string }).error?.message ||
          (json as { message?: string }).message
        : null;
    return jsonResponse({ error: err || text.slice(0, 400) }, upstream.status >= 400 ? upstream.status : 502);
  }

  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

export async function apiVideoTaskHandler(
  request: Request,
  env: { ARK_API_KEY: string },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = env.ARK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "Server missing ARK_API_KEY binding" }, 500);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return jsonResponse({ error: "Query id is required" }, 400);
  }

  const taskUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(id)}`;
  const upstream = await arkFetch(apiKey, taskUrl, { method: "GET" });
  const text = await upstream.text();

  if (!upstream.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
      msg = j.error?.message || j.message || msg;
    } catch {
      /* keep */
    }
    return jsonResponse({ error: msg }, upstream.status >= 400 ? upstream.status : 502);
  }

  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}
