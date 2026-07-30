"use client";

import { useState } from "react";

export default function LoginPage() {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message ?? "登录失败，请稍后重试");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <span className="brand-mark large login-logo">JSOS</span>
        <span className="eyebrow">Japanese Speaking OS</span>
        <h1>每天开口，<br />直到日语成为本能。</h1>
        <p>你的计划、对话、复习与进步，都在这里。</p>
      </section>
      <section className="login-card">
        <span className="eyebrow">Private beta</span>
        <h2>登录 JSOS</h2>
        <form onSubmit={handleSubmit}>
          <label>邮箱<input name="email" type="email" placeholder="name@example.com" autoComplete="email" required /></label>
          <label>密码<input name="password" type="password" placeholder="至少 8 位" autoComplete="current-password" required minLength={8} /></label>
          <button className="button primary" type="submit" disabled={submitting}>{submitting ? "正在登录…" : "登录"}</button>
        </form>
        {message && <div className="message">{message}</div>}
        <small>暂未开放注册 · 敬请期待</small>
      </section>
    </main>
  );
}
