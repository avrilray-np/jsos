import { getAiProvider } from "../../../lib/ai-provider";
import { getRequestSession, type JsosSession } from "../../../lib/auth-session";
import {
  createPlanErrorCode,
  getBeijingCalendarDate,
  normalizeGeneratedTopics,
  validatePlanDraftInput,
} from "../../../lib/plan-generation";
import { isCloudConfigured } from "../../../lib/server-config";
import { supabaseUser } from "../../../lib/supabase-rest";

type DraftStatus = "generating_topics" | "topics_ready" | "topics_confirmed" | "active" | "generation_failed" | "discarded";
type DraftRow = {
  id: string;
  learning_goal: string;
  day_count: number;
  status: DraftStatus;
  topic_attempt_count: number;
  topic_generation_started_at: string;
  error_code: string | null;
  confirmed_at: string | null;
  created_at: string;
};
type TopicRow = { day_number: number; topic: string | null; status: "pending" | "generating" | "completed" | "failed"; error_code: string | null };

const OPEN_DRAFT_STATUSES = new Set<DraftStatus>(["generating_topics", "topics_ready", "topics_confirmed", "generation_failed"]);

export async function GET(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
  const draft = await readOpenDraft(session);
  return Response.json({ ok: true, draft });
}

export async function POST(request: Request) {
  if (!isCloudConfigured()) return Response.json({ ok: false, code: "SETUP_REQUIRED" }, { status: 503 });
  const session = await getRequestSession(request);
  if (!session) return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  try {
    if (action === "generate") {
      const input = validatePlanDraftInput(body?.learningGoal, body?.dayCount);
      if (!input.ok) return Response.json({ ok: false, message: input.message }, { status: 422 });
      await callRpc<string>(session, "create_jsos_plan_draft", {
        p_learning_goal: input.learningGoal,
        p_day_count: input.dayCount,
      });
      return Response.json({ ok: true, draft: await readOpenDraft(session) });
    }

    if (action === "retry") {
      const draftId = readUuid(body?.draftId);
      if (!draftId) return Response.json({ ok: false, message: "计划草稿不正确" }, { status: 422 });
      await callRpc<number>(session, "retry_jsos_plan_topics", { p_draft_id: draftId });
      return Response.json({ ok: true, draft: await readOpenDraft(session) });
    }

    if (action === "run_topics") {
      const draftId = readUuid(body?.draftId);
      if (!draftId) return Response.json({ ok: false, message: "计划草稿不正确" }, { status: 422 });
      const claimed = await callRpc<boolean>(session, "claim_jsos_topic_generation", { p_draft_id: draftId });
      if (claimed) {
        const draft = await readDraft(session, draftId);
        if (draft) await generateTopics(session, draftId, draft.learning_goal, draft.day_count);
      }
      return Response.json({ ok: true, draft: await readOpenDraft(session) });
    }

    if (action === "update_topic") {
      const draftId = readUuid(body?.draftId);
      const dayNumber = Number(body?.dayNumber);
      const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
      if (!draftId || !Number.isInteger(dayNumber) || dayNumber < 1 || !topic || topic.length > 120) {
        return Response.json({ ok: false, message: "主题内容不正确" }, { status: 422 });
      }
      await callRpc<void>(session, "update_jsos_plan_topic", {
        p_draft_id: draftId,
        p_day_number: dayNumber,
        p_topic: topic,
      });
      return Response.json({ ok: true, draft: await readOpenDraft(session), message: "主题已修改" });
    }

    if (action === "confirm") {
      const draftId = readUuid(body?.draftId);
      if (!draftId) return Response.json({ ok: false, message: "计划草稿不正确" }, { status: 422 });
      await callRpc<void>(session, "confirm_jsos_plan_topics", { p_draft_id: draftId });
      return Response.json({ ok: true, draft: await readOpenDraft(session) });
    }

    if (action === "activate") {
      const draftId = readUuid(body?.draftId);
      const kind = body?.kind;
      const startsOn = typeof body?.startsOn === "string" ? body.startsOn : "";
      if (!draftId || (kind !== "trial" && kind !== "official")) {
        return Response.json({ ok: false, message: "计划设置不正确" }, { status: 422 });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || startsOn < getBeijingCalendarDate()) {
        return Response.json({ ok: false, message: "Day 1 日期只能选择今天或未来日期" }, { status: 422 });
      }
      const planId = await callRpc<string>(session, "activate_jsos_plan_draft", {
        p_draft_id: draftId,
        p_kind: kind,
        p_starts_on: startsOn,
      });
      return Response.json({ ok: true, planId, message: "训练计划已创建" });
    }

    return Response.json({ ok: false, message: "不支持的操作" }, { status: 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败，请稍后重试";
    if (message === "unauthorized") return Response.json({ ok: false, message: "请重新登录" }, { status: 401 });
    return Response.json({ ok: false, message: friendlyMessage(message) }, { status: 502 });
  }
}

async function generateTopics(session: JsosSession, draftId: string, learningGoal: string, dayCount: number) {
  try {
    const result = await withTimeout(getAiProvider().generateTopics({ learningGoal, dayCount }), 55_000);
    const topics = normalizeGeneratedTopics(result, dayCount);
    await callRpc<void>(session, "complete_jsos_plan_topics", { p_draft_id: draftId, p_topics: topics });
  } catch (error) {
    const errorCode = createPlanErrorCode("TOPIC");
    const message = error instanceof Error ? error.message : "topic generation failed";
    await callRpc<void>(session, "fail_jsos_plan_topics", {
      p_draft_id: draftId,
      p_error_code: errorCode,
      p_error_message: message,
    }).catch(() => null);
  }
}

async function readOpenDraft(session: JsosSession) {
  const response = await supabaseUser(
    "plan_drafts?select=id,learning_goal,day_count,status,topic_attempt_count,topic_generation_started_at,error_code,confirmed_at,created_at&order=created_at.desc&limit=10",
    session.accessToken,
  );
  if (!response.ok) throw new Error("读取计划草稿失败");
  const rows = await response.json() as DraftRow[];
  const draft = rows.find((item) => OPEN_DRAFT_STATUSES.has(item.status));
  if (!draft) return null;
  const topicsResponse = await supabaseUser(
    `plan_topics?select=day_number,topic,status,error_code&draft_id=eq.${encodeURIComponent(draft.id)}&order=day_number.asc`,
    session.accessToken,
  );
  if (!topicsResponse.ok) throw new Error("读取计划主题失败");
  return { ...draft, topics: await topicsResponse.json() as TopicRow[] };
}

async function readDraft(session: JsosSession, draftId: string) {
  const response = await supabaseUser(
    `plan_drafts?select=id,learning_goal,day_count,status,topic_attempt_count,topic_generation_started_at,error_code,confirmed_at,created_at&id=eq.${encodeURIComponent(draftId)}&limit=1`,
    session.accessToken,
  );
  if (!response.ok) throw new Error("读取计划草稿失败");
  const [draft] = await response.json() as DraftRow[];
  return draft ?? null;
}

async function callRpc<T>(session: JsosSession, name: string, body: Record<string, unknown>) {
  const response = await supabaseUser(`rpc/${name}`, session.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? `${name} failed`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function readUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : "";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("topic generation timeout")), timeoutMs)),
  ]);
}

function friendlyMessage(message: string) {
  if (message.includes("draft cannot retry")) return "当前计划不能重新生成主题";
  if (message.includes("draft not ready") || message.includes("topics incomplete")) return "主题尚未全部生成";
  if (message.includes("draft not confirmed")) return "请先确认全部主题";
  if (message.includes("starts_on cannot")) return "Day 1 日期只能选择今天或未来日期";
  if (message.includes("topic cannot update")) return "当前主题不能修改";
  return "操作失败，请稍后重试";
}
