"use client";

import { useEffect, useMemo, useState } from "react";
import { parseSummaryText, validateSummary } from "../lib/jsos-domain";

type View = "calendar" | "task" | "vocabulary" | "sentences" | "anki" | "review";
type TaskStatus = "done" | "today" | "planned" | "deferred";

type CalendarTask = {
  taskId?: string;
  date: string;
  day?: number;
  topic?: string;
  status: TaskStatus;
  kind?: "core" | "reinforcement";
  content?: { scenes?: Array<{ key?: string; title?: string; goals?: string[]; roles?: string[] }>; targetPatterns?: string[]; basePrompt?: string | null };
};

type VocabularyItem = { id: string; word: string; reading: string; meaning: string; state: "生词" | "熟词"; source: string; sessionIds: string[] };
type SentenceItem = { sessionId: string; original: string; corrected: string; note: string; state: "待掌握" | "已掌握" };
type PlanRun = { id: string; kind: "trial" | "official"; status: "active" | "archived"; starts_on: string; activated_at: string; archived_at: string | null };
type CheckKey = "anki" | "shadowing" | "monologue" | "writing";
type DailyChecks = Record<CheckKey, boolean>;
type TrainingSession = { id: string; task_id: string; duration_minutes: number | null; communication_score: number | null; fluency_score: number | null; pronunciation_score: number | null; summary_zh: string | null; needs_reinforcement: boolean; recommendation: { reasonZh?: string; suggestedFocus?: string[] } | null; imported_at: string };

