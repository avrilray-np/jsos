export const SCORE_KEYS = ["communication", "fluency", "pronunciation"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export type TaskStatus = "draft" | "scheduled" | "active" | "completed" | "deferred" | "generation_failed";
export type TaskType = "core" | "reinforcement" | "review" | "assessment" | "comprehensive";

export type ScoreResult = {
  score: number | null;
  confidence: "high" | "medium" | "low" | "insufficient" | "not_applicable";
  evidence: string[];
};

export type JsosSummary = {
  schemaVersion: "1.0";
  rubricVersion: "1.0";
  task: { taskId: string; dayNumber: number; topic: string; taskType: TaskType; difficulty: string; attemptNumber: number };
  session: { completed: boolean; coreGoalAchieved: boolean; durationMinutes: number | null; durationSource: "user_provided" | "chatgpt_estimate" | "unknown"; usedJapaneseMostly: boolean; coachHintCount: number; communicationBreakdownCount: number };
  scores: Record<ScoreKey, ScoreResult>;
  errorCounts: Record<string, number>;
  newWords: Array<{ word: string; reading: string; meaningZh: string; exampleJa: string; exampleZh: string; source: string; priority: "high" | "medium" | "low" }>;
  sentences: Array<{ original: string; isApproximate: boolean; corrected: string; meaningZh: string; category: string; explanationZh: string; selfCorrected: boolean; repeatCount: number; priority: "high" | "medium" | "low" }>;
  strengths: string[];
  weaknesses: string[];
  nextFocus: string[];
  recommendation: { needsReinforcement: boolean; reasonCodes: string[]; reasonZh: string; suggestedTopic: string | null; suggestedDifficulty: string | null; suggestedFocus: string[] };
  summaryZh: string;
};

export function validateSummary(input: unknown): { ok: true; data: JsosSummary } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return { ok: false, errors: ["总结不是 JSON 对象"] };
  const value = input as Partial<JsosSummary>;
  if (value.schemaVersion !== "1.0") errors.push("schemaVersion 必须为 1.0");
  if (value.rubricVersion !== "1.0") errors.push("rubricVersion 必须为 1.0");
  if (!value.task?.taskId) errors.push("缺少 taskId");
  for (const key of SCORE_KEYS) {
    const score = value.scores?.[key]?.score;
    if (score !== null && (typeof score !== "number" || score < 1 || score > 5)) errors.push(`${key} 评分必须为 1–5 或 null`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: value as JsosSummary };
}

export function shouldReinforce(summary: JsosSummary) {
  return SCORE_KEYS.some((key) => (summary.scores[key].score ?? 5) <= 2) || !summary.session.coreGoalAchieved || summary.recommendation.needsReinforcement;
}
