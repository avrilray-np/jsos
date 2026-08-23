import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";
import { validateSummary } from "../../../lib/jsos-domain";
import { getJsosTrainingDate } from "../../../lib/training-day";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, message: "Supabase 尚未连接" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  try {
    const body = await request.json() as { expectedTaskId?: unknown; summary?: unknown };
    if (typeof body.expectedTaskId !== "string" || !body.expectedTaskId) {
      return Response.json({ ok: false, message: "缺少当前任务编号" }, { status: 400 });
    }
    const validation = validateSummary(body.summary);
    if (!validation.ok) return Response.json({ ok: false, message: validation.errors.join("；") }, { status: 422 });
    if (validation.data.task.taskId !== body.expectedTaskId) {
      return Response.json({ ok: false, message: "总结中的任务编号与当前页面不一致，请粘贴当前任务的总结" }, { status: 409 });
    }
    const taskResponse = await supabaseUser(
      `tasks?select=scheduled_for&id=eq.${encodeURIComponent(body.expectedTaskId)}&limit=1`,
      session.accessToken,
    );
    const taskRows = await taskResponse.json() as Array<{ scheduled_for?: string }> | { message?: string };
    if (!taskResponse.ok || !Array.isArray(taskRows) || !taskRows[0]) {
      return Response.json({ ok: false, message: "当前任务不存在或无权访问" }, { status: 404 });
    }
    if (taskRows[0].scheduled_for !== getJsosTrainingDate()) {
      return Response.json({ ok: false, message: "该任务已超过提交时间；每日凌晨 1:00 后不能再提交前一训练日总结" }, { status: 409 });
    }
    const response = await supabaseUser("rpc/import_jsos_summary", session.accessToken, {
      method: "POST",
      body: JSON.stringify({ p_summary: validation.data }),
    });
    const result = await response.json();
    if (!response.ok) {
      const message = typeof result?.message === "string" && result.message.includes("summary import window closed")
        ? "该任务已超过提交时间；每日凌晨 1:00 后不能再提交前一训练日总结"
        : result?.message ?? "总结未通过验证";
      return Response.json({ ok: false, message }, { status: 422 });
    }
    return Response.json({ ok: true, result });
  } catch {
    return Response.json({ ok: false, message: "无法解析或保存训练总结" }, { status: 400 });
  }
}