type DashboardResponse = {
  ok?: boolean;
  message?: string;
  activePlan?: PlanRun | null;
  tasks?: Array<{ id: string; day_number: number; topic: string; task_type: string; status: string; scheduled_for: string; content?: CalendarTask["content"] }>;
  calendar?: Array<{ calendar_date: string; state: string; task_id: string | null }>;
  vocabulary?: Array<{ id: string; word: string; reading: string | null; meaning_zh: string; status: string }>;
  vocabularySources?: Array<{ vocabulary_id: string; session_id: string }>;
  sentences?: Array<{ session_id: string; original: string; corrected: string; explanation_zh: string | null; status: string }>;
  sessions?: TrainingSession[];
  checkins?: Array<{ check_date: string } & DailyChecks>;
  stats?: { completed: number; expressions: number };
};

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "redirecting">("checking");
  const [view, setView] = useState<View>("calendar");
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [activePlan, setActivePlan] = useState<PlanRun | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardMessage, setDashboardMessage] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskComplete, setTaskComplete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryMessage, setSummaryMessage] = useState("");
  const [summaryImporting, setSummaryImporting] = useState(false);
  const [checkins, setCheckins] = useState<Record<string, DailyChecks>>({});
  const [toast, setToast] = useState("");
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [sentences, setSentences] = useState<SentenceItem[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [expressionCount, setExpressionCount] = useState(0);
  const [ankiCompleted, setAnkiCompleted] = useState<string[]>([]);
  const [reviewCompleted, setReviewCompleted] = useState<number[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plans, setPlans] = useState<PlanRun[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [planKind, setPlanKind] = useState<"trial" | "official">("trial");
  const [planStartDate, setPlanStartDate] = useState("");
  const [planMessage, setPlanMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function boot() {
      try {
        const [sessionResponse, dashboardResult] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store", signal: controller.signal }),
          loadDashboard(false),
        ]);
        if (!sessionResponse.ok) throw new Error("unauthorized");
        if (dashboardResult === "unauthorized") await loadDashboard(false);
        if (!controller.signal.aborted) setAuthState("authenticated");
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setAuthState("redirecting");
        window.location.replace("/login");
      }
    }
    void boot();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const validViews: View[] = ["calendar", "task", "vocabulary", "sentences", "anki", "review"];
    window.history.replaceState({ ...window.history.state, jsosView: "calendar" }, "");

    function handlePopState(event: PopStateEvent) {
      const previousView = event.state?.jsosView;
      if (validViews.includes(previousView)) setView(previousView);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const current = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    return tasks.find((task) => task.taskId === selectedTaskId) ?? tasks.find((task) => task.date === today) ?? tasks.find((task) => task.status === "planned") ?? null;
  }, [selectedTaskId, tasks]);
  const nextTask = useMemo(() => current ? tasks.find((task) => (task.day ?? 0) > (current.day ?? 0)) ?? null : null, [current, tasks]);
  const currentSession = useMemo(() => sessions.find((session) => session.task_id === current?.taskId) ?? null, [current?.taskId, sessions]);
  const currentChecks = current ? checkins[current.date] ?? { anki: false, shadowing: false, monologue: false, writing: false } : { anki: false, shadowing: false, monologue: false, writing: false };
  const currentWords = currentSession ? vocabulary.filter((item) => item.sessionIds.includes(currentSession.id)) : [];
  const currentSentences = currentSession ? sentences.filter((item) => item.sessionId === currentSession.id) : [];
  const completed = tasks.filter((task) => task.status === "done").length;
  const progress = Math.round((completed / 40) * 100);
  const vocabularyNewCount = vocabulary.filter((item) => item.state === "生词").length;
  const vocabularyKnownCount = vocabulary.filter((item) => item.state === "熟词").length;
  const sentenceLearningCount = sentences.filter((item) => item.state === "待掌握").length;
  const sentenceMasteredCount = sentences.filter((item) => item.state === "已掌握").length;

  async function loadDashboard(redirectOnUnauthorized = true): Promise<"ok" | "unauthorized" | "error"> {
    setDashboardLoading(true);
    setDashboardMessage("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const data = await response.json() as DashboardResponse;
      if (response.status === 401) {
        if (redirectOnUnauthorized) window.location.replace("/login");
        return "unauthorized";
      }
      if (!response.ok || !data.ok) throw new Error(data.message ?? "读取首页数据失败");
      const apiTasks = data.tasks ?? [];
      const taskById = new Map(apiTasks.map((task) => [task.id, task]));
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      const normalized = (data.calendar ?? []).map((entry) => {
        const task = entry.task_id ? taskById.get(entry.task_id) : undefined;
        const status: TaskStatus = entry.state === "completed" || task?.status === "completed" ? "done" : entry.state === "deferred" || task?.status === "deferred" ? "deferred" : entry.calendar_date === today ? "today" : "planned";
        return { taskId: task?.id, date: entry.calendar_date, day: task?.day_number, topic: task?.topic, status, kind: task?.task_type === "reinforcement" ? "reinforcement" as const : "core" as const, content: task?.content };
      });
      setActivePlan(data.activePlan ?? null);
      setTasks(normalized);
      const sessionIdsByVocabulary = new Map<string, string[]>();
      for (const source of data.vocabularySources ?? []) sessionIdsByVocabulary.set(source.vocabulary_id, [...(sessionIdsByVocabulary.get(source.vocabulary_id) ?? []), source.session_id]);
      setVocabulary((data.vocabulary ?? []).map((item) => ({ id: item.id, word: item.word, reading: item.reading ?? "", meaning: item.meaning_zh, state: item.status === "known" ? "熟词" : "生词", source: "训练记录", sessionIds: sessionIdsByVocabulary.get(item.id) ?? [] })));
      setSentences((data.sentences ?? []).map((item) => ({ sessionId: item.session_id, original: item.original, corrected: item.corrected, note: item.explanation_zh ?? "", state: item.status === "mastered" ? "已掌握" : "待掌握" })));
      setSessions(data.sessions ?? []);
      setCheckins(Object.fromEntries((data.checkins ?? []).map((item) => [item.check_date, { anki: item.anki, shadowing: item.shadowing, monologue: item.monologue, writing: item.writing }])));
      setExpressionCount(data.stats?.expressions ?? 0);
      const firstDate = normalized[0]?.date ?? data.activePlan?.starts_on;
      if (firstDate) setCalendarMonth(firstDate.slice(0, 7));
      return "ok";
    } catch (error) {
      setDashboardMessage(error instanceof Error ? error.message : "读取首页数据失败");
      return "error";
    } finally {
      setDashboardLoading(false);
    }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function loadPlans() {
    setPlansLoading(true);
    setPlanMessage("");
    try {
      const response = await fetch("/api/plans", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; plans?: PlanRun[]; message?: string };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.message ?? "读取训练计划失败");
      setPlans(data.plans ?? []);
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "读取训练计划失败");
    } finally {
      setPlansLoading(false);
    }
  }

  function openPlanSettings() {
    setSettingsOpen(true);
    if (!planStartDate) setPlanStartDate(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
    void loadPlans();
  }

  async function createPlan() {
    if (!planStartDate) {
      setPlanMessage("请先选择起始日期");
      return;
    }
    const activePlan = plans.find((plan) => plan.status === "active");
    if (activePlan && !window.confirm(`当前${activePlan.kind === "trial" ? "试运行" : "正式"}计划将被归档，确定继续吗？`)) return;
    setPlansLoading(true);
    setPlanMessage("");
    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: planKind, startsOn: planStartDate }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.message ?? "创建训练计划失败");
      setPlanMessage(data.message ?? "训练计划已创建");
      await Promise.all([loadPlans(), loadDashboard()]);
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "创建训练计划失败");
    } finally {
      setPlansLoading(false);
    }
  }

  async function logOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  const sceneTitles = current?.content?.scenes?.map((scene) => scene.title).filter(Boolean) ?? [];
  const trainingPrompt = current ? `开始 JSOS 训练。\n任务编号：${current.taskId}\nDay：${current.day}\n主题：${current.topic}\n任务类型：${current.kind === "reinforcement" ? "补强训练" : "核心训练"}\n训练场景：${sceneTitles.join("、") || "请按项目规范安排多个场景"}\n目标表达：${current.content?.targetPatterns?.join("、") || "请按当前主题生成"}\n总训练时长：60～90 分钟，可拆成多段对话。\n请读取项目中的教练规则和固定评分标准，然后开始全日语角色扮演。` : "当前没有可执行的训练任务。";

  async function copyTrainingPrompt() {
    try {
      await navigator.clipboard.writeText(trainingPrompt);
      setCopied(true);
      setPromptOpen(false);
      notify("训练指令已复制");
    } catch {
      notify("无法自动复制，请长按任务内容复制");
    }
  }

  async function importSummary() {
    if (!summary.trim()) {
      setSummaryMessage("请先粘贴 ChatGPT 生成的总结");
      return;
    }
    setSummaryImporting(true);
    setSummaryMessage("");
    try {
      const parsed = parseSummaryText(summary);
      const validation = validateSummary(parsed);
      if (!validation.ok) throw new Error(validation.errors.join("；"));
      const response = await fetch("/api/summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.message ?? "总结未通过验证");
      setTaskComplete(true);
      setSummary(JSON.stringify(validation.data, null, 2));
      setSummaryMessage("总结已保存，任务、评分、单词和句子均已更新");
      await loadDashboard();
    } catch (error) {
      setSummaryMessage(error instanceof Error ? error.message : "总结格式不完整或保存失败");
    } finally {
      setSummaryImporting(false);
    }
  }

  function toggleVocabulary(word: string) {
    setVocabulary((items) => items.map((item) => item.word === word ? { ...item, state: item.state === "生词" ? "熟词" : "生词" } : item));
  }

  function toggleSentence(original: string) {
    setSentences((items) => items.map((item) => item.original === original ? { ...item, state: item.state === "待掌握" ? "已掌握" : "待掌握" } : item));
  }

  function toggleAnki(word: string) {
    const next = ankiCompleted.includes(word) ? ankiCompleted.filter((item) => item !== word) : [...ankiCompleted, word];
    setAnkiCompleted(next);
    const complete = next.length === Math.min(3, vocabulary.length);
    if (current) void saveCheckin(current.date, "anki", complete);
  }

  async function saveCheckin(date: string, key: CheckKey, value: boolean) {
    setCheckins((previous) => ({ ...previous, [date]: { ...(previous[date] ?? { anki: false, shadowing: false, monologue: false, writing: false }), [key]: value } }));
    try {
      const response = await fetch("/api/checkins", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, key, value }) });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message ?? "打卡保存失败");
    } catch (error) {
      setCheckins((previous) => ({ ...previous, [date]: { ...(previous[date] ?? { anki: false, shadowing: false, monologue: false, writing: false }), [key]: !value } }));
      notify(error instanceof Error ? error.message : "打卡保存失败");
    }
  }

  function openTask(task: CalendarTask) {
    if (!task.taskId || (task.status !== "today" && task.status !== "done")) return;
    setSelectedTaskId(task.taskId);
    setTaskComplete(task.status === "done");
    setSummaryOpen(false);
    setSummaryMessage("");
    navigate("task");
  }

  function toggleReview(index: number) {
    setReviewCompleted((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index]);
  }

  function navigate(nextView: View) {
    if (nextView === view) return;
    window.history.pushState({ ...window.history.state, jsosView: nextView }, "");
    setView(nextView);
  }

  function goBack() {
    window.history.back();
  }

  if (authState !== "authenticated") {
    return <main className="auth-loading"><span className="brand-mark large">J</span><strong>正在确认登录…</strong></main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("calendar")} aria-label="返回计划首页">
          <span className="brand-mark">J</span>
          <span><strong>JSOS</strong><small>Japanese Speaking OS</small></span>
        </button>
        <nav className="topnav" aria-label="主要导航">
          <button className={view === "calendar" ? "active" : ""} onClick={() => navigate("calendar")}>计划</button>
          <button className={view === "vocabulary" ? "active" : ""} onClick={() => navigate("vocabulary")}>单词</button>
          <button className={view === "sentences" ? "active" : ""} onClick={() => navigate("sentences")}>句子</button>
        </nav>
        <button className="avatar" aria-label="打开计划设置" onClick={openPlanSettings}>A</button>
      </header>

      {view === "calendar" && <CalendarView tasks={tasks} activePlan={activePlan} loading={dashboardLoading} message={dashboardMessage} month={calendarMonth} progress={progress} expressionCount={expressionCount} vocabularyCounts={[vocabularyNewCount, vocabularyKnownCount]} sentenceCounts={[sentenceLearningCount, sentenceMasteredCount]} onTask={openTask} onNavigate={navigate} onMonthChange={setCalendarMonth} onOpenSettings={openPlanSettings} />}
      {view === "task" && current && <TaskView current={current} nextTask={nextTask} complete={taskComplete || current.status === "done"} copied={copied} checks={currentChecks} session={currentSession} words={currentWords} sentences={currentSentences} onOpenPrompt={() => setPromptOpen(true)} onOpenSummary={() => setSummaryOpen(true)} onCheck={(key) => void saveCheckin(current.date, key, !currentChecks[key])} onNavigate={navigate} onBack={goBack} />}
      {view === "vocabulary" && <VocabularyView items={vocabulary} counts={[vocabularyNewCount, vocabularyKnownCount]} onToggle={toggleVocabulary} onBack={goBack} />}
      {view === "sentences" && <SentencesView items={sentences} counts={[sentenceLearningCount, sentenceMasteredCount]} onToggle={toggleSentence} onBack={goBack} />}
      {view === "anki" && <AnkiView items={vocabulary} completed={ankiCompleted} onToggle={toggleAnki} onNotify={notify} onBack={goBack} />}
      {view === "review" && <ReviewView completed={reviewCompleted} onToggle={toggleReview} onBack={goBack} />}

      {summaryOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSummaryOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="summary-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><span className="eyebrow">训练结束</span><h2 id="summary-title">粘贴 ChatGPT 总结</h2></div>
              <button className="icon-button" onClick={() => setSummaryOpen(false)} aria-label="关闭">×</button>
            </div>
            <p>系统会先检查任务编号、版本和三项评分；合法数据会直接保存。</p>
            <textarea value={summary} onChange={(event) => setSummary(event.target.value)} placeholder='粘贴以 { "schemaVersion": "1.0" } 开头的 JSON…' />
            {summaryMessage && <div className={summaryMessage.includes("已保存") ? "message success" : "message"}>{summaryMessage}</div>}
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setSummaryOpen(false)}>稍后处理</button>
              <button className="button primary" disabled={summaryImporting} onClick={importSummary}>{summaryImporting ? "正在保存…" : "验证并导入"}</button>
            </div>
          </section>
        </div>
      )}
      {promptOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPromptOpen(false)}>
          <section className="modal prompt-modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><span className="eyebrow">今日 Live</span><h2 id="prompt-title">训练指令</h2></div>
              <button className="icon-button" onClick={() => setPromptOpen(false)} aria-label="关闭">×</button>
            </div>
            <p>确认内容后复制，再粘贴到 ChatGPT Project「JSOS 日语教练」。</p>
            <textarea className="prompt-preview" value={trainingPrompt} readOnly aria-label="完整训练指令" />
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setPromptOpen(false)}>取消</button>
              <button className="button primary" onClick={copyTrainingPrompt}>复制</button>
            </div>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div><span className="eyebrow">Private settings</span><h2 id="settings-title">训练计划设置</h2></div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="plan-status">
              <strong>当前计划</strong>
              {plansLoading && plans.length === 0 ? <p>正在读取…</p> : plans.find((plan) => plan.status === "active") ? (() => {
                const active = plans.find((plan) => plan.status === "active")!;
                return <p>{active.kind === "trial" ? "试运行" : "正式训练"} · {active.starts_on} 开始</p>;
              })() : <p>尚未创建训练计划</p>}
              {plans.filter((plan) => plan.status === "archived").length > 0 && <small>已归档 {plans.filter((plan) => plan.status === "archived").length} 个旧计划</small>}
            </div>
            <div className="plan-form">
              <label>计划类型<select value={planKind} onChange={(event) => setPlanKind(event.target.value as "trial" | "official")}><option value="trial">试运行</option><option value="official">正式训练</option></select></label>
              <label>Day 1 日期<input type="date" value={planStartDate} onChange={(event) => setPlanStartDate(event.target.value)} /></label>
            </div>
            <p className="settings-note">创建新计划会安全归档当前计划。课程模板保留，旧计划不会参与新计划统计。</p>
            {planMessage && <div className={planMessage.includes("已创建") ? "message success" : "message"}>{planMessage}</div>}
            <div className="modal-actions settings-actions">
              <button className="button secondary" onClick={logOut}>退出登录</button>
              <button className="button primary" disabled={plansLoading} onClick={createPlan}>{plansLoading ? "处理中…" : planKind === "trial" ? "创建试运行计划" : "创建正式计划"}</button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function CalendarView({ tasks, activePlan, loading, message, month, progress, expressionCount, vocabularyCounts, sentenceCounts, onTask, onNavigate, onMonthChange, onOpenSettings }: { tasks: CalendarTask[]; activePlan: PlanRun | null; loading: boolean; message: string; month: string; progress: number; expressionCount: number; vocabularyCounts: [number, number]; sentenceCounts: [number, number]; onTask: (task: CalendarTask) => void; onNavigate: (view: View) => void; onMonthChange: (month: string) => void; onOpenSettings: () => void }) {
  const effectiveMonth = month || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }).slice(0, 7);
  const [year, monthNumber] = effectiveMonth.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cellCount = firstWeekday + daysInMonth > 35 ? 42 : 35;
  const taskByDate = new Map(tasks.map((task) => [task.date, task]));
  function moveMonth(delta: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    onMonthChange(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return (
    <div className="page calendar-page">
      <section className="hero-row">
        <div><span className="eyebrow">60 天口语计划 · 第一阶段</span><h1 className="hero-title">JSOS——你的日语陪练。</h1><p>今天不是赶进度，而是把薄弱的地方真正练会。</p></div>
        <div className="progress-card">
          <div className="progress-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><strong>{progress}%</strong><span>总体进度</span></div>
          <div><small>已完成</small><strong>{tasks.filter((task) => task.status === "done").length} 天</strong><small>累计表达</small><strong>{expressionCount} 句</strong></div>
        </div>
      </section>
      <section className="calendar-panel">
        <div className="section-heading">
          <div><span className="eyebrow">{year}</span><h2>{monthNumber}月学习计划</h2></div>
          <div className="calendar-actions"><button onClick={() => moveMonth(-1)} aria-label="上个月">←</button><button onClick={() => moveMonth(1)} aria-label="下个月">→</button></div>
          <div className="legend"><span><i className="dot done" />已完成</span><span><i className="dot today" />今天</span><span><i className="dot reinforcement" />补强</span><span><i className="dot deferred" />已顺延</span></div>
        </div>
        {!activePlan ? <div className="empty-plan"><strong>{loading ? "正在读取训练计划…" : "尚未开启计划"}</strong><p>{message || "创建试运行或正式计划后，Day 1～40 会按起始日期自动排入日历。"}</p>{!loading && <button className="button primary" onClick={onOpenSettings}>开启训练计划</button>}</div> : <>
        <div className="weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
        <div className="calendar-grid">
          {Array.from({ length: cellCount }, (_, index) => {
            const day = index - firstWeekday + 1;
            const isoDate = day > 0 && day <= daysInMonth ? `${effectiveMonth}-${String(day).padStart(2, "0")}` : "";
            const task = taskByDate.get(isoDate);
            return isoDate ? (
              <button key={isoDate} className={`calendar-day ${task?.status ?? "empty"} ${task?.kind ?? ""}`} onClick={task && (task.status === "today" || task.status === "done") ? () => onTask(task) : undefined}>
                <span className="date-number">{day}日</span>
                {task?.status === "deferred" ? <strong>已顺延</strong> : task?.topic ? <><small>Day {task.day}</small><strong><span className="desktop-topic">{task.topic}</span><span className="mobile-topic">{task.topic.replace(/\s+/g, "").slice(0, 3)}</span></strong>{task.kind === "reinforcement" && <em>补强</em>}</> : null}
              </button>
            ) : <div key={index} className="calendar-day empty outside-month" />;
          })}
        </div>
        </>}
      </section>
      <section className="quick-grid mobile-library-links" aria-label="学习资料">
        <button onClick={() => onNavigate("vocabulary")}><span>ことば</span><strong>单词总表</strong><small>生词 {vocabularyCounts[0]} · 熟词 {vocabularyCounts[1]}</small><b>→</b></button>
        <button onClick={() => onNavigate("sentences")}><span>フレーズ</span><strong>句子合集</strong><small>待掌握 {sentenceCounts[0]} · 已掌握 {sentenceCounts[1]}</small><b>→</b></button>
      </section>
    </div>
  );
}

function TaskView({ current, nextTask, complete, copied, checks, session, words, sentences, onOpenPrompt, onOpenSummary, onCheck, onNavigate, onBack }: {
  current: CalendarTask; nextTask: CalendarTask | null; complete: boolean; copied: boolean; checks: DailyChecks; session: TrainingSession | null; words: VocabularyItem[]; sentences: SentenceItem[]; onOpenPrompt: () => void; onOpenSummary: () => void; onCheck: (key: CheckKey) => void; onNavigate: (view: View) => void; onBack: () => void;
}) {
  const stage = (current.day ?? 1) <= 15 ? "第一阶段 · 高频生活" : (current.day ?? 1) <= 25 ? "第二阶段 · 社会生活" : "第三阶段 · 软件互联网工作";
  const focus = current.content?.scenes?.map((scene) => scene.title).filter((title): title is string => Boolean(title)).slice(0, 4) ?? [];
  return (
    <div className="page narrow-page">
      <button className="back-link" onClick={onBack}>← 返回计划</button>
      <section className="task-header">
        <div><span className="eyebrow">{stage}</span><h1>Day {current.day} <span>{current.topic}</span></h1><p>围绕「{current.topic}」完成多个真实场景的日语口语训练。</p></div>
        <div className={`status-pill ${complete ? "complete" : ""}`}>{complete ? "已完成" : "今日任务"}</div>
      </section>
      <section className="task-layout">
        <div className="task-main">
          <article className="card live-card">
            <div className="card-number">01</div><div className="card-body"><span className="eyebrow">Main session</span><h2>今日 Live</h2><p>在 ChatGPT Project「JSOS 日语教练」中完成共计 60～90 分钟对话，可拆成多段进行。</p>
              <div className="focus-list">{(focus.length ? focus : current.content?.targetPatterns?.slice(0, 4) ?? ["主题会话"]).map((item) => <span key={item}>{item}</span>)}</div>
              <div className="action-row"><button className="button primary" onClick={onOpenPrompt}>{copied ? "查看已复制指令" : "复制训练指令"}</button><a className="button lime" href="https://chatgpt.com" target="_blank" rel="noreferrer">打开 ChatGPT ↗</a></div>
            </div>
          </article>
          <article className="card import-card">
            <div className="card-number">02</div><div className="card-body"><span className="eyebrow">After live</span><h2>导入训练总结</h2><p>结束 Voice 后，复制 ChatGPT 生成的 JSON 总结，交给 JSOS 更新学习档案。</p><button className="button primary summary-import-button" onClick={onOpenSummary}>{complete ? "重新导入训练总结" : "粘贴训练总结"}</button></div>
          </article>
          {complete && session && <ScoreSummary session={session} words={words} sentences={sentences} />}
        </div>
        <aside className="task-aside">
          <article className="side-card"><span className="eyebrow">Review</span><h3>昨日复习</h3><p>2 个单词 · 2 个句子</p><button onClick={() => onNavigate("review")}>开始复习 <span>→</span></button></article>
          <article className="side-card checklist"><span className="eyebrow">Daily rhythm</span><h3>当日其他训练</h3>
            <CheckRow label="当日 Anki" checked={checks.anki} onClick={() => onNavigate("anki")} />
            <CheckRow label="当日 Shadowing" checked={checks.shadowing} onClick={() => onCheck("shadowing")} />
            <CheckRow label="当日独白" checked={checks.monologue} onClick={() => onCheck("monologue")} />
            <CheckRow label="当日写作" checked={checks.writing} onClick={() => onCheck("writing")} />
          </article>
          <article className="side-card next-card"><span className="eyebrow">Next</span><h3>推荐安排</h3><strong>{nextTask ? `Day ${nextTask.day} · ${nextTask.topic}` : "当前计划最后一天"}</strong><p>系统会在北京时间凌晨 1:00 根据本次结果重新确认。</p><button>调整日期</button></article>
        </aside>
      </section>
    </div>
  );
}

function ScoreSummary({ session, words, sentences }: { session: TrainingSession; words: VocabularyItem[]; sentences: SentenceItem[] }) {
  const scores: Array<[string, number | null]> = [["传达性", session.communication_score], ["流利度", session.fluency_score], ["发音", session.pronunciation_score]];
  return <section className="card score-card"><div className="score-heading"><div><span className="eyebrow">Session summary</span><h2>本次训练表现</h2></div><strong>{session.duration_minutes ? `${session.duration_minutes}min` : "时长未记录"}</strong></div><div className="score-grid">{scores.map(([label, score]) => <div key={label}><span>{label}</span><strong>{score ?? "—"}<small>/5</small></strong><i><b style={{ width: `${(score ?? 0) * 20}%` }} /></i></div>)}</div><div className="summary-note"><strong>{session.needs_reinforcement ? "建议补强" : "今日总结"}</strong><p>{session.summary_zh || session.recommendation?.reasonZh || "总结已导入。"}</p></div><div className="summary-records"><div><strong>本次单词 · {words.length}</strong>{words.length ? <ul>{words.map((item) => <li key={item.id}><b>{item.word}</b><span>{item.reading}</span><small>{item.meaning}</small></li>)}</ul> : <p>本次没有新增单词。</p>}</div><div><strong>本次句子 · {sentences.length}</strong>{sentences.length ? <ul>{sentences.map((item) => <li key={`${item.original}-${item.corrected}`}><span className="old-sentence">{item.original}</span><b>{item.corrected}</b>{item.note && <small>{item.note}</small>}</li>)}</ul> : <p>本次没有新增句子。</p>}</div></div></section>;
}

function CheckRow({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return <button className="check-row" onClick={onClick}><span className={checked ? "check checked" : "check"}>{checked ? "✓" : ""}</span><strong>{label}</strong><small>{checked ? "已完成" : "待完成"}</small></button>;
}

function VocabularyView({ items, counts, onToggle, onBack }: { items: VocabularyItem[]; counts: [number, number]; onToggle: (word: string) => void; onBack: () => void }) {
  const [tab, setTab] = useState("生词");
  const visible = items.filter((item) => item.state === tab);
  return <ListPage title="单词总表" subtitle="把对话里真正卡住你的词，变成下一次能自然说出的词。" onBack={onBack}><div className="tabs"><button className={tab === "生词" ? "active" : ""} onClick={() => setTab("生词")}>生词 <span>{counts[0]}</span></button><button className={tab === "熟词" ? "active" : ""} onClick={() => setTab("熟词")}>熟词 <span>{counts[1]}</span></button></div><div className="list-card">{visible.map((item) => <div className="vocab-row" key={item.word}><div><strong>{item.word}</strong><span>{item.reading}</span></div><p>{item.meaning}</p><small>来自 · {item.source}</small><button className={item.state === "熟词" ? "marked" : ""} onClick={() => onToggle(item.word)} aria-label={`${item.state === "生词" ? "标记为熟词" : "移回生词"} ${item.word}`}>{item.state === "生词" ? "✓" : "↶"}</button></div>)}{visible.length === 0 && <div className="empty-list">这里暂时没有内容</div>}</div></ListPage>;
}

function SentencesView({ items, counts, onToggle, onBack }: { items: SentenceItem[]; counts: [number, number]; onToggle: (original: string) => void; onBack: () => void }) {
  const [tab, setTab] = useState("待掌握");
  const visible = items.filter((item) => item.state === tab);
  return <ListPage title="句子合集" subtitle="不是收集标准答案，而是记住你曾经想说、但没有自然说出来的话。" onBack={onBack}><div className="tabs"><button className={tab === "待掌握" ? "active" : ""} onClick={() => setTab("待掌握")}>待掌握 <span>{counts[0]}</span></button><button className={tab === "已掌握" ? "active" : ""} onClick={() => setTab("已掌握")}>已掌握 <span>{counts[1]}</span></button></div><div className="sentence-list">{visible.map((item) => <article className={item.state === "已掌握" ? "completed" : ""} key={item.original}><span className="eyebrow">Your expression</span><p className="old-sentence">{item.original}</p><span className="arrow-down">↓</span><strong>{item.corrected}</strong><small>{item.note}</small><button onClick={() => onToggle(item.original)}>{item.state === "待掌握" ? "标记为已掌握" : "移回待掌握"}</button></article>)}{visible.length === 0 && <div className="empty-list">这里暂时没有内容</div>}</div></ListPage>;
}

function AnkiView({ items, completed, onToggle, onNotify, onBack }: { items: VocabularyItem[]; completed: string[]; onToggle: (word: string) => void; onNotify: (message: string) => void; onBack: () => void }) {
  const cards = items.slice(0, 3);
  function downloadCsv() {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [["单词", "读音", "中文释义", "来源"], ...cards.map((item) => [item.word, item.reading, item.meaning, item.source])];
    const csv = `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "jsos-anki-today.csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onNotify("Anki CSV 已下载");
  }
  return <ListPage title="今日 Anki" subtitle="今天只处理最值得记住的内容，不让卡片数量淹没练习。" onBack={onBack}><div className="anki-summary"><div><strong>{cards.length}</strong><span>今日卡片</span></div><div><strong>{cards.length - completed.length}</strong><span>待完成</span></div><div><strong>{completed.length}</strong><span>已完成</span></div><button className="button lime" onClick={downloadCsv}>下载 Anki CSV</button></div>{completed.length === cards.length && cards.length > 0 && <div className="review-complete">今日 Anki 已全部完成。</div>}<div className="list-card">{cards.map((item) => <div className={`vocab-row ${completed.includes(item.word) ? "row-complete" : ""}`} key={item.word}><div><strong>{item.word}</strong><span>{item.reading}</span></div><p>{item.meaning}</p><small>优先级 · 高</small><button className={completed.includes(item.word) ? "marked" : ""} onClick={() => onToggle(item.word)} aria-label={`${completed.includes(item.word) ? "取消完成" : "完成"} ${item.word}`}>{completed.includes(item.word) ? "↶" : "✓"}</button></div>)}</div></ListPage>;
}

function ReviewView({ completed, onToggle, onBack }: { completed: number[]; onToggle: (index: number) => void; onBack: () => void }) {
  return <ListPage title="复习昨日" subtitle="约 5 分钟 · 回到昨天没有说顺的地方。" onBack={onBack}>{completed.length === 2 && <div className="review-complete">昨日内容已复习完成，可以随时撤销重新练习。</div>}<section className="review-stack"><article className={completed.includes(0) ? "completed" : ""}><span className="eyebrow">Word 01</span><h2>単品 <small>たんぴん</small></h2><p>单点</p><strong>こちらは単品で注文できますか。</strong><button className={`button ${completed.includes(0) ? "secondary" : "primary"}`} onClick={() => onToggle(0)}>{completed.includes(0) ? "撤销" : "记住了"}</button></article><article className={completed.includes(1) ? "completed" : ""}><span className="eyebrow">Expression 02</span><p className="old-sentence">水をもらいますか。</p><span className="arrow-down">↓</span><h2>お水をいただけますか。</h2><small>向店员请求时更自然礼貌</small><button className={`button ${completed.includes(1) ? "secondary" : "primary"}`} onClick={() => onToggle(1)}>{completed.includes(1) ? "撤销" : "记住了"}</button></article></section></ListPage>;
}

function ListPage({ title, subtitle, onBack, children }: { title: string; subtitle: string; onBack: () => void; children: React.ReactNode }) {
  return <div className="page list-page"><button className="back-link" onClick={onBack}>← 返回计划</button><header><span className="eyebrow">Learning library</span><h1>{title}</h1><p>{subtitle}</p></header>{children}</div>;
}
