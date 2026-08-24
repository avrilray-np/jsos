import { getAiProvider } from "../../../../lib/ai-provider";
import { createPlanErrorCode, normalizeGeneratedTaskContent } from "../../../../lib/plan-generation";
import { supabaseAdmin } from "../../../../lib/supabase-rest";

type ClaimedJob = {
  job_id: string;
  draft_id: string;
  day_number: number;
  learning_goal: string;
  topic: string;
  attempt_count: number;
};

const JOBS_PER_TICK = 6;

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const jobs: ClaimedJob[] = [];
  for (let index = 0; index < JOBS_PER_TICK; index += 1) {
    const claim = await supabaseAdmin("rpc/claim_next_jsos_daily_generation_job", {
      method: "POST",
      body: "{}",
    });
    if (!claim.ok) {
      if (jobs.length === 0) return Response.json({ ok: false, error: "claim failed" }, { status: 502 });
      break;
    }
    const [job] = await claim.json() as ClaimedJob[];
    if (!job) break;
    jobs.push(job);
  }

  if (jobs.length === 0) return Response.json({ ok: true, status: "idle", processed: 0 });

  const results = await Promise.all(jobs.map(processJob));
  return Response.json({
    ok: true,
    status: "processed",
    processed: results.length,
    completed: results.filter((result) => result === "completed").length,
    retrying: results.filter((result) => result === "retrying").length,
    failed: results.filter((result) => result === "failed").length,
  });
}

async function processJob(job: ClaimedJob): Promise<"completed" | "retrying" | "failed"> {
  try {
    const raw = await getAiProvider().generateTask({
      taskId: job.job_id,
      dayNumber: job.day_number,
      topic: job.topic,
      taskType: "core",
      learningGoal: job.learning_goal,
      previousWeaknesses: [],
      difficulty: "basic",
    });
    const result = normalizeGeneratedTaskContent(raw);
    const complete = await supabaseAdmin("rpc/complete_jsos_daily_generation_job", {
      method: "POST",
      body: JSON.stringify({ p_job_id: job.job_id, p_result: result }),
    });
    if (!complete.ok) throw new Error("complete generation job failed");
    return "completed";
  } catch (error) {
    const errorCode = createPlanErrorCode("PLAN");
    const fail = await supabaseAdmin("rpc/fail_jsos_daily_generation_job", {
      method: "POST",
      body: JSON.stringify({
        p_job_id: job.job_id,
        p_error_code: errorCode,
        p_error_message: error instanceof Error ? error.message : "daily generation failed",
      }),
    });
    if (!fail.ok) return "failed";
    const finalFailure = await fail.json() as boolean;
    return finalFailure ? "failed" : "retrying";
  }
}

export const GET = POST;
