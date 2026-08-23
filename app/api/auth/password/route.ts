import { getRequestSession } from "../../../../lib/auth-session";
import { isCloudConfigured } from "../../../../lib/server-config";
import { supabaseAuth, supabaseUser } from "../../../../lib/supabase-rest";

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  const body = await request.json() as { password?: string };
  const password = body.password ?? "";
  if (password.length < 12 || password.length > 128) {
    return Response.json({ ok: false, message: "新密码需为 12～128 位" }, { status: 422 });
  }
  const response = await supabaseAuth("user", {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) return Response.json({ ok: false, message: "密码修改失败，请稍后重试" }, { status: 502 });
  await supabaseUser("rpc/dismiss_jsos_password_prompt", session.accessToken, { method: "POST", body: "{}" });
  return Response.json({ ok: true, message: "密码已修改" });
}
