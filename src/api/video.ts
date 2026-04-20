export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | string;

export type VideoCreateResponse = {
  id?: string;
  error?: { message?: string } | string;
  message?: string;
};

import { redactPublicErrorMessage } from "../lib/redact-public-error";

export type VideoTaskResponse = {
  id?: string;
  status?: VideoTaskStatus;
  error?: { message?: string; code?: string } | null;
  content?: { video_url?: string; last_frame_url?: string } | null;
  message?: string;
};

function pickErr(text: string, json: unknown): string {
  let inner = "请求失败";
  if (json && typeof json === "object") {
    const o = json as { error?: unknown; message?: string };
    if (typeof o.error === "string" && o.error.trim()) inner = o.error.trim();
    else if (o.error && typeof o.error === "object" && typeof (o.error as { message?: string }).message === "string") {
      inner = String((o.error as { message: string }).message);
    } else if (typeof o.message === "string" && o.message.trim()) {
      inner = o.message.trim();
    }
  } else if (text.trim()) {
    inner = text.trim();
  }
  return redactPublicErrorMessage(inner);
}

export async function createVideoTask(payload: {
  prompt: string;
  images: string[];
  model?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
}): Promise<VideoCreateResponse> {
  const res = await fetch("/api/video/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  if (!res.ok) {
    throw new Error(pickErr(text, json));
  }
  return (json || {}) as VideoCreateResponse;
}

export async function getVideoTask(id: string): Promise<VideoTaskResponse> {
  const res = await fetch(`/api/video/task?id=${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  if (!res.ok) {
    throw new Error(pickErr(text, json));
  }
  return (json || {}) as VideoTaskResponse;
}
