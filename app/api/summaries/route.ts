import { getRequestSession } from "../../../lib/auth-session";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, message: "Supabase 尚未连接" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  try {
    const summary = await request.json();
    const response = await supabaseUser("rpc/import_jsos_summary", session.accessToken, {
      method: "POST",
      body: JSON.stringify({ p_summary: summary }),
    });
    const result = await response.json();
    if (!response.ok) return Response.json({ ok: false, message: result?.message ?? "总结未通过验证" }, { status: 422 });
    return Response.json({ ok: true, result });
  } catch {
    return Response.json({ ok: false, message: "无法解析或保存训练总结" }, { status: 400 });
  }
}
