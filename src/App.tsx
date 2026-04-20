import { useEffect, useMemo, useRef, useState } from "react";
import { callArkGenerate, callToapisGenerate, firstImageUrl } from "./api/ark";
import { createVideoTask, getVideoTask } from "./api/video";
import { downloadImage, downloadVideo, fetchUrlAsDataUrl, fileToDataUrl } from "./lib/images";
import {
  DEFAULT_ASPECT_RATIO,
  IMAGE_ASPECT_OPTIONS,
  seedreamSizeForAspect,
  type SharedAspectRatio,
} from "./lib/image-aspect";
import { buildDishPhotoPrompt, buildInitialPrompt, buildModifyPrompt } from "./lib/prompts";
import {
  buildVideoPrompt,
  VIDEO_DIRECTIONS,
  type ShortVideoPlatform,
  type VideoDirectionId,
} from "./lib/video-presets";
import type { TemplateCategory, TemplateIndex, TemplateItem } from "./types/templates";

const MODEL = "doubao-seedream-5-0-260128";
/** 默认视频生成模型（仅请求体使用，不在界面展示） */
const SEEDANCE_VIDEO_MODEL = "doubao-seedance-2-0-260128";
const MAX_MODIFICATIONS = 5;
const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const MAX_UPLOAD_FILES = 8;
const MAX_VIDEO_REF_FILES = 6;
const VIDEO_POLL_MS = 4000;
const VIDEO_MAX_POLLS = 150;

