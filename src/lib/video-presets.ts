/** 短视频内容方向（偏抖音 / 小红书传播） */
export const VIDEO_DIRECTIONS = [
  {
    id: "dish_hook",
    label: "菜品特写 · 食欲种草",
    hint: "突出色泽、蒸汽与质感，适合新品/爆款菜",
  },
  {
    id: "store_vibe",
    label: "门店氛围 · 探店感",
    hint: "环境、灯光、桌景，适合「打卡」「氛围感」叙事",
  },
  {
    id: "kitchen_process",
    label: "后厨 / 制作过程",
    hint: "手与锅、出餐节奏，适合「现做」「锅气」卖点",
  },
  {
    id: "deal_promo",
    label: "优惠团购 · 促销口播",
    hint: "价格锚点、套餐组合，语气偏促销但不低俗",
  },
  {
    id: "story_ip",
    label: "老板故事 / 匠心人设",
    hint: "轻剧情、口述感，适合建立信任与记忆点",
  },
] as const;

export type VideoDirectionId = (typeof VIDEO_DIRECTIONS)[number]["id"];

export type ShortVideoPlatform = "douyin" | "xiaohongshu";

export function buildVideoPrompt(input: {
  directionId: VideoDirectionId;
  platform: ShortVideoPlatform;
  extra?: string;
}): string {
  const platformLine =
    input.platform === "douyin"
      ? "平台调性：抖音短视频——节奏快、前 2 秒强钩子、转场利落、可有口播感与字幕位留白。"
      : "平台调性：小红书——审美清新、生活感、可「种草」语气、画面干净有留白便于后期加花字。";

  const bodyByDirection: Record<VideoDirectionId, string> = {
    dish_hook:
      "内容方向：餐饮「菜品特写」短视频。用参考图里的食物/餐具为主体，生成有食欲的动态镜头：可含缓慢推近、油光与蒸汽暗示、酱汁流动感、餐具碰撞轻节奏；避免恐怖谷或失真人脸；不要替换为与参考图无关的另一道菜。",
    store_vibe:
      "内容方向：「探店 / 门店氛围」短视频。基于参考图中的环境与陈设，生成有空间纵深与灯光层次的镜头运动（如横移、轻摇、景深变化）；突出干净、好拍、值得打卡的气质；不要虚构与参考图完全无关的另一家店。",
    kitchen_process:
      "内容方向：「后厨 / 制作过程」短视频。强调手部动作与器具（若参考图可见），节奏紧凑、有烟火气但不过度脏乱；镜头以中近景为主；若参考图不含人物，避免凭空生成清晰真人正脸。",
    deal_promo:
      "内容方向：「优惠活动 / 团购」短视频。画面配合促销叙事：可展示套餐组合、分量大、性价比感；语气积极可信；避免虚假极限词（如「全国第一」），价格数字仅在用户文案明确给出时才口播或上屏。",
    story_ip:
      "内容方向：「老板 / 匠心故事」轻叙事短视频。温暖、真诚、偏纪实感镜头；若参考图无真人，可用画外旁白感与空镜/手部镜头完成情绪，不要硬生成可辨认的虚构真人面孔。",
  };

  const extra = (input.extra ?? "").trim();
  const extraBlock = extra ? `\n用户补充要求：${extra}\n` : "";

  return [
    "你是专业餐饮短视频导演与分镜师。请严格依据用户上传的参考图片生成一段适合手机全屏观看的成片（见下方技术参数由系统指定）。",
    platformLine,
    bodyByDirection[input.directionId],
    "画面要求：竖屏构图安全区考虑后期加标题；运动稳定、色彩自然偏暖食欲；音画可同步生成时，人声/环境音与画面情绪一致。",
    "合规：避免出现可识别的未授权他人肖像；避免出现未授权商标特写；禁止血腥暴力。",
    extraBlock,
  ]
    .filter(Boolean)
    .join("\n");
}
