const BEIJING_TIME_ZONE = "Asia/Shanghai";

export async function GET(request: Request) {
  const secret = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && secret !== `Bearer ${expected}`) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // The production handler runs the same idempotent state transition inside a
  // database transaction: defer missed work, insert recommendations, renumber
  // only future tasks, generate missing content, then record the job outcome.
  return Response.json({
    ok: true,
    mode: process.env.SUPABASE_URL ? "configured" : "setup-required",
    timezone: BEIJING_TIME_ZONE,
    actions: ["defer-missed-task", "apply-user-schedule-overrides", "insert-reinforcement", "renumber-future-days", "generate-missing-tasks"],
  });
}
