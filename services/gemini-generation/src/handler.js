import { GoogleGenAI } from "@google/genai";
import { buildGenerationRequest, extractJsonResult, RequestError, timingSafeTokenEqual } from "./generation.js";

export function createGeminiHandler(environment = process.env) {
  const project = environment.GOOGLE_CLOUD_PROJECT ?? "";
  const location = environment.GOOGLE_CLOUD_LOCATION ?? "global";
  const model = environment.GEMINI_MODEL ?? "gemini-2.5-flash";
  const serviceToken = environment.JSOS_SERVICE_TOKEN ?? "";
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is required");
  if (!serviceToken) throw new Error("JSOS_SERVICE_TOKEN is required");

  const ai = new GoogleGenAI({ vertexai: true, project, location });
  return async function handle(request, response) {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");

    if (request.method === "GET" && (request.url === "/healthz" || request.url === "/")) {
      return send(response, 200, { ok: true });
    }
    if (request.method !== "POST" || (request.url !== "/v1/generate" && request.url !== "/")) {
      return send(response, 404, { ok: false, error: "not found" });
    }
    if (!timingSafeTokenEqual(request.headers["x-jsos-service-token"], serviceToken)) {
      return send(response, 401, { ok: false, error: "unauthorized" });
    }

    try {
      const startedAt = Date.now();
      const body = request.body && typeof request.body === "object"
        ? request.body
        : await readJson(request, 64 * 1024);
      const generation = buildGenerationRequest(body?.operation, body?.input);
      const geminiResponse = await ai.models.generateContent({
        model,
        contents: generation.prompt,
        config: {
          systemInstruction: "你是 JSOS 日语口语训练课程设计器。严格根据请求生成可直接使用的结构化课程数据，不添加 JSON 之外的说明。",
          temperature: generation.temperature,
          maxOutputTokens: generation.maxOutputTokens,
          responseMimeType: "application/json",
          responseJsonSchema: generation.schema,
        },
      });
      const parsed = extractJsonResult(geminiResponse);
      const usage = geminiResponse.usageMetadata ?? {};
      console.log(JSON.stringify({
        severity: "INFO",
        message: "generation completed",
        operation: body.operation,
        model,
        latencyMs: Date.now() - startedAt,
        promptTokenCount: usage.promptTokenCount ?? null,
        candidatesTokenCount: usage.candidatesTokenCount ?? null,
        thoughtsTokenCount: usage.thoughtsTokenCount ?? null,
        totalTokenCount: usage.totalTokenCount ?? null,
      }));
      return send(response, 200, { ok: true, result: generation.unwrap(parsed) });
    } catch (error) {
      const status = error instanceof RequestError ? error.status : 502;
      const message = error instanceof Error ? error.message : "generation failed";
      console.error(JSON.stringify({ severity: "ERROR", message, operation: "generate" }));
      return send(response, status, { ok: false, error: status === 502 ? "generation failed" : message });
    }
  };
}

function send(response, status, payload) {
  response.statusCode = status;
  response.end(JSON.stringify(payload));
}

async function readJson(request, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new RequestError("请求内容过大", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestError("请求 JSON 不正确", 400);
  }
}
