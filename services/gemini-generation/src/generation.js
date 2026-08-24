const TOPIC_MAX_LENGTH = 120;

export function buildGenerationRequest(operation, input) {
  if (operation === "topics") return buildTopicsRequest(input);
  if (operation === "task") return buildTaskRequest(input);
  if (operation === "repair_summary") return buildRepairRequest(input);
  throw new RequestError("不支持的生成操作", 422);
}

export function extractJsonResult(response) {
  const text = typeof response?.text === "string" ? response.text.trim() : "";
  if (!text) throw new Error("Gemini 没有返回内容");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Gemini 返回了无法解析的 JSON");
  }
}

export function timingSafeTokenEqual(actual, expected) {
  if (!actual || !expected) return false;
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  if (actualBytes.byteLength !== expectedBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actualBytes.byteLength; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function buildTopicsRequest(input) {
  const learningGoal = readText(input?.learningGoal, "学习目的", 1, 1000);
  const dayCount = readInteger(input?.dayCount, "训练天数", 1, 90);
  return {
    prompt: [
      `学习目的：${learningGoal}`,
      `训练天数：${dayCount} 天`,
      "请设计连续、渐进且互不重复的日语口语训练主题。",
      "每一天只输出一个简洁的中文主题名称，主题要能直接发展成真实对话场景。",
      "前期覆盖高频基础交流，中后期逐步增加说明、确认、协商、纠错和处理意外的难度。",
      `必须恰好输出 ${dayCount} 个主题，顺序对应 Day 1 到最后一天。`,
    ].join("\n"),
    temperature: 0.7,
    maxOutputTokens: Math.min(8192, Math.max(1024, dayCount * 45)),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["topics"],
      properties: {
        topics: {
          type: "array",
          minItems: dayCount,
          maxItems: dayCount,
          items: { type: "string", minLength: 1, maxLength: TOPIC_MAX_LENGTH },
        },
      },
    },
    unwrap(result) {
      return result?.topics;
    },
  };
}

function buildTaskRequest(input) {
  const taskId = readText(input?.taskId, "任务 ID", 1, 200);
  const dayNumber = readInteger(input?.dayNumber, "Day", 1, 365);
  const topic = readText(input?.topic, "主题", 1, TOPIC_MAX_LENGTH);
  const taskType = readText(input?.taskType, "任务类型", 1, 40);
  const learningGoal = readText(input?.learningGoal, "学习目的", 1, 1000);
  const difficulty = readText(input?.difficulty, "难度", 1, 40);
  const previousWeaknesses = readStringArray(input?.previousWeaknesses, 0, 20, 300);
  const weaknessText = previousWeaknesses.length ? previousWeaknesses.join("；") : "无";

  return {
    prompt: [
      `taskId：${taskId}`,
      `Day：${dayNumber}`,
      `主题：${topic}`,
      `任务类型：${taskType}`,
      `难度：${difficulty}`,
      `用户学习目的：${learningGoal}`,
      `需要关注的历史薄弱项：${weaknessText}`,
      "请生成当天完整日语口语训练任务。",
      "三个场景必须是真实可连续多轮训练的使用情境，并形成难度递进；每个场景列出参与角色和具体沟通目标。",
      "目标表达只作为训练参考，使用自然日语，选择 3～5 条能覆盖核心沟通功能的表达。",
      "basePrompt 是用户可以直接复制给 GPT-Live 的完整训练提示，必须带上 taskId、Day、主题、任务类型、难度、三个场景和目标表达，并要求根据用户现场表现调整语速、表达难度和提示量。",
      "warmup 必须恰好 10 条；promptZh 是对话前的中文提问或表达任务，answerJa 是简洁自然的日语参考答案。",
      "不要写入具体用户等级或未经提供的个人背景。",
    ].join("\n"),
    temperature: 0.55,
    maxOutputTokens: 8192,
    schema: taskSchema,
    unwrap(result) {
      return result;
    },
  };
}

function buildRepairRequest(input) {
  const raw = readText(input?.raw, "待修复总结", 1, 50_000);
  return {
    prompt: [
      "请把下面内容谨慎修复为一个合法 JSON 对象。",
      "只修复 JSON 结构问题，不改写、补充或推断正文内容。",
      "正文引用统一使用「」，JSON 结构引号必须使用 ASCII 半角双引号。",
      "如果无法可靠修复，返回包含 error 字段的 JSON 对象并简述原因。",
      "待修复内容：",
      raw,
    ].join("\n"),
    temperature: 0,
    maxOutputTokens: 8192,
    schema: { type: "object" },
    unwrap(result) {
      return result;
    },
  };
}

const taskSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scenes", "targetPatterns", "basePrompt", "warmup"],
  properties: {
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "roles", "goals"],
        properties: {
          key: { type: "string", minLength: 1, maxLength: 80 },
          title: { type: "string", minLength: 1, maxLength: 120 },
          roles: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 100 } },
          goals: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 300 } },
        },
      },
    },
    targetPatterns: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    basePrompt: { type: "string", minLength: 1, maxLength: 8000 },
    warmup: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["promptZh", "answerJa"],
        properties: {
          promptZh: { type: "string", minLength: 1, maxLength: 300 },
          answerJa: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

function readText(value, label, min, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) throw new RequestError(`${label}不正确`, 422);
  return text;
}

function readInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new RequestError(`${label}不正确`, 422);
  return number;
}

function readStringArray(value, min, max, itemMax) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new RequestError("历史薄弱项不正确", 422);
  return value.map((item) => readText(item, "历史薄弱项", 1, itemMax));
}

export class RequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
