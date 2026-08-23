"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

type FeedbackItem = { id: string; user_email: string; body: string; image_paths: string[]; status: "unread" | "read"; created_at: string; read_at: string | null };

export default function FeedbackAdminPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/feedback", { cache: "no-store" });
        const data = await response.json() as { ok?: boolean; feedback?: FeedbackItem[]; message?: string };
        if (response.status === 401) return window.location.replace("/login");
        if (response.status === 403) return window.location.replace("/");
        if (!response.ok || !data.ok) throw new Error(data.message ?? "读取反馈失败");
        setItems(data.feedback ?? []);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "读取反馈失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function markRead(id: string) {
    const response = await fetch(`/api/feedback/${id}`, { method: "PATCH" });
    if (!response.ok) return setMessage("标记失败，请稍后重试");
    setItems((current) => current.map((item) => item.id === id ? { ...item, status: "read", read_at: new Date().toISOString() } : item));
  }

  async function remove(id: string) {
    if (!window.confirm("确定删除这条反馈及其图片吗？删除后无法恢复。")) return;
    const response = await fetch(`/api/feedback/${id}`, { method: "DELETE" });
    if (!response.ok) return setMessage("删除失败，请稍后重试");
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <main className="standalone-page feedback-admin-page">
      <Link className="standalone-back" href="/">← 返回首页</Link>
      <header><span className="eyebrow">Admin</span><h1>反馈管理</h1><p>{items.filter((item) => item.status === "unread").length} 条未读 · 共 {items.length} 条</p></header>
      {message && <div className="message">{message}</div>}
      {loading ? <div className="standalone-card empty-list">正在读取反馈…</div> : items.length === 0 ? <div className="standalone-card empty-list">暂无反馈</div> : <section className="feedback-admin-list">{items.map((item) => (
        <article className={`feedback-admin-card ${item.status}`} key={item.id}>
          <div className="feedback-meta"><strong>{item.user_email}</strong><span>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(item.created_at))}</span><i>{item.status === "unread" ? "未读" : "已读"}</i></div>
          <p>{item.body}</p>
          {item.image_paths.length > 0 && <div className="feedback-admin-images">{item.image_paths.map((path, index) => <a href={`/api/feedback/image?path=${encodeURIComponent(path)}`} target="_blank" rel="noreferrer" key={path}><Image unoptimized fill sizes="160px" src={`/api/feedback/image?path=${encodeURIComponent(path)}`} alt={`反馈图片 ${index + 1}`} /></a>)}</div>}
          <div className="feedback-admin-actions">{item.status === "unread" && <button className="button secondary" onClick={() => void markRead(item.id)}>标为已读</button>}<button className="button danger" onClick={() => void remove(item.id)}>删除</button></div>
        </article>
      ))}</section>}
    </main>
  );
}
