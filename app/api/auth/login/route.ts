import { getServerConfig, isCloudConfigured } from "../../../../lib/server-config";
import { appendSessionCookies } from "../../../../lib/auth-session";
import { supabaseAuth } from "../../../../lib/supabase-rest";

export async function POST(request: Request) {
  const { email, password } = await request.json() as { email?: string; password?: string };
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const config = getServerConfig();
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED", message: "Supabase 尚未连接" }, { status: 503 });
  if (!normalizedEmail || normalizedEmail !== config.allowedEmail) return Response.json({ ok: false, message: "该账号未获授权" }, { status: 403 });
  const response = await supabaseAuth("token?grant_type=password", { method: "POST", body: JSON.stringify({ email: normalizedEmail, password }) });
  const data = await response.json();
  if (!response.ok) return Response.json({ ok: false, message: "邮箱或密码不正确" }, { status: 401 });
  const headers = new Headers({ "Content-Type": "application/json" });
  appendSessionCookies(headers, request, data);
  return new Response(JSON.stringify({ ok: true, user: { email: normalizedEmail } }), { status: 200, headers });
}
