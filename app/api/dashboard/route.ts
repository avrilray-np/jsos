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
    const [tasks, calendar, vocabulary, sentences, sessions] = await Promise.all([
      readRows(`tasks?select=id,day_number,topic,task_type,status,scheduled_for,content&plan_run_id=eq.${planId}&order=day_number.asc`, session.accessToken),
      readRows(`calendar_entries?select=calendar_date,state,task_id,note&plan_run_id=eq.${planId}&order=calendar_date.asc`, session.accessToken),
      readRows(`vocabulary?select=word,reading,meaning_zh,status,priority&plan_run_id=eq.${planId}&order=first_seen_at.asc`, session.accessToken),
      readRows(`sentences?select=original,corrected,explanation_zh,status&plan_run_id=eq.${planId}&order=created_at.asc`, session.accessToken),
      readRows(`training_sessions?select=duration_minutes&plan_run_id=eq.${planId}`, session.accessToken),
    ]);

    const completed = (tasks as Array<{ status?: string }>).filter((task) => task.status === "completed").length;
    const expressions = (sentences as unknown[]).length;
    return Response.json({ ok: true, activePlan, tasks, calendar, vocabulary, sentences, sessions, stats: { completed, expressions } });
  } catch {
    return Response.json({ ok: false, message: "读取首页数据失败" }, { status: 502 });
  }
}
