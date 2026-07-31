import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

const CHECK_KEYS = ["anki", "shadowing", "monologue", "writing"] as const;
type CheckKey = (typeof CHECK_KEYS)[number];

export async function PATCH(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, message: "Supabase 尚未连接" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  try {
    const body = await request.json() as { date?: string; key?: string; value?: boolean };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "")) return Response.json({ ok: false, message: "训练日期无效" }, { status: 400 });
    if (!CHECK_KEYS.includes(body.key as CheckKey) || typeof body.value !== "boolean") return Response.json({ ok: false, message: "打卡项目无效" }, { status: 400 });

    const plans = await supabaseUser("plan_runs?select=id&status=eq.active&limit=1", session.accessToken);
    if (!plans.ok) throw new Error("active plan unavailable");
    const activePlans = await plans.json() as Array<{ id: string }>;
    if (!activePlans[0]) return Response.json({ ok: false, message: "当前没有训练计划" }, { status: 409 });

    const row = {
      user_id: session.userId,
      plan_run_id: activePlans[0].id,
      check_date: body.date,
      [body.key as CheckKey]: body.value,
    };
    const response = await supabaseUser("daily_checkins?on_conflict=plan_run_id,check_date", session.accessToken, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    });
    const result = await response.json();
    if (!response.ok) return Response.json({ ok: false, message: result?.message ?? "打卡保存失败" }, { status: 422 });
    return Response.json({ ok: true, checkin: result?.[0] ?? row });
  } catch {
    return Response.json({ ok: false, message: "打卡保存失败" }, { status: 400 });
  }
}
