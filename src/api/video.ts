export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | string;

export type VideoCreateResponse = {
  id?: string;
  error?: { message?: string } | string;
  message?: string;
};

export type VideoTaskResponse = {
  id?: string;
  status?: VideoTaskStatus;
  error?: { message?: string; code?: string } | null;
  content?: { video_url?: string; last_frame_url?: string } | null;
  message?: string;
};

function pickErr(text: string, json: unknown): string {
  if (json && typeof json === "object") {
    const o = json as { error?: { message?: string }; message?: string };
    if (o.error && typeof o.error === "object" && typeof o.error.message === "string") return o.error.message;
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  }
  return text.trim() || "请求失败";
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
