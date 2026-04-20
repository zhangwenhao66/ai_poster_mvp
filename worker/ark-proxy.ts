import { SEEDREAM_ALLOWED_SIZES } from "./aspect-constants";

const ARK_URL = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const MAX_BODY_BYTES = 28 * 1024 * 1024;

type ArkImagePayload = {
  model?: string;
  prompt: string;
  image?: string | string[];
  size?: string;
  sequential_image_generation?: string;
  sequential_image_generation_options?: { max_images?: number };
  output_format?: string;
  response_format?: string;
  stream?: boolean;
  watermark?: boolean;
  tools?: unknown;
  optimize_prompt_options?: { mode?: string };
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isTransientNetError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("network connection lost") ||
    m.includes("premature close") ||
    m.includes("prematurely") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("socket") ||
    m.includes("fetch failed") ||
    m.includes("connection reset") ||
    m.includes("broken pipe")
  );
}

async function forwardToArk(apiKey: string, jsonBody: string): Promise<Response> {
  const attempts = 4;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const upstream = await fetch(ARK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${apiKey}`,
          "accept-encoding": "identity",
        },
        body: jsonBody,
      });
      const buf = await upstream.arrayBuffer();
      const text = decoder.decode(buf);
      return new Response(text, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        },
      });
    } catch (err) {
      lastErr = err;
      const detail = err instanceof Error ? err.message : String(err);
      const canRetry = i < attempts - 1 && isTransientNetError(detail);
      if (canRetry) {
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
        continue;
      }
      break;
    }
  }

  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const hint =
    isTransientNetError(detail) || detail.includes("Network")
      ? "网络不稳定或中断较常见，可稍后重试，或检查本机代理与网络设置。"
      : "";
  return jsonResponse(
    {
      error: {
        type: "upstream_failed",
        code: "UpstreamNetworkError",
        message: `制图服务暂时不可用（${detail}）。${hint}`,
      },
    },
    502,
  );
}

async function handlePost(request: Request, env: { ARK_API_KEY: string }): Promise<Response> {
  const apiKey = env.ARK_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: "服务未就绪，请联系管理员" }, 500);
  }

  const len = Number(request.headers.get("content-length") || "0");
  if (len > MAX_BODY_BYTES) {
    return jsonResponse({ error: "请求内容过大" }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "请求格式无效" }, 400);
  }

  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "请求体无效" }, 400);
  }

  const incoming = body as Record<string, unknown>;
  const prompt = incoming.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return jsonResponse({ error: "请填写创作说明" }, 400);
  }
  if (prompt.length > 8000) {
    return jsonResponse({ error: "创作说明过长" }, 400);
  }

  const model =
    typeof incoming.model === "string" && incoming.model.trim()
      ? incoming.model.trim()
      : "doubao-seedream-5-0-260128";

  let sizeStr: string;
  if (typeof incoming.size === "string" && incoming.size.trim()) {
    const s = incoming.size.trim();
    if (s === "2k" || s === "3k") {
      sizeStr = s;
    } else if (/^\d+x\d+$/.test(s)) {
      if (!SEEDREAM_ALLOWED_SIZES.has(s)) {
        return jsonResponse({ error: "成图尺寸参数无效，请刷新页面后重试" }, 400);
      }
      sizeStr = s;
    } else {
      return jsonResponse({ error: "成图尺寸格式无效，请刷新页面后重试" }, 400);
    }
  } else {
    sizeStr = "3k";
  }

  const payload: ArkImagePayload = {
    model,
    prompt: prompt.trim(),
    size: sizeStr,
    sequential_image_generation:
      typeof incoming.sequential_image_generation === "string"
        ? incoming.sequential_image_generation
        : "disabled",
    output_format:
      typeof incoming.output_format === "string" ? incoming.output_format : "png",
    response_format:
      typeof incoming.response_format === "string" ? incoming.response_format : "url",
    stream: typeof incoming.stream === "boolean" ? incoming.stream : false,
    watermark: typeof incoming.watermark === "boolean" ? incoming.watermark : false,
  };

  if (incoming.image !== undefined) {
    if (typeof incoming.image === "string") {
      payload.image = incoming.image;
    } else if (Array.isArray(incoming.image)) {
      const imgs = incoming.image.filter((x): x is string => typeof x === "string");
      if (imgs.length > 14) {
        return jsonResponse({ error: "参考图过多（最多 14 张）" }, 400);
      }
      payload.image = imgs;
    } else {
      return jsonResponse({ error: "参考图格式无效" }, 400);
    }
  }

  if (
    incoming.sequential_image_generation_options &&
    typeof incoming.sequential_image_generation_options === "object" &&
    incoming.sequential_image_generation_options !== null
  ) {
    const o = incoming.sequential_image_generation_options as Record<string, unknown>;
    const maxImages = o.max_images;
    payload.sequential_image_generation_options = {
      max_images: typeof maxImages === "number" ? maxImages : undefined,
    };
  }

  if (incoming.optimize_prompt_options && typeof incoming.optimize_prompt_options === "object") {
    const o = incoming.optimize_prompt_options as Record<string, unknown>;
    if (typeof o.mode === "string") {
      payload.optimize_prompt_options = { mode: o.mode };
    }
  }

  if (incoming.tools !== undefined) {
    payload.tools = incoming.tools;
  }

  const jsonBody = JSON.stringify(payload);
  return forwardToArk(apiKey, jsonBody);
}

/** Pages Function 与 Worker 共用：处理 /api/generate */
export async function apiGenerateHandler(
  request: Request,
  env: { ARK_API_KEY: string },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Not Found", { status: 404 });
  }

  return handlePost(request, env);
}
