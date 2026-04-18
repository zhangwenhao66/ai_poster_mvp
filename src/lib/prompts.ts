export function buildInitialPrompt(input: {
  posterCopy: string;
  smartStyle: boolean;
  hasTemplate: boolean;
}): string {
  const poster = input.posterCopy.trim();
  const lines: string[] = [];
  lines.push("你是餐饮门店海报设计助手。请输出一张可用于打印或线上传播的商业海报。");
  lines.push("要求：信息层级清晰、文字可读（避免过细字体）、配色有食欲感但不俗气、留白克制。");
  if (input.hasTemplate) {
    lines.push(
      "用户提供了模板参考图（通常排在参考图的第一张）：请尽量吸收模板的版式气质、配色与装饰元素，但必须融合后续用户素材图的主体信息，不要只做简单拼贴。",
    );
  } else if (input.smartStyle) {
    lines.push(
      "用户未选择具体模板（智能风格）：请根据素材与文案自动选择更合适的餐饮海报风格（版式、配色、光影、字体气质），并保持整体统一专业。",
    );
  }
  lines.push("海报需要呈现的核心文案/要素如下（请合理排版，不要遗漏关键信息）：");
  lines.push(poster);
  lines.push(
    "如有多张参考图：请综合理解每张图的信息层级，突出主招牌/主菜品；避免画面拥挤。除非用户明确要求，否则不要自行添加虚构价格、电话、地址。",
  );
  return lines.join("\n");
}

export function buildModifyPrompt(editInstruction: string): string {
  const t = editInstruction.trim();
  return [
    "在尽量保持当前海报整体构图与商业信息不变的前提下，按用户的修改意见进行图像编辑。",
    "修改应尽量局部化：只调整需要调整的区域，其它区域尽量少改动。",
    "修改意见如下：",
    t,
  ].join("\n");
}
