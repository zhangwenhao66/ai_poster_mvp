/** 与 `src/lib/image-aspect.ts` 保持一致，供 Worker 校验（Worker 不宜依赖 src） */
export const SEEDREAM_ALLOWED_SIZES = new Set([
  "3072x3072",
  "2592x3456",
  "3456x2592",
  "4096x2304",
  "2304x4096",
  "2496x3744",
  "3744x2496",
  "4704x2016",
]);

export const TOAPIS_ALLOWED_ASPECTS = new Set([
  "1:1",
  "3:4",
  "4:3",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
]);
