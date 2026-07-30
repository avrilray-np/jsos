import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

type PlanKind = "trial" | "official";

export async function GET(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  const response = await supabaseUser(
    "plan_runs?select=id,kind,status,starts_on,activated_at,archived_at&order=created_at.desc",
    session.accessToken,
  );
  if (!response.ok) return Response.json({ ok: false, message: "读取训练计划失败" }, { status: 502 });
  const plans = await response.json();
  return Response.json({ ok: true, plans });
}

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  const body = await request.json() as { kind?: PlanKind; startsOn?: string };
  if (body.kind !== "trial" && body.kind !== "official") {
    return Response.json({ ok: false, message: "计划类型不正确" }, { status: 422 });
  }
  if (!body.startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(body.startsOn) || Number.isNaN(Date.parse(`${body.startsOn}T00:00:00Z`))) {
    return Response.json({ ok: false, message: "请选择有效的起始日期" }, { status: 422 });
  }

  const response = await supabaseUser("rpc/start_jsos_plan", session.accessToken, {
    method: "POST",
    body: JSON.stringify({ p_kind: body.kind, p_starts_on: body.startsOn }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    const message = error?.message?.includes("40 enabled curriculum") ? "课程模板尚未准备完整" : "创建训练计划失败，请稍后重试";
    return Response.json({ ok: false, message }, { status: 502 });
  }

  const planId = await response.json();
  return Response.json({ ok: true, planId, message: body.kind === "trial" ? "试运行计划已创建" : "正式计划已创建" });
}