type WizardStep = 1 | 2 | 3;
type FeatureTab = "poster" | "dish" | "video";
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

  const [videoUploads, setVideoUploads] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const [videoDirection, setVideoDirection] = useState<VideoDirectionId>(VIDEO_DIRECTIONS[0].id);
  const [videoPlatform, setVideoPlatform] = useState<ShortVideoPlatform>("douyin");
  const [videoExtra, setVideoExtra] = useState("");
  const [videoRatio, setVideoRatio] = useState("9:16");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoDuration, setVideoDuration] = useState(6);
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(true);
  const [videoResultUrl, setVideoResultUrl] = useState<string | null>(null);
  const [videoTaskHint, setVideoTaskHint] = useState("");

  const [imageModel, setImageModel] = useState<ImageModelId>("seedream");
  /** 两模型共用的画幅比例；模型1 传对应 WxH，模型2 传比例 + 2K */
  const [imageAspect, setImageAspect] = useState<SharedAspectRatio>(DEFAULT_ASPECT_RATIO);
  /** 当前结果图是用哪条链路生成的，修改时必须一致 */
  const [lastGenerateModel, setLastGenerateModel] = useState<ImageModelId | null>(null);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const dishUploadRef = useRef(dishUpload);
  dishUploadRef.current = dishUpload;
  const videoUploadsRef = useRef(videoUploads);
  videoUploadsRef.current = videoUploads;

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

  useEffect(() => {
    return () => {
      for (const u of videoUploadsRef.current) URL.revokeObjectURL(u.previewUrl);
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
    setVideoResultUrl(null);
    setVideoTaskHint("");
    setModifyCount(0);
    setLastGenerateModel(null);
    setModifyOpen(false);
    setModifyText("");
    if (next !== "video") {
      setVideoUploads((prev) => {
        for (const u of prev) URL.revokeObjectURL(u.previewUrl);
        return [];
      });
    }
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

  async function onVideoAddFiles(fileList: FileList | null) {
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
      if (videoUploads.length + next.length >= MAX_VIDEO_REF_FILES) {
        setError(`最多上传 ${MAX_VIDEO_REF_FILES} 张参考图。`);
        break;
      }
      next.push({ id: uid(), file, previewUrl: URL.createObjectURL(file) });
    }
    if (next.length) setVideoUploads((prev) => [...prev, ...next]);
  }

  function removeVideoUpload(id: string) {
    setVideoUploads((prev) => {
      const u = prev.find((x) => x.id === id);
      if (u) URL.revokeObjectURL(u.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  async function handleVideoGenerate() {
    if (videoUploads.length === 0) return;
    setLoading(true);
    setError(null);
    setVideoResultUrl(null);
    setVideoTaskHint("正在创建视频任务…");
    try {
      const images = await Promise.all(videoUploads.map((u) => fileToDataUrl(u.file)));
      const prompt = buildVideoPrompt({
        directionId: videoDirection,
        platform: videoPlatform,
        extra: videoExtra,
      });
      const created = await createVideoTask({
        prompt,
        images,
        model: SEEDANCE_VIDEO_MODEL,
        ratio: videoRatio,
        resolution: videoResolution,
        duration: videoDuration,
        generate_audio: videoGenerateAudio,
        watermark: false,
      });
      const taskId = created.id;
      if (!taskId) throw new Error("接口未返回任务 ID");

      for (let i = 0; i < VIDEO_MAX_POLLS; i++) {
        setVideoTaskHint(
          i === 0 ? "任务排队 / 生成中，请稍候…" : `生成中（约 ${Math.round((i * VIDEO_POLL_MS) / 1000)} 秒）…`,
        );
        const task = await getVideoTask(taskId);
        const st = (task.status || "").toLowerCase();
        if (st === "succeeded") {
          const url = task.content?.video_url;
          if (!url) throw new Error("任务成功但未返回视频地址");
          setVideoResultUrl(url);
          setVideoTaskHint("");
          return;
        }
        if (st === "failed" || st === "cancelled" || st === "expired") {
          const msg =
            task.error && typeof task.error === "object" && typeof task.error.message === "string"
              ? task.error.message
              : String(st);
          throw new Error(msg || "视频任务失败");
        }
        await new Promise((r) => setTimeout(r, VIDEO_POLL_MS));
      }
      throw new Error("等待超时：请稍后在控制台查看该任务是否仍在运行");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
      setVideoTaskHint("");
    }
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
          aspect: imageAspect,
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
          size: seedreamSizeForAspect(imageAspect),
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
          aspect: imageAspect,
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
          size: seedreamSizeForAspect(imageAspect),
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
          aspect: imageAspect,
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
          size: seedreamSizeForAspect(imageAspect),
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
    setError(null);
    try {
      if (activeFeature === "video") {
        if (!videoResultUrl) return;
        await downloadVideo(videoResultUrl, `ai-short-video-${Date.now()}.mp4`);
        return;
      }
      if (!resultUrl) return;
      await downloadImage(
        resultUrl,
        activeFeature === "dish" ? `ai-dish-${Date.now()}.png` : `ai-poster-${Date.now()}.png`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败：可尝试右键另存为");
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div>
          <h1 className="title">AI 门店视觉</h1>
          <p className="subtitle">
            {activeFeature === "poster"
              ? "选模板（或智能风格）→ 上传素材 → 填写文案；成稿中的商品/门店应与素材一致"
              : activeFeature === "dish"
                ? "盘中食物保持与原图一致（仅更清晰），背景与台面可重做，适合菜单与宣传"
                : "上传参考图，选择内容方向与平台调性，生成适合抖音或小红书发布的竖屏短视频"}
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
        <button
          type="button"
          role="tab"
          aria-selected={activeFeature === "video"}
          className={`feature-tab ${activeFeature === "video" ? "active" : ""}`}
          onClick={() => switchFeature("video")}
        >
          AI 短视频
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
                例如：招牌菜特写、门店外观、灯箱招牌、菜单亮点等。生成时会尽量保持画面里的菜品、饮品、门面与您上传的图为「同一商品/同一家店」，而不会换成别的商品示意图。
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
          <p className="hint">建议控制在较短篇幅内，模型对过长 prompt 可能会忽略细节。系统已强调素材保真：若成稿与实物仍有偏差，可尝试换更清晰的素材或减少一张图里的主体数量。</p>
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
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="image-aspect-poster">
              画幅比例
            </label>
            <select
              id="image-aspect-poster"
              className="model-picker-select"
              value={imageAspect}
              onChange={(e) => setImageAspect(e.target.value as SharedAspectRatio)}
            >
              {IMAGE_ASPECT_OPTIONS.map((o) => (
                <option key={o.ratio} value={o.ratio}>
                  {o.label}（模型1 {o.seedreamSize}）
                </option>
              ))}
            </select>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            选项为两模型均支持的比例交集；模型1 按上列像素出图，模型2 为同比例 + 2K。
          </p>
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
            上传<strong>一张</strong>菜品照片即可（手机随手拍、略模糊也可）。<strong>盘中食物须与原图是同一盘菜</strong>（形状与细节保持一致，只做去糊与高清化），<strong>不会把菜换成另一种东西</strong>。系统会<strong>重做背景、台面与盘外搭配</strong>、并重做光影；成片适合线上菜单、外卖主图与宣传。
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
                建议尽量对焦主体；偏糊时会对食物区域做清晰化，但不会改食材与摆盘细节。
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
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="image-aspect-dish">
              画幅比例
            </label>
            <select
              id="image-aspect-dish"
              className="model-picker-select"
              value={imageAspect}
              onChange={(e) => setImageAspect(e.target.value as SharedAspectRatio)}
            >
              {IMAGE_ASPECT_OPTIONS.map((o) => (
                <option key={o.ratio} value={o.ratio}>
                  {o.label}（模型1 {o.seedreamSize}）
                </option>
              ))}
            </select>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            选项为两模型均支持的比例交集；模型1 按上列像素出图，模型2 为同比例 + 2K。
          </p>
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

      {activeFeature === "video" ? (
        <section className="card video-feature">
          <h2>AI 短视频（抖音 / 小红书）</h2>
          <div className="drop">
            <div className="row">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void onVideoAddFiles(e.target.files)}
              />
              <span className="hint">
                1–{MAX_VIDEO_REF_FILES} 张；单张 &lt; {Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB
              </span>
            </div>
            {videoUploads.length > 0 ? (
              <div className="preview-strip">
                {videoUploads.map((u) => (
                  <div key={u.id} className="preview">
                    <img src={u.previewUrl} alt="" />
                    <button type="button" onClick={() => removeVideoUpload(u.id)} aria-label="移除">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 10 }}>
                建议首张为最想突出的主体（菜品特写或门头/店内一角），其余可作为补充镜头参考。
              </p>
            )}
          </div>

          <fieldset className="video-directions">
            <legend className="video-directions-legend">内容方向</legend>
            <div className="video-direction-grid">
              {VIDEO_DIRECTIONS.map((d) => (
                <label key={d.id} className={`video-direction-card ${videoDirection === d.id ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="video-direction"
                    value={d.id}
                    checked={videoDirection === d.id}
                    onChange={() => setVideoDirection(d.id)}
                  />
                  <span className="video-direction-title">{d.label}</span>
                  <span className="video-direction-hint">{d.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="model-picker">
            <label className="model-picker-label" htmlFor="video-platform">
              平台调性
            </label>
            <select
              id="video-platform"
              className="model-picker-select"
              value={videoPlatform}
              onChange={(e) => setVideoPlatform(e.target.value as ShortVideoPlatform)}
            >
              <option value="douyin">抖音（快节奏、强钩子）</option>
              <option value="xiaohongshu">小红书（种草、清新）</option>
            </select>
          </div>

          <textarea
            className="textarea"
            style={{ marginTop: 12 }}
            value={videoExtra}
            onChange={(e) => setVideoExtra(e.target.value)}
            placeholder="可选：补充店名、卖点一句话、价格或禁忌（如不要口播具体数字）"
            rows={3}
          />

          <div className="model-picker">
            <label className="model-picker-label" htmlFor="video-ratio">
              画幅比例
            </label>
            <select
              id="video-ratio"
              className="model-picker-select"
              value={videoRatio}
              onChange={(e) => setVideoRatio(e.target.value)}
            >
              <option value="9:16">9:16 竖屏（推荐）</option>
              <option value="3:4">3:4</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="21:9">21:9 超宽</option>
              <option value="adaptive">adaptive 自动</option>
            </select>
          </div>
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="video-resolution">
              分辨率
            </label>
            <select
              id="video-resolution"
              className="model-picker-select"
              value={videoResolution}
              onChange={(e) => setVideoResolution(e.target.value)}
            >
              <option value="720p">720p</option>
              <option value="480p">480p</option>
              <option value="1080p">1080p（部分场景可能不适用）</option>
            </select>
          </div>
          <div className="model-picker">
            <label className="model-picker-label" htmlFor="video-duration">
              时长（秒）
            </label>
            <select
              id="video-duration"
              className="model-picker-select"
              value={String(videoDuration)}
              onChange={(e) => {
                const v = e.target.value;
                setVideoDuration(v === "-1" ? -1 : Number(v));
              }}
            >
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="8">8</option>
              <option value="10">10</option>
              <option value="12">12</option>
              <option value="15">15</option>
              <option value="-1">智能时长（由系统在允许范围内自选）</option>
            </select>
          </div>
          <div className="checkbox" style={{ marginTop: 10 }}>
            <input
              id="video-audio"
              type="checkbox"
              checked={videoGenerateAudio}
              onChange={(e) => setVideoGenerateAudio(e.target.checked)}
            />
            <label htmlFor="video-audio">生成与画面同步的声音（人声/音效/配乐）</label>
          </div>

          {videoTaskHint ? <p className="hint video-task-hint">{videoTaskHint}</p> : null}

          <div className="row" style={{ marginTop: 14 }}>
            <button
              className="btn primary"
              type="button"
              disabled={videoUploads.length === 0 || loading}
              onClick={() => void handleVideoGenerate()}
            >
              {loading ? "生成中…" : "生成短视频"}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="card error" role="alert">
          {error}
        </div>
      ) : null}

      {activeFeature !== "video" && resultUrl ? (
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
            <p className="hint">修改会以「当前菜品图 + 你的文字说明」再次调用生图；可描述背景、台面、光影；盘中食物仅会更清晰，不应被要求改成别的菜。</p>
          ) : (
            <p className="hint">修改会以「当前海报图 + 你的文字编辑指令」再次调用生图；请尽量描述版式、字色、装饰或氛围，避免要求「换成另一道菜/另一家店」（系统会保持与用户素材一致的商品与门店）。</p>
          )}
        </section>
      ) : null}

      {activeFeature === "video" && videoResultUrl ? (
        <section className="card result">
          <h2>生成结果</h2>
          <video className="result-video" controls playsInline src={videoResultUrl} />
          <div className="row">
            <button className="btn primary" type="button" disabled={loading} onClick={() => void handleDownload()}>
              下载视频（MP4）
            </button>
          </div>
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
                ? "可说明背景、台面、盘外道具或整体光影（尽量具体）。盘中食物将保持同一道菜，仅做清晰化，勿要求换成别的食材或另一道菜。"
                : "用自然语言说明版式、配色、文字或装饰上的调整；请勿要求把画面中的商品或门店改成与上传素材不符的另一件东西。"}
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
