import { getServerConfig } from "./server-config";

export type TaskGenerationInput = {
  taskId: string;
  dayNumber: number;
  topic: string;
  taskType: string;
  previousWeaknesses: string[];
  difficulty: string;
};

export interface AiProvider {
  generateTask(input: TaskGenerationInput): Promise<Record<string, unknown>>;
  repairSummary(raw: string): Promise<Record<string, unknown>>;
}

export class SetupRequiredProvider implements AiProvider {
  async generateTask() { throw new Error("AI 服务尚未配置"); }
  async repairSummary() { throw new Error("AI 服务尚未配置"); }
}

export function getAiProvider(): AiProvider {
  // The provider boundary is intentionally stable. OpenAI is connected only
  // after a server-side key is configured; another region-supported provider
  // can implement the same interface without changing scheduling logic.
  return getServerConfig().openAiApiKey ? new SetupRequiredProvider() : new SetupRequiredProvider();
}
