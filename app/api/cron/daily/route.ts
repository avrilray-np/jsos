import { supabaseAdmin } from "../../../../lib/supabase-rest";

export async function GET(request: Request) {
  const secret = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== `Bearer ${expected}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const response = await supabaseAdmin("rpc/run_jsos_daily_rollover", {
    method: "POST",
    body: JSON.stringify({ p_today: null }),
  });
  if (!response.ok) return Response.json({ ok: false, error: "daily rollover failed" }, { status: 502 });
  return Response.json({ ok: true, timezone: "Asia/Shanghai", result: await response.json() });
}

export const POST = GET;
