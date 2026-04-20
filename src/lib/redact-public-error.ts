/** 展示给用户前，弱化上游返回里的模型名、域名等技术指纹 */
export function redactPublicErrorMessage(raw: string): string {
  const s = raw
    .replace(/\bdoubao-[a-z0-9-]+\b/gi, "")
    .replace(/\bgemini-[a-z0-9.-]+\b/gi, "")
    .replace(/\b[a-z0-9.-]+\.volces\.com\b/gi, "")
    .replace(/\b[a-z0-9.-]+\.volcengine\.com\b/gi, "")
    .replace(/\btoapis\.com\b/gi, "")
    .replace(/\bark\.cn-beijing\.volces\.com\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,.\s]+|[，,.\s]+$/g, "")
    .trim();
  return s.length > 0 ? s : "请求失败，请稍后重试";
}
