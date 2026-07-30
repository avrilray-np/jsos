import { appendClearedSessionCookies } from "../../../../lib/auth-session";

export async function POST(request: Request) {
  const headers = new Headers({ "Content-Type": "application/json" });
  appendClearedSessionCookies(headers, request);
  return new Response(JSON.stringify({ ok: true }), { headers });
}
