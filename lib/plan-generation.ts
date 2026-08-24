export const PLAN_GOAL_MAX_LENGTH = 1000;
export const PLAN_DAY_MIN = 1;
export const PLAN_DAY_MAX = 90;

export function validatePlanDraftInput(learningGoal: unknown, dayCount: unknown) {
  const goal = typeof learningGoal === "string" ? learningGoal.trim() : "";
  const days = typeof dayCount === "number" ? dayCount : Number(dayCount);
  if (!goal) return { ok: false as const, message: "请填写学习目的" };
  if (goal.length > PLAN_GOAL_MAX_LENGTH) return { ok: false as const, message: "学习目的最多 1000 字" };
  if (!Number.isInteger(days) || days < PLAN_DAY_MIN || days > PLAN_DAY_MAX) {
    return { ok: false as const, message: "训练天数请输入 1～90 天" };
  }
  return { ok: true as const, learningGoal: goal, dayCount: days };
}

export function normalizeGeneratedTopics(value: unknown, dayCount: number) {
  if (!Array.isArray(value) || value.length !== dayCount) throw new Error("生成的主题数量不正确");
  return value.map((item, index) => {
    const topic = typeof item === "string" ? item.trim() : "";
    if (!topic || topic.length > 120) throw new Error(`Day ${index + 1} 的主题不正确`);
    return topic;
  });
}

export function getBeijingCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function createPlanErrorCode(prefix: "TOPIC" | "PLAN") {
  return `JSOS-${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export function normalizeGeneratedTaskContent(value: unknown) {
  if (!isRecord(value)) throw new Error("每日任务结构不正确");
  const scenes = Array.isArray(value.scenes) ? value.scenes.map((scene, index) => normalizeScene(scene, index)) : [];
  if (scenes.length !== 3) throw new Error("每日任务必须包含 3 个训练场景");
  const targetPatterns = readStringArray(value.targetPatterns, 3, 5, "目标表达");
  const basePrompt = readText(value.basePrompt, "训练提示", 1, 8000);
  const warmup = Array.isArray(value.warmup) ? value.warmup.map((item, index) => normalizeWarmup(item, index)) : [];
  if (warmup.length !== 10) throw new Error("每日任务必须包含 10 条预热内容");
  return { scenes, targetPatterns, basePrompt, warmup };
}

function normalizeScene(value: unknown, index: number) {
  if (!isRecord(value)) throw new Error(`场景 ${index + 1} 的结构不正确`);
  return {
    key: typeof value.key === "string" && value.key.trim() ? value.key.trim().slice(0, 80) : `scene_${index + 1}`,
    title: readText(value.title, `场景 ${index + 1} 标题`, 1, 120),
    roles: readStringArray(value.roles, 1, 6, `场景 ${index + 1} 角色`),
    goals: readStringArray(value.goals, 1, 6, `场景 ${index + 1} 沟通目标`),
  };
}

function normalizeWarmup(value: unknown, index: number) {
  if (!isRecord(value)) throw new Error(`预热 ${index + 1} 的结构不正确`);
  return {
    promptZh: readText(value.promptZh, `预热 ${index + 1} 中文`, 1, 300),
    answerJa: readText(value.answerJa, `预热 ${index + 1} 日语`, 1, 500),
  };
}

function readStringArray(value: unknown, min: number, max: number, label: string) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}数量不正确`);
  return value.map((item) => readText(item, label, 1, 500));
}

function readText(value: unknown, label: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new Error(`${label}不正确`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
