export type ArkGenerateResponse = {
  data?: Array<{ url?: string; b64_json?: string; size?: string }>;
  error?: { message?: string; code?: string; type?: string };
};

function pickErrorMessage(text: string, json: unknown): string {
  if (json && typeof json === "object") {
    const root = json as { error?: unknown; message?: string };
    if (typeof root.error === "string" && root.error.trim()) return root.error.trim();
    if (root.error && typeof root.error === "object") {
      const msg = (root.error as { message?: string }).message;
      if (typeof msg === "string" && msg.trim()) return msg.trim();
    }
    if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.includes("<html")) {
    return "服务端返回了非 JSON 页面（常见于本地 Functions 崩溃）。请查看终端 wrangler 日志，或检查网络/代理设置。";
  }
  return trimmed || "生成失败";
}

async function parseGenerateResponse(res: Response): Promise<ArkGenerateResponse> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-json
  }

  if (!res.ok) {
    throw new Error(pickErrorMessage(text, json));
  }

  return (json || {}) as ArkGenerateResponse;
}

export async function callArkGenerate(payload: Record<string, unknown>): Promise<ArkGenerateResponse> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseGenerateResponse(res);
}

/** ToAPIs Nano banana 2（gemini-3.1-flash-image-preview），异步任务由 Worker 轮询完成后返回与方舟一致的 data[0].url */
export async function callToapisGenerate(payload: {
  prompt: string;
  aspect?: string;
  resolution?: string;
  image?: string | string[];
}): Promise<ArkGenerateResponse> {
  const res = await fetch("/api/generate-toapis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseGenerateResponse(res);
}

export function firstImageUrl(resp: ArkGenerateResponse): string | null {
  const url = resp.data?.[0]?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}
