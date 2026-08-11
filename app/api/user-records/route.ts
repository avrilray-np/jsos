import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

type RecordKind = "vocabulary" | "sentence";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, message: "Supabase 尚未连接" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  try {
    const body = await request.json() as {
      taskId?: string;
      kind?: RecordKind;
      value?: string;
      reading?: string;
      meaningZh?: string;
    };
    const taskId = body.taskId?.trim() ?? "";
    const value = body.value?.trim() ?? "";
    const reading = body.reading?.trim() ?? "";
    const meaningZh = body.meaningZh?.trim() ?? "";

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      return Response.json({ ok: false, message: "任务编号无效" }, { status: 422 });
    }
    if (body.kind !== "vocabulary" && body.kind !== "sentence") {
      return Response.json({ ok: false, message: "记录类型不正确" }, { status: 422 });
    }
    if (!value || value.length > 200) {
      return Response.json({ ok: false, message: body.kind === "vocabulary" ? "请输入有效的单词" : "请输入有效的日语表达" }, { status: 422 });
    }
    if (!meaningZh || meaningZh.length > 300) {
      return Response.json({ ok: false, message: "请输入有效的中文释义" }, { status: 422 });
    }
    if (body.kind === "vocabulary" && (!reading || reading.length > 200)) {
      return Response.json({ ok: false, message: "请输入平假名读音" }, { status: 422 });
    }

    const response = await supabaseUser("rpc/add_jsos_user_record", session.accessToken, {
      method: "POST",
      body: JSON.stringify({
        p_task_id: taskId,
        p_kind: body.kind,
        p_value: value,
        p_reading: body.kind === "vocabulary" ? reading : null,
        p_meaning_zh: meaningZh,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) return Response.json({ ok: false, message: "保存用户记录失败" }, { status: 422 });
    return Response.json({ ok: true, result });
  } catch {
    return Response.json({ ok: false, message: "无法保存用户记录" }, { status: 400 });
  }
}
