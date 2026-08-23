import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

async function readRows(path: string, accessToken: string) {
  const response = await supabaseUser(path, accessToken);
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status}`);
  return response.json();
}

export async function GET(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  try {
    const plans = await readRows(
      "plan_runs?select=id,kind,status,starts_on,activated_at,archived_at&status=eq.active&limit=1",
      session.accessToken,
    ) as Array<Record<string, unknown>>;
    const activePlan = plans[0] ?? null;

    const planId = activePlan ? encodeURIComponent(String(activePlan.id)) : "";
    const [tasks, calendar, vocabulary, vocabularySources, sentences, sessions, checkins, datedTasks] = await Promise.all([
      activePlan ? readRows(`tasks?select=id,day_number,topic,task_type,status,scheduled_for,content&plan_run_id=eq.${planId}&order=day_number.asc`, session.accessToken) : [],
      activePlan ? readRows(`calendar_entries?select=calendar_date,state,task_id,note&plan_run_id=eq.${planId}&order=calendar_date.asc`, session.accessToken) : [],
      readRows("vocabulary?select=id,plan_run_id,word,reading,meaning_zh,status,priority,source_type,source_task_id&order=first_seen_at.asc", session.accessToken),
      readRows("vocabulary_sources?select=vocabulary_id,session_id", session.accessToken),
      readRows("sentences?select=id,plan_run_id,session_id,source_task_id,source_type,original,corrected,meaning_zh,explanation_zh,status&order=created_at.asc", session.accessToken),
      readRows("training_sessions?select=id,plan_run_id,task_id,duration_minutes,communication_score,fluency_score,pronunciation_score,summary_zh,needs_reinforcement,recommendation,raw_summary,imported_at&order=imported_at.desc", session.accessToken),
      activePlan ? readRows(`daily_checkins?select=check_date,anki,shadowing,monologue,writing&plan_run_id=eq.${planId}&order=check_date.asc`, session.accessToken) : [],
      readRows("tasks?select=id,scheduled_for", session.accessToken),
    ]);

    const completed = (tasks as Array<{ status?: string }>).filter((task) => task.status === "completed").length;
    const expressions = activePlan
      ? (sentences as Array<{ plan_run_id?: string }>).filter((item) => item.plan_run_id === activePlan.id).length
      : 0;
    const taskDateById = new Map((datedTasks as Array<{ id: string; scheduled_for: string | null }>).map((task) => [task.id, task.scheduled_for]));
    const sessionTaskById = new Map((sessions as Array<{ id: string; task_id: string }>).map((trainingSession) => [trainingSession.id, trainingSession.task_id]));
    const vocabularySessionIds = new Map<string, string[]>();
    for (const source of vocabularySources as Array<{ vocabulary_id: string; session_id: string }>) {
      vocabularySessionIds.set(source.vocabulary_id, [...(vocabularySessionIds.get(source.vocabulary_id) ?? []), source.session_id]);
    }
    const reviewByDate: Record<string, { vocabularyIds: string[]; sentenceIds: string[] }> = {};
    const addReviewId = (date: string | null | undefined, kind: "vocabularyIds" | "sentenceIds", id: string) => {
      if (!date) return;
      reviewByDate[date] ??= { vocabularyIds: [], sentenceIds: [] };
      if (!reviewByDate[date][kind].includes(id)) reviewByDate[date][kind].push(id);
    };
    for (const item of vocabulary as Array<{ id: string; source_task_id?: string | null }>) {
      addReviewId(taskDateById.get(item.source_task_id ?? ""), "vocabularyIds", item.id);
      for (const sessionId of vocabularySessionIds.get(item.id) ?? []) {
        addReviewId(taskDateById.get(sessionTaskById.get(sessionId) ?? ""), "vocabularyIds", item.id);
      }
    }
    for (const item of sentences as Array<{ id: string; source_task_id?: string | null; session_id?: string | null }>) {
      addReviewId(taskDateById.get(item.source_task_id ?? ""), "sentenceIds", item.id);
      if (item.session_id) addReviewId(taskDateById.get(sessionTaskById.get(item.session_id) ?? ""), "sentenceIds", item.id);
    }
    const safeSessions = (sessions as Array<Record<string, unknown>>).map(({ raw_summary: rawSummary, ...trainingSession }) => {
      const summarySession = rawSummary && typeof rawSummary === "object"
        ? (rawSummary as { session?: unknown }).session
        : null;
      const coreGoalAchieved = summarySession && typeof summarySession === "object"
        ? (summarySession as { coreGoalAchieved?: unknown }).coreGoalAchieved
        : null;
      return {
        ...trainingSession,
        core_goal_achieved: typeof coreGoalAchieved === "boolean" ? coreGoalAchieved : null,
      };
    });
    return Response.json({
      ok: true,
      activePlan,
      tasks,
      calendar,
      vocabulary,
      vocabularySources,
      sentences,
      sessions: safeSessions,
      checkins,
      reviewByDate,
      stats: { completed, expressions },
    });
  } catch {
    return Response.json({ ok: false, message: "读取首页数据失败" }, { status: 502 });
  }
}
