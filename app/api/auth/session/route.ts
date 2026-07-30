import { appendClearedSessionCookies, appendSessionCookies, getRequestSession, refreshRequestSession } from "../../../../lib/auth-session";
import { isCloudConfigured } from "../../../../lib/server-config";

export async function GET(request: Request) {
  if (!isCloudConfigured()) {
    return Response.json({ ok: false, code: "SETUP_REQUIRED", message: "Supabase 尚未连接" }, { status: 503 });
  }

  const current = await getRequestSession(request);
  if (current) return Response.json({ ok: true, user: { email: current.email } });

  const refreshed = await refreshRequestSession(request);
  if (refreshed) {
    const headers = new Headers({ "Content-Type": "application/json" });
    appendSessionCookies(headers, request, refreshed.tokens);
    return new Response(JSON.stringify({ ok: true, user: { email: refreshed.session.email }, refreshed: true }), { status: 200, headers });
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  appendClearedSessionCookies(headers, request);
  return new Response(JSON.stringify({ ok: false, message: "登录已失效" }), { status: 401, headers });
}
