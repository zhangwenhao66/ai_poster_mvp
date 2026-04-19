import { useEffect, useMemo, useRef, useState } from "react";
import { callArkGenerate, callToapisGenerate, firstImageUrl } from "./api/ark";
import { downloadImage, fetchUrlAsDataUrl, fileToDataUrl } from "./lib/images";
import { buildDishPhotoPrompt, buildInitialPrompt, buildModifyPrompt } from "./lib/prompts";
import type { TemplateCategory, TemplateIndex, TemplateItem } from "./types/templates";

const MODEL = "doubao-seedream-5-0-260128";
/** 方舟图生接口仅支持 `2k`、`3k` 或 WIDTHxHEIGHT，不支持 4K */
const IMAGE_SIZE = "3k";
const MAX_MODIFICATIONS = 5;
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const MAX_UPLOAD_FILES = 8;

type WizardStep = 1 | 2 | 3;
type FeatureTab = "poster" | "dish";
/** 模型1：火山 Seedream；模型2：ToAPIs 图生图 */
type ImageModelId = "seedream" | "nano";

function uid(): string {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function App() {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [templateIndex, setTemplateIndex] = useState<TemplateIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const [smartStyle, setSmartStyle] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem | null>(null);

  const [uploads, setUploads] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [posterCopy, setPosterCopy] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [modifyCount, setModifyCount] = useState(0);

  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyText, setModifyText] = useState("");

  /** 当前分类下模板列表中的下标；`null` 表示预览弹层关闭 */
  const [templatePreviewIndex, setTemplatePreviewIndex] = useState<number | null>(null);

  const [activeFeature, setActiveFeature] = useState<FeatureTab>("poster");
  const [dishUpload, setDishUpload] = useState<{ file: File; previewUrl: string } | null>(null);

  const [imageModel, setImageModel] = useState<ImageModelId>("seedream");
  /** 当前结果图是用哪条链路生成的，修改时必须一致 */
  const [lastGenerateModel, setLastGenerateModel] = useState<ImageModelId | null>(null);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const dishUploadRef = useRef(dishUpload);
  dishUploadRef.current = dishUpload;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/templates/template-index.json", { cache: "no-store" });
        const json = (await res.json()) as TemplateIndex;
        if (cancelled) return;
        setTemplateIndex(json);
        const first = json.categories[0]?.id ?? null;
        setActiveCategory(first);
        setIndexError(null);
      } catch {
        if (!cancelled) setIndexError("模板索引加载失败：请确认已执行 npm run prepare:templates 并完成构建。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const u of uploadsRef.current) URL.revokeObjectURL(u.previewUrl);
    };
  }, []);

  useEffect(() => {
    return () => {
      const d = dishUploadRef.current;
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
    };
  }, []);

  const categories = templateIndex?.categories ?? [];
  const activeCat: TemplateCategory | null = useMemo(() => {
    if (!activeCategory) return categories[0] ?? null;
    return categories.find((c) => c.id === activeCategory) ?? categories[0] ?? null;
  }, [activeCategory, categories]);

  useEffect(() => {
    setTemplatePreviewIndex(null);
  }, [activeCategory]);

  useEffect(() => {
    if (templatePreviewIndex === null || !activeCat) return;
    const len = activeCat.templates.length;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTemplatePreviewIndex(null);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setTemplatePreviewIndex((i) => (i === null || len <= 0 ? i : Math.max(0, i - 1)));
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setTemplatePreviewIndex((i) => (i === null || len <= 0 ? i : Math.min(len - 1, i + 1)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [templatePreviewIndex, activeCat]);

  useEffect(() => {
    if (templatePreviewIndex === null || !activeCat?.templates.length) return;
    const max = activeCat.templates.length - 1;
    if (templatePreviewIndex > max) setTemplatePreviewIndex(max);
  }, [templatePreviewIndex, activeCat]);

  const remainingMods = Math.max(0, MAX_MODIFICATIONS - modifyCount);
  const hasTemplate = Boolean(selectedTemplate) && !smartStyle;

  const canNextFrom1 = smartStyle || Boolean(selectedTemplate);
  const canNextFrom2 = uploads.length > 0;
  const canNextFrom3 = posterCopy.trim().length > 0;

  function resetOutputs() {
    setError(null);
    setResultUrl(null);
    setModifyCount(0);
    setLastGenerateModel(null);
  }

  function switchFeature(next: FeatureTab) {
    setActiveFeature(next);
    setError(null);
    setResultUrl(null);
    setModifyCount(0);
    setLastGenerateModel(null);
    setModifyOpen(false);
    setModifyText("");
  }

  function onDishFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请上传一张图片文件。");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`单张图片过大（>${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB），请压缩后再试。`);
      return;
    }
    setDishUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
    setError(null);
  }

  function clearDishUpload() {
    setDishUpload((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function handleDishGenerate() {
    if (!dishUpload) return;
    resetOutputs();
    setLoading(true);
    setError(null);
    try {
      const prompt = buildDishPhotoPrompt();
      const image = await fileToDataUrl(dishUpload.file);
      if (imageModel === "nano") {
        const resp = await callToapisGenerate({
          prompt,
          aspect: "4:5",
          resolution: "2K",
          image,
        });
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
        setLastGenerateModel("nano");
      } else {
        const body: Record<string, unknown> = {
          model: MODEL,
          prompt,
          image,
          size: IMAGE_SIZE,
          sequential_image_generation: "disabled",
          output_format: "png",
          response_format: "url",
          stream: false,
          watermark: false,
        };
        const resp = await callArkGenerate(body);
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
        setLastGenerateModel("seedream");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function onPickTemplate(t: TemplateItem) {
    setSelectedTemplate(t);
    setSmartStyle(false);
  }

  function openTemplatePreview(t: TemplateItem) {
    const list = activeCat?.templates ?? [];
    const idx = list.findIndex((x) => x.id === t.id);
    setTemplatePreviewIndex(idx >= 0 ? idx : 0);
  }

  function closeTemplatePreview() {
    setTemplatePreviewIndex(null);
  }

  function confirmUseTemplateAndNext() {
    if (templatePreviewIndex === null || !activeCat) return;
    const t = activeCat.templates[templatePreviewIndex];
    if (!t) return;
    onPickTemplate(t);
    setTemplatePreviewIndex(null);
    setWizardStep(2);
  }

  function onToggleSmartStyle(next: boolean) {
    setSmartStyle(next);
    if (next) setSelectedTemplate(null);
  }

  async function onAddFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    setError(null);
    const next: Array<{ id: string; file: File; previewUrl: string }> = [];
    for (const file of Array.from(fileList)) {
      if (!file.type.startsWith("image/")) {
        setError("仅支持上传图片文件。");
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`单张图片过大（>${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB），请压缩后再试。`);
        continue;
      }
      if (uploads.length + next.length >= MAX_UPLOAD_FILES) {
        setError(`最多上传 ${MAX_UPLOAD_FILES} 张图片。`);
        break;
      }
      next.push({ id: uid(), file, previewUrl: URL.createObjectURL(file) });
    }
    if (next.length) setUploads((prev) => [...prev, ...next]);
  }

  function removeUpload(id: string) {
    setUploads((prev) => {
      const u = prev.find((x) => x.id === id);
      if (u) URL.revokeObjectURL(u.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function buildReferenceImagesForInitial(): Promise<string[]> {
    const images: string[] = [];
    if (hasTemplate && selectedTemplate) {
      const abs = new URL(selectedTemplate.path, window.location.origin).toString();
      images.push(await fetchUrlAsDataUrl(abs));
    }
    for (const u of uploads) {
      images.push(await fileToDataUrl(u.file));
    }
    return images;
  }

  async function handleGenerateInitial() {
    resetOutputs();
    setLoading(true);
    setError(null);
    try {
      const prompt = buildInitialPrompt({
        posterCopy,
        smartStyle,
        hasTemplate,
      });
      const imageArr = await buildReferenceImagesForInitial();

      if (imageModel === "nano") {
        const resp = await callToapisGenerate({
          prompt,
          aspect: "3:4",
          resolution: "2K",
          image:
            imageArr.length === 0
              ? undefined
              : imageArr.length === 1
                ? imageArr[0]
                : imageArr,
        });
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
        setLastGenerateModel("nano");
      } else {
        const body: Record<string, unknown> = {
          model: MODEL,
          prompt,
          size: IMAGE_SIZE,
          sequential_image_generation: "disabled",
          output_format: "png",
          response_format: "url",
          stream: false,
          watermark: false,
        };
        if (imageArr.length > 0) body.image = imageArr.length === 1 ? imageArr[0] : imageArr;

        const resp = await callArkGenerate(body);
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
        setLastGenerateModel("seedream");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleModifyConfirm() {
    if (!resultUrl) return;
    if (modifyCount >= MAX_MODIFICATIONS) return;
    const instruction = modifyText.trim();
    if (!instruction) {
      setError("请输入修改描述。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const prompt = buildModifyPrompt(instruction, activeFeature === "dish" ? "dish" : "poster");
      const modelForModify = lastGenerateModel ?? imageModel;

      if (modelForModify === "nano") {
        const resp = await callToapisGenerate({
          prompt,
          aspect: activeFeature === "dish" ? "4:5" : "3:4",
          resolution: "2K",
          image: resultUrl,
        });
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
      } else {
        const resp = await callArkGenerate({
          model: MODEL,
          prompt,
          image: resultUrl,
          size: IMAGE_SIZE,
          sequential_image_generation: "disabled",
          output_format: "png",
          response_format: "url",
          stream: false,
          watermark: false,
        });
        const url = firstImageUrl(resp);
        if (!url) throw new Error("接口未返回图片 URL");
        setResultUrl(url);
      }
      setModifyCount((c) => c + 1);
      setModifyOpen(false);
      setModifyText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!resultUrl) return;
    setError(null);
    try {
      await downloadImage(
        resultUrl,
        activeFeature === "dish" ? `ai-dish-${Date.now()}.png` : `ai-poster-${Date.now()}.png`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败：可尝试右键图片另存为");
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <h1 className="title">AI 门店视觉</h1>
          <p className="subtitle">
            {activeFeature === "poster"
              ? "选模板（或智能风格）→ 上传素材 → 填写文案并生成海报"
              : "上传菜品原图即可；即使略模糊也会尽量输出影棚级超清成片，适合线上菜单与宣传"}
          </p>
        </div>
      </div>

      <div className="feature-tabs" role="tablist" aria-label="功能切换">
        <button
          type="button"
          role="tab"
          aria-selected={activeFeature === "poster"}
          className={`feature-tab ${activeFeature === "poster" ? "active" : ""}`}
          onClick={() => switchFeature("poster")}
        >
          AI 海报
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFeature === "dish"}
          className={`feature-tab ${activeFeature === "dish" ? "active" : ""}`}
          onClick={() => switchFeature("dish")}
        >
          AI 菜品图
        </button>
      </div>

      {activeFeature === "poster" ? (
        <nav className="steps" aria-label="流程步骤">
        <button
          type="button"
          className={`step ${wizardStep === 1 ? "active" : ""}`}
          aria-current={wizardStep === 1 ? "step" : undefined}
          onClick={() => setWizardStep(1)}
        >
          <strong>1 模板</strong>
          <span>可选模板或智能风格</span>
        </button>
        <button
          type="button"
          className={`step ${wizardStep === 2 ? "active" : ""}`}
          aria-current={wizardStep === 2 ? "step" : undefined}
          onClick={() => setWizardStep(2)}
        >
          <strong>2 素材</strong>
          <span>菜品 / 门店 / 招牌照片</span>
        </button>
        <button
          type="button"
          className={`step ${wizardStep === 3 ? "active" : ""}`}
          aria-current={wizardStep === 3 ? "step" : undefined}
          onClick={() => setWizardStep(3)}
        >
          <strong>3 文案与生成</strong>
          <span>填写内容后点击生成</span>
        </button>
      </nav>
      ) : null}

      {activeFeature === "poster" && indexError ? <div className="card error">{indexError}</div> : null}

      {activeFeature === "poster" && wizardStep === 1 ? (
        <section className="card">
          <h2>第一步：选择模板（或智能风格）</h2>
          <div className="checkbox">
            <input
              id="smart"
              type="checkbox"
              checked={smartStyle}
              onChange={(e) => onToggleSmartStyle(e.target.checked)}
            />
            <label htmlFor="smart">不使用模板：智能风格（由模型结合素材自动定调）</label>
          </div>

          {!smartStyle ? (
            <>
              {categories.length === 0 ? (
                <p className="hint">
                  当前没有可用模板：请在本机执行{" "}
                  <code>npm run prepare:templates</code>（默认从 <code>../../海报模板/餐饮</code>{" "}
                  复制），然后重新构建。
                </p>
              ) : (
                <>
                  <div className="tabs" role="tablist" aria-label="模板分类">
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="tab"
                        aria-selected={activeCat?.id === c.id}
                        onClick={() => setActiveCategory(c.id)}
                      >
                        {c.name}（{c.templates.length}）
                      </button>
                    ))}
                  </div>
                  <div className="grid" role="list">
                    {(activeCat?.templates ?? []).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="thumb"
                        aria-selected={selectedTemplate?.id === t.id}
                        onClick={() => openTemplatePreview(t)}
                        title={`预览：${t.file}`}
                      >
                        <img src={t.path} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                  <p className="hint">点击缩略图放大预览，可在预览中切换同分类下的其他模板，再点「使用模板」进入下一步。</p>
                </>
              )}
            </>
          ) : (
            <p className="hint">已开启智能风格：将跳过模板参考图，仅使用你上传的素材与文案进行创作。</p>
          )}

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" type="button" disabled={!canNextFrom1} onClick={() => setWizardStep(2)}>
              下一步
            </button>
          </div>
        </section>
      ) : null}

      {activeFeature === "poster" && wizardStep === 2 ? (
        <section className="card">
          <h2>第二步：上传要放进海报的图片</h2>
          <div className="drop">
            <div className="row">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void onAddFiles(e.target.files)}
              />
              <span className="hint">
                建议 1–{MAX_UPLOAD_FILES} 张；单张 &lt; {Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB
              </span>
            </div>
            {uploads.length ? (
              <div className="preview-strip">
                {uploads.map((u) => (
                  <div key={u.id} className="preview">
                    <img src={u.previewUrl} alt="" />
                    <button type="button" onClick={() => removeUpload(u.id)} aria-label="移除">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 10 }}>
                例如：招牌菜特写、门店外观、灯箱招牌、菜单亮点等。
              </p>
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" type="button" onClick={() => setWizardStep(1)}>
              上一步
            </button>
            <button className="btn primary" type="button" disabled={!canNextFrom2} onClick={() => setWizardStep(3)}>
              下一步
            </button>
          </div>
        </section>
      ) : null}

      {activeFeature === "poster" && wizardStep === 3 ? (
        <section className="card">
          <h2>第三步：填写海报文案并生成</h2>
          <textarea
            className="textarea"
            value={posterCopy}
            onChange={(e) => setPosterCopy(e.target.value)}
            placeholder="例如：店名、卖点一句话、活动信息、地址电话（可选）、营业时间等。"
          />
          <p className="hint">建议控制在较短篇幅内，模型对过长 prompt 可能会忽略细节。</p>
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="image-model-poster">
              生成模型
            </label>
            <select
              id="image-model-poster"
              className="model-picker-select"
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value as ImageModelId)}
            >
              <option value="seedream">模型1</option>
              <option value="nano">模型2</option>
            </select>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" type="button" onClick={() => setWizardStep(2)}>
              上一步
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={!canNextFrom3 || loading}
              onClick={() => void handleGenerateInitial()}
            >
              {loading ? "生成中…" : "生成海报"}
            </button>
          </div>
        </section>
      ) : null}

      {activeFeature === "dish" ? (
        <section className="card dish-feature">
          <h2>AI 菜品图（菜单 / 外卖展示）</h2>
          <p className="hint">
            上传<strong>一张</strong>菜品照片即可（手机随手拍、略模糊也可）。系统会<strong>完整替换背景与台面</strong>、重做光影与色彩，并在保留「仍是同一道菜」的前提下，尽量把菜品细节补全到<strong>商业摄影棚级的高清清晰</strong>，成片适合线上菜单、外卖主图与宣传物料。
          </p>
          <div className="drop dish-drop">
            <div className="row">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  onDishFile(e.target.files);
                  e.target.value = "";
                }}
              />
              <span className="hint">单张，&lt; {Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB</span>
            </div>
            {dishUpload ? (
              <div className="dish-preview-wrap">
                <img src={dishUpload.previewUrl} alt="菜品原图预览" className="dish-preview-img" />
                <button type="button" className="btn ghost" onClick={() => clearDishUpload()}>
                  重新选择图片
                </button>
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 10 }}>
                建议尽量对焦主体；即便原图偏糊，生成时也会朝超清影棚效果优化（仍以你这道菜为准）。
              </p>
            )}
          </div>
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="image-model-dish">
              生成模型
            </label>
            <select
              id="image-model-dish"
              className="model-picker-select"
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value as ImageModelId)}
            >
              <option value="seedream">模型1</option>
              <option value="nano">模型2</option>
            </select>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn primary"
              type="button"
              disabled={!dishUpload || loading}
              onClick={() => void handleDishGenerate()}
            >
              {loading ? "生成中…" : "生成菜品图"}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="card error" role="alert">
          {error}
        </div>
      ) : null}

      {resultUrl ? (
        <section className="card result">
          <h2>生成结果</h2>
          <img src={resultUrl} alt={activeFeature === "dish" ? "AI 菜品图" : "AI 生成海报"} />
          <div className="row">
            <button className="btn secondary" type="button" disabled={loading || remainingMods <= 0} onClick={() => setModifyOpen(true)}>
              修改（剩余 {remainingMods} 次）
            </button>
            <button className="btn primary" type="button" disabled={loading} onClick={() => void handleDownload()}>
              下载图片
            </button>
          </div>
          {remainingMods <= 0 ? (
            <p className="hint">已达到最多 {MAX_MODIFICATIONS} 次修改上限；仍可下载当前图片。</p>
          ) : activeFeature === "dish" ? (
            <p className="hint">修改会以「当前菜品图 + 你的文字说明」再次调用生图；尽量描述光影、背景或色彩上的调整。</p>
          ) : (
            <p className="hint">修改会以“当前海报图 + 你的文字编辑指令”再次调用生图接口。</p>
          )}
        </section>
      ) : null}

      {activeFeature === "poster" &&
      templatePreviewIndex !== null &&
      activeCat &&
      activeCat.templates.length > 0 ? (
        <div
          className="template-preview-backdrop"
          role="presentation"
          onMouseDown={() => closeTemplatePreview()}
        >
          <div
            className="template-preview-shell"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-preview-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="template-preview-header">
              <h3 id="template-preview-title">模板预览</h3>
              <button
                type="button"
                className="template-preview-close"
                aria-label="关闭预览"
                onClick={() => closeTemplatePreview()}
              >
                ×
              </button>
            </div>
            <p className="template-preview-counter" aria-live="polite">
              {activeCat.name} · {templatePreviewIndex + 1} / {activeCat.templates.length}
            </p>
            <div className="template-preview-stage">
              <button
                type="button"
                className="template-preview-nav"
                aria-label="上一张"
                disabled={templatePreviewIndex <= 0}
                onClick={() =>
                  setTemplatePreviewIndex((i) => (i === null ? i : Math.max(0, i - 1)))
                }
              >
                ‹
              </button>
              <div className="template-preview-image-wrap">
                <img
                  src={activeCat.templates[templatePreviewIndex]?.path}
                  alt=""
                  decoding="async"
                />
              </div>
              <button
                type="button"
                className="template-preview-nav"
                aria-label="下一张"
                disabled={templatePreviewIndex >= activeCat.templates.length - 1}
                onClick={() =>
                  setTemplatePreviewIndex((i) =>
                    i === null ? i : Math.min(activeCat.templates.length - 1, i + 1),
                  )
                }
              >
                ›
              </button>
            </div>
            <footer className="template-preview-footer">
              <p className="template-preview-filename">
                {activeCat.templates[templatePreviewIndex]?.file}
              </p>
              <div className="template-preview-footer-actions">
                <button
                  className="btn ghost template-preview-footer-cancel"
                  type="button"
                  onClick={() => closeTemplatePreview()}
                >
                  取消
                </button>
                <button className="btn primary" type="button" onClick={() => confirmUseTemplateAndNext()}>
                  使用模板
                </button>
              </div>
              <p className="template-preview-keys">提示：可用键盘 ← → 切换。</p>
            </footer>
          </div>
        </div>
      ) : null}

      {modifyOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setModifyOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h3>描述你要修改的内容</h3>
            <p className="hint">
              {activeFeature === "dish"
                ? "说明希望如何微调光影、背景、色彩或质感（尽量具体）；系统将尽量保持菜品造型不变。"
                : "用自然语言说明「把什么改成什么」或希望调整的区域与风格。"}
            </p>
            <textarea className="textarea" value={modifyText} onChange={(e) => setModifyText(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn ghost" type="button" disabled={loading} onClick={() => setModifyOpen(false)}>
                取消
              </button>
              <button className="btn primary" type="button" disabled={loading} onClick={() => void handleModifyConfirm()}>
                {loading ? "处理中…" : "确定"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
