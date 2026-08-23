"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function GuidePage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.ok ? setReady(true) : window.location.replace("/login")).catch(() => window.location.replace("/login"));
  }, []);
  if (!ready) return <main className="auth-loading"><span className="brand-mark large">J</span><strong>正在确认登录…</strong></main>;
  const sections = [
    ["01", "登录与密码", "使用管理员提供的邮箱和初始密码登录。首次登录会提示修改密码，你也可以选择暂不修改；之后可从头像菜单随时修改。忘记密码时，请联系管理员获取新的临时密码。"],
    ["02", "生成并开启计划", "填写学习目的和天数后生成全部主题。确认主题后选择 Day 1 日期并开启计划；日期默认是当天，也可以改为未来日期。开启后，系统会在后台继续生成每日完整训练内容。"],
    ["03", "完成每日训练", "进入当天任务，先完成对话前预热，再查看训练场景和目标表达。复制训练提示，前往 GPT‑Live 的对应项目开始训练。"],
    ["04", "导入训练总结", "训练结束后，把 GPT‑Live 生成的 JSON 总结粘贴到当天任务中。系统会检查任务编号和数据结构；只有当前训练日可以保存或更新总结。"],
    ["05", "复习、顺延与补强", "「昨日复习」只读取前一个训练日的词句。未按时完成的任务会在每日 25 点自动顺延；总结建议补强时，系统会按既有规则插入补强任务。"],
    ["06", "提交反馈", "首页进入「提交反馈」，可填写最多 500 字并上传最多 5 张图片。请尽量写清页面、操作步骤和实际结果，便于定位问题。"],
  ];
  return (
    <main className="standalone-page guide-page">
      <Link className="standalone-back" href="/">← 返回首页</Link>
      <header><span className="eyebrow">JSOS Guide</span><h1>使用指南</h1><p>从登录到完成每日训练，按下面的顺序操作即可。</p></header>
      <section className="guide-list">{sections.map(([number, title, body]) => <article className="standalone-card" key={number}><span>{number}</span><div><h2>{title}</h2><p>{body}</p></div></article>)}</section>
    </main>
  );
}
