import { getServerConfig } from "./server-config.ts";

export type TaskGenerationInput = {
  taskId: string;
  dayNumber: number;
  topic: string;
  taskType: string;
  learningGoal: string;
  previousWeaknesses: string[];
  difficulty: string;
};

export type TopicGenerationInput = {
  learningGoal: string;
  dayCount: number;
};

export interface AiProvider {
  generateTopics(input: TopicGenerationInput): Promise<string[]>;
  generateTask(input: TaskGenerationInput): Promise<Record<string, unknown>>;
  repairSummary(raw: string): Promise<Record<string, unknown>>;
}

export class SetupRequiredProvider implements AiProvider {
  async generateTopics(): Promise<string[]> { throw new Error("AI 服务尚未配置"); }
  async generateTask(): Promise<Record<string, unknown>> { throw new Error("AI 服务尚未配置"); }
  async repairSummary(): Promise<Record<string, unknown>> { throw new Error("AI 服务尚未配置"); }
}

type FetchLike = typeof fetch;

export class GeminiServiceProvider implements AiProvider {
  private readonly endpoint: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    serviceUrl: string,
    serviceToken: string,
    fetchImpl: FetchLike = fetch,
  ) {
    this.endpoint = `${serviceUrl.replace(/\/+$/, "")}/v1/generate`;
    this.serviceToken = serviceToken;
    this.fetchImpl = fetchImpl;
  }

  async generateTopics(input: TopicGenerationInput): Promise<string[]> {
    const result = await this.request("topics", input);
    if (!Array.isArray(result)) throw new Error("Gemini 主题响应结构不正确");
    return result as string[];
  }

  async generateTask(input: TaskGenerationInput): Promise<Record<string, unknown>> {
    const result = await this.request("task", input);
    if (!isRecord(result)) throw new Error("Gemini 每日任务响应结构不正确");
    return result;
  }

  async repairSummary(raw: string): Promise<Record<string, unknown>> {
    const result = await this.request("repair_summary", { raw });
    if (!isRecord(result)) throw new Error("Gemini 修复响应结构不正确");
    return result;
  }

  private async request(operation: string, input: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 65_000);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-jsos-service-token": this.serviceToken,
        },
        body: JSON.stringify({ operation, input }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; result?: unknown; error?: string } | null;
      if (!response.ok || !payload?.ok) throw new Error(readServiceError(response.status, payload?.error));
      return payload.result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("Gemini 服务响应超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getAiProvider(): AiProvider {
  const config = getServerConfig();
  if (config.geminiServiceUrl && config.geminiServiceToken) {
    return new GeminiServiceProvider(config.geminiServiceUrl, config.geminiServiceToken);
  }
  return new SetupRequiredProvider();
}

function readServiceError(status: number, error?: string) {
  if (status === 401) return "Gemini 服务鉴权失败";
  if (status === 413) return "Gemini 服务请求内容过大";
  if (status === 422 && error) return error;
  return "Gemini 服务生成失败";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
