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

type JsonRecord = Record<string, unknown>;

export class SummaryParseError extends SyntaxError {
  readonly errorCode: string;

  constructor(input: string, error: unknown) {
    const location = jsonErrorLocation(input, error);
    const errorCode = `JSOS-JSON-${stableTextHash(input)}`;
    super(`JSON 解析失败${location ? `，位置：${location}` : ""}。错误编号：${errorCode}`);
    this.name = "SummaryParseError";
    this.errorCode = errorCode;
  }
}

function stableTextHash(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function jsonErrorLocation(input: string, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const existing = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (existing) return `第 ${existing[1]} 行第 ${existing[2]} 列`;
  const position = message.match(/position\s+(\d+)/i);
  if (!position) return "";
  const offset = Math.min(Number(position[1]), input.length);
  const lines = input.slice(0, offset).split("\n");
  return `第 ${lines.length} 行第 ${(lines.at(-1)?.length ?? 0) + 1} 列`;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function normalizeSummaryInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const root = { ...(input as JsonRecord) };
  const task = record(root.task);
  const words = Array.isArray(root.newWords) ? root.newWords : [];
  const sentences = Array.isArray(root.sentences) ? root.sentences : [];

  root.task = { ...task, difficulty: text(task.difficulty, "basic") || "basic" };
  root.newWords = words.map((item) => {
    const word = record(item);
    return {
      ...word,
      word: text(word.word),
      reading: text(word.reading),
      meaningZh: text(word.meaningZh),
      exampleJa: text(word.exampleJa),
      exampleZh: text(word.exampleZh),
      source: text(word.source, `Day ${typeof task.dayNumber === "number" ? task.dayNumber : ""} ${text(task.topic)}`.trim()),
      priority: text(word.priority, "medium") || "medium",
    };
  });
  root.sentences = sentences.map((item) => {
    const sentence = record(item);
    return {
      ...sentence,
      original: text(sentence.original, text(sentence.userSentence)),
      corrected: text(sentence.corrected, text(sentence.recommendedSentence)),
      isApproximate: typeof sentence.isApproximate === "boolean" ? sentence.isApproximate : false,
      meaningZh: text(sentence.meaningZh),
      category: text(sentence.category, "expression") || "expression",
      explanationZh: text(sentence.explanationZh),
      selfCorrected: typeof sentence.selfCorrected === "boolean" ? sentence.selfCorrected : false,
      repeatCount: typeof sentence.repeatCount === "number" ? sentence.repeatCount : 1,
      priority: text(sentence.priority, "medium") || "medium",
    };
  });
  return root;
}

export function parseSummaryText(input: string): unknown {
  const withoutFence = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return normalizeSummaryInput(JSON.parse(withoutFence));
  } catch (originalError) {
    const repaired = repairStructuralSmartQuotes(withoutFence);
    if (repaired === withoutFence) throw new SummaryParseError(withoutFence, originalError);
    try {
      return normalizeSummaryInput(JSON.parse(repaired));
    } catch (repairError) {
      throw new SummaryParseError(withoutFence, repairError);
    }
  }
}

function repairStructuralSmartQuotes(input: string) {
  let result = "";
  let inAsciiString = false;
  let inSmartString = false;
  let escaped = false;

  function previousNonWhitespace() {
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (!/\s/.test(result[index])) return result[index];
    }
    return "";
  }

  function nextNonWhitespace(start: number) {
    for (let index = start; index < input.length; index += 1) {
      if (!/\s/.test(input[index])) return input[index];
    }
    return "";
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inAsciiString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inAsciiString = false;
      continue;
    }

    if (inSmartString) {
      if (character === "”" && [":", ",", "}", "]", ""].includes(nextNonWhitespace(index + 1))) {
        result += '"';
        inSmartString = false;
      } else {
        result += character;
      }
      continue;
    }

    if (character === '"') {
      inAsciiString = true;
      result += character;
    } else if (character === "“" && ["", "{", "[", ",", ":"].includes(previousNonWhitespace())) {
      inSmartString = true;
      result += '"';
    } else {
      result += character;
    }
  }

  return result;
}

export function validateSummary(input: unknown): { ok: true; data: JsosSummary } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const normalized = normalizeSummaryInput(input);
  if (!normalized || typeof normalized !== "object") return { ok: false, errors: ["总结不是 JSON 对象"] };
  const value = normalized as Partial<JsosSummary>;
  if (value.schemaVersion !== "1.0") errors.push("schemaVersion 必须为 1.0");
  if (value.rubricVersion !== "1.0") errors.push("rubricVersion 必须为 1.0");
  if (!value.task?.taskId) errors.push("缺少 taskId");
  if (value.session?.completed !== true) errors.push("session.completed 必须为 true");
  for (const key of SCORE_KEYS) {
    const score = value.scores?.[key]?.score;
    if (score !== null && (typeof score !== "number" || score < 1 || score > 5)) errors.push(`${key} 评分必须为 1–5 或 null`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, data: value as JsosSummary };
}

export function shouldReinforce(summary: JsosSummary) {
  return SCORE_KEYS.some((key) => (summary.scores[key].score ?? 5) <= 2) || !summary.session.coreGoalAchieved || summary.recommendation.needsReinforcement;
}
