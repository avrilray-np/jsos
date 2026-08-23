import { getRequestSession } from "../../../../lib/auth-session";
import { isCloudConfigured } from "../../../../lib/server-config";
import { supabaseUser } from "../../../../lib/supabase-rest";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  const response = await supabaseUser("rpc/dismiss_jsos_password_prompt", session.accessToken, { method: "POST", body: "{}" });
  if (!response.ok) return Response.json({ ok: false, message: "暂时无法关闭提示" }, { status: 502 });
  return Response.json({ ok: true });
}
