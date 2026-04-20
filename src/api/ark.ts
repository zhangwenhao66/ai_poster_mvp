import { redactPublicErrorMessage } from "../lib/redact-public-error";

export type ArkGenerateResponse = {
  data?: Array<{ url?: string; b64_json?: string; size?: string }>;
  error?: { message?: string; code?: string; type?: string };
};

function pickErrorMessage(text: string, json: unknown): string {
  let inner: string | null = null;
  if (json && typeof json === "object") {
    const root = json as { error?: unknown; message?: string };
    if (typeof root.error === "string" && root.error.trim()) inner = root.error.trim();
    else if (root.error && typeof root.error === "object") {
      const msg = (root.error as { message?: string }).message;
      if (typeof msg === "string" && msg.trim()) inner = msg.trim();
    }
    if (!inner && typeof root.message === "string" && root.message.trim()) inner = root.message.trim();
  }
  if (!inner) {
    const trimmed = text.trim();
    if (trimmed.startsWith("<!DOCTYPE") || trimmed.includes("<html")) {
      inner = "服务暂时不可用，请稍后重试或检查网络设置。";
    } else {
      inner = trimmed || "生成失败";
    }
  }
  return redactPublicErrorMessage(inner);
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

/** 备选制图通道（异步任务，完成后返回图片地址） */
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
