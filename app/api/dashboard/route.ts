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
    if (!activePlan) {
      return Response.json({ ok: true, activePlan: null, tasks: [], calendar: [], vocabulary: [], sentences: [], stats: { completed: 0, expressions: 0 } });
    }

    const planId = encodeURIComponent(String(activePlan.id));
    const [tasks, calendar, vocabulary, vocabularySources, sentences, sessions, checkins] = await Promise.all([
      readRows(`tasks?select=id,day_number,topic,task_type,status,scheduled_for,content&plan_run_id=eq.${planId}&order=day_number.asc`, session.accessToken),
      readRows(`calendar_entries?select=calendar_date,state,task_id,note&plan_run_id=eq.${planId}&order=calendar_date.asc`, session.accessToken),
      readRows(`vocabulary?select=id,word,reading,meaning_zh,status,priority,source_type,source_task_id&plan_run_id=eq.${planId}&order=first_seen_at.asc`, session.accessToken),
      readRows("vocabulary_sources?select=vocabulary_id,session_id", session.accessToken),
      readRows(`sentences?select=id,session_id,source_task_id,source_type,original,corrected,meaning_zh,explanation_zh,status&plan_run_id=eq.${planId}&order=created_at.asc`, session.accessToken),
      readRows(`training_sessions?select=id,task_id,duration_minutes,communication_score,fluency_score,pronunciation_score,summary_zh,needs_reinforcement,recommendation,raw_summary,imported_at&plan_run_id=eq.${planId}&order=imported_at.desc`, session.accessToken),
      readRows(`daily_checkins?select=check_date,anki,shadowing,monologue,writing&plan_run_id=eq.${planId}&order=check_date.asc`, session.accessToken),
    ]);

    const completed = (tasks as Array<{ status?: string }>).filter((task) => task.status === "completed").length;
    const expressions = (sentences as unknown[]).length;
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
    return Response.json({ ok: true, activePlan, tasks, calendar, vocabulary, vocabularySources, sentences, sessions: safeSessions, checkins, stats: { completed, expressions } });
  } catch {
    return Response.json({ ok: false, message: "读取首页数据失败" }, { status: 502 });
  }
}
