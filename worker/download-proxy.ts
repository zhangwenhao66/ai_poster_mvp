/**
 * 浏览器无法直接 fetch 第三方生图 URL（无 CORS），通过同源 Worker 拉取后再交给前端保存。
 */

const ALLOWED_HOST_SUFFIXES = [
  ".volces.com",
  ".volcengine.com",
  ".byteimg.com",
  ".byted.org",
  ".bytedance.net",
  ".pstatp.com",
  ".toapis.com",
];

function isPrivateOrBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h.startsWith("127.")) return true;
  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("169.254.")) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

export function isAllowedRemoteImageUrl(urlString: string): boolean {
  let u: URL;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const hostname = u.hostname.toLowerCase();
  if (isPrivateOrBlockedHost(hostname)) return false;
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().slice(0, 120);
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
  if (
    safe.endsWith(".png") ||
    safe.endsWith(".jpg") ||
    safe.endsWith(".jpeg") ||
    safe.endsWith(".webp") ||
    safe.endsWith(".mp4")
  ) {
    return safe.slice(0, 100);
  }
  return `${(safe || "ai-poster").slice(0, 80)}.png`;
}

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function downloadImageProxyHandler(request: Request): Promise<Response> {
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
    return jsonResponse({ error: "请求方法不允许" }, 405);
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

  const o = body as Record<string, unknown>;
  const url = o.url;
  if (typeof url !== "string" || !url.trim()) {
    return jsonResponse({ error: "缺少下载地址" }, 400);
  }

  if (!isAllowedRemoteImageUrl(url)) {
    return jsonResponse({ error: "该地址不允许下载" }, 403);
  }

  const filename =
    typeof o.filename === "string" && o.filename.trim() ? sanitizeFilename(o.filename) : "ai-poster.png";

  const upstream = await fetch(url.trim(), {
    redirect: "follow",
    headers: { "User-Agent": "ai-poster-worker/1.0" },
  });

  if (!upstream.ok) {
    return jsonResponse({ error: `文件拉取失败（${upstream.status}）` }, 502);
  }

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const okMedia =
    ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("application/octet-stream");
  if (!okMedia) {
    return jsonResponse({ error: "返回内容不是可下载的图片或视频" }, 502);
  }

  const headers = new Headers();
  headers.set("Content-Type", ct);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "private, no-store");

  return new Response(upstream.body, { status: 200, headers });
}
