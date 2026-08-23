"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_IMAGE_MAX_COUNT,
  FEEDBACK_ORIGINAL_IMAGE_MAX_BYTES,
  FEEDBACK_STORED_IMAGE_MAX_BYTES,
} from "../../lib/feedback-domain";

type PreparedImage = { file: File; preview: string; originalSize: number };

export default function FeedbackPage() {
  const [ready, setReady] = useState(false);
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" }).then((response) => {
      if (!response.ok) return window.location.replace("/login");
      setReady(true);
    }).catch(() => window.location.replace("/login"));
  }, []);

  async function selectImages(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.target.files ?? [])];
    event.target.value = "";
    setMessage("");
    if (images.length + selected.length > FEEDBACK_IMAGE_MAX_COUNT) {
      setMessage("最多上传 5 张图片");
      return;
    }
    if (selected.some((file) => file.size > FEEDBACK_ORIGINAL_IMAGE_MAX_BYTES)) {
      setMessage("每张原图不能超过 10 MB");
      return;
    }
    setPreparing(true);
    try {
      const prepared = await Promise.all(selected.map(prepareImage));
      setImages((current) => [...current, ...prepared]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片处理失败，请换一张图片");
    } finally {
      setPreparing(false);
    }
  }

  function removeImage(index: number) {
    setImages((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function submitFeedback(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return setMessage("请填写反馈内容");
    setSubmitting(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("body", body.trim());
      form.set("originalSizes", JSON.stringify(images.map((item) => item.originalSize)));
      images.forEach((item) => form.append("images", item.file));
      const response = await fetch("/api/feedback", { method: "POST", body: form });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message ?? "反馈提交失败");
      images.forEach((item) => URL.revokeObjectURL(item.preview));
      setImages([]);
      setBody("");
      setMessage(data.message ?? "反馈已提交，谢谢你");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "反馈提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) return <main className="auth-loading"><span className="brand-mark large">J</span><strong>正在确认登录…</strong></main>;
  return (
    <main className="standalone-page feedback-page">
      <Link className="standalone-back" href="/">← 返回首页</Link>
      <header><span className="eyebrow">Feedback</span><h1>提交反馈</h1><p>遇到问题或有改进建议，都可以在这里告诉我。反馈会保留你的登录邮箱，方便确认问题。</p></header>
      <form className="standalone-card feedback-form" onSubmit={submitFeedback}>
        <label><span>反馈内容</span><textarea autoFocus maxLength={FEEDBACK_BODY_MAX} value={body} onChange={(event) => { setBody(event.target.value); setMessage(""); }} placeholder="请尽量说明你所在的页面、操作步骤和实际结果…" /></label>
        <small className="character-count">{body.length}/{FEEDBACK_BODY_MAX}</small>
        <div className="feedback-upload-heading"><div><strong>图片</strong><small>最多 5 张，单张原图不超过 10 MB</small></div><button type="button" className="button secondary" disabled={preparing || images.length >= FEEDBACK_IMAGE_MAX_COUNT} onClick={() => inputRef.current?.click()}>{preparing ? "正在处理…" : "添加图片"}</button></div>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectImages} />
        {images.length > 0 && <div className="feedback-previews">{images.map((item, index) => <figure key={item.preview}><Image unoptimized fill sizes="160px" src={item.preview} alt={`待上传图片 ${index + 1}`} /><button type="button" onClick={() => removeImage(index)} aria-label={`删除图片 ${index + 1}`}>×</button></figure>)}</div>}
        {message && <div className={message.includes("谢谢") ? "message success" : "message"}>{message}</div>}
        <div className="modal-actions"><button className="button primary" disabled={submitting || preparing || !body.trim()}>{submitting ? "正在提交…" : "提交反馈"}</button></div>
      </form>
    </main>
  );
}

async function prepareImage(original: File): Promise<PreparedImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(original.type)) throw new Error("仅支持 JPG、PNG、WebP 图片");
  const bitmap = await createImageBitmap(original);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片处理失败，请换一张图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.86;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > FEEDBACK_STORED_IMAGE_MAX_BYTES && quality > 0.46) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }
  if (blob.size > FEEDBACK_STORED_IMAGE_MAX_BYTES) throw new Error("图片压缩后仍超过 2 MB，请换一张图片");
  const filename = `${original.name.replace(/\.[^.]+$/, "") || "feedback"}.jpg`;
  const file = new File([blob], filename, { type: "image/jpeg" });
  return { file, preview: URL.createObjectURL(file), originalSize: original.size };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败")), "image/jpeg", quality));
}
