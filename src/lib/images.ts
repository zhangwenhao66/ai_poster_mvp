export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
    reader.readAsDataURL(blob);
  });
}

export async function fetchUrlAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("模板图片加载失败");
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

/**
 * 生图 URL 多为第三方 CDN，浏览器直连会因无 CORS 而失败；改为走同源 `/api/download-image` 代理。
 */
export async function downloadImage(url: string, filename: string): Promise<void> {
  const ua = navigator.userAgent || "";
  const isIOS = /iP(hone|ad|od)/i.test(ua);
  // await 之后会丢失手势；iOS 需先同步打开占位页，再写入 blob URL，否则弹窗易被拦截
  const iosPopup = isIOS ? window.open("about:blank", "_blank", "noopener,noreferrer") : null;

  const res = await fetch("/api/download-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, filename }),
  });

  if (!res.ok) {
    iosPopup?.close();
    let msg = `下载失败（${res.status}）`;
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) msg = j.error.trim();
    } catch {
      try {
        const t = await res.text();
        if (t.trim()) msg = t.trim().slice(0, 200);
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  if (isIOS) {
    if (iosPopup && !iosPopup.closed) {
      iosPopup.location.href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
      return;
    }
    URL.revokeObjectURL(objectUrl);
    throw new Error("无法打开新窗口。请在 Safari 中允许弹窗，或长按上方预览图选择「存储到照片」。");
  }

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    a.remove();
    URL.revokeObjectURL(objectUrl);
  });
}
