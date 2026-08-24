import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  const body = await request.json().catch(() => null) as { taskId?: string } | null;
  if (!body?.taskId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.taskId)) {
    return Response.json({ ok: false, message: "任务编号不正确" }, { status: 422 });
  }
  const response = await supabaseUser("rpc/retry_jsos_daily_generation", session.accessToken, {
    method: "POST",
    body: JSON.stringify({ p_task_id: body.taskId }),
  });
  if (!response.ok) return Response.json({ ok: false, message: "暂时无法重新生成，请稍后再试" }, { status: 502 });
  const retryCount = await response.json() as number;
  return Response.json({ ok: true, retryCount, message: retryCount > 1 ? "再次生成中" : "主题生成中" });
}
