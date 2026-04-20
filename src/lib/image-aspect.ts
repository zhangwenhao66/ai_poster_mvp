/**
 * 两路制图共用的画幅比例；各比例对应 `seedreamSize`（像素 WxH）供默认制图通道使用。
 * 与 `worker/aspect-constants.ts` 须同步维护（Worker 不能引用本文件）。
 */
export const IMAGE_ASPECT_OPTIONS = [
  { ratio: "1:1", seedreamSize: "3072x3072", label: "1:1 方形" },
  { ratio: "3:4", seedreamSize: "2592x3456", label: "3:4 竖版" },
  { ratio: "4:3", seedreamSize: "3456x2592", label: "4:3 横版" },
  { ratio: "16:9", seedreamSize: "4096x2304", label: "16:9 宽屏" },
  { ratio: "9:16", seedreamSize: "2304x4096", label: "9:16 竖屏" },
  { ratio: "2:3", seedreamSize: "2496x3744", label: "2:3 竖照片" },
  { ratio: "3:2", seedreamSize: "3744x2496", label: "3:2 横照片" },
  { ratio: "21:9", seedreamSize: "4704x2016", label: "21:9 超宽" },
] as const;

export type SharedAspectRatio = (typeof IMAGE_ASPECT_OPTIONS)[number]["ratio"];

export const DEFAULT_ASPECT_RATIO: SharedAspectRatio = "3:4";

const RATIO_TO_SIZE = Object.fromEntries(
  IMAGE_ASPECT_OPTIONS.map((o) => [o.ratio, o.seedreamSize]),
) as Record<SharedAspectRatio, string>;

export function seedreamSizeForAspect(ratio: string): string {
  if (ratio in RATIO_TO_SIZE) return RATIO_TO_SIZE[ratio as SharedAspectRatio];
  return RATIO_TO_SIZE[DEFAULT_ASPECT_RATIO];
}

export function isSharedAspectRatio(r: string): r is SharedAspectRatio {
  return r in RATIO_TO_SIZE;
}
