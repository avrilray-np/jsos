import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationRequest, extractJsonResult, timingSafeTokenEqual } from "../src/generation.js";

test("builds an exact-length topic schema", () => {
  const request = buildGenerationRequest("topics", { learningGoal: "赴日留学", dayCount: 30 });
  assert.equal(request.schema.properties.topics.minItems, 30);
  assert.equal(request.schema.properties.topics.maxItems, 30);
  assert.deepEqual(request.unwrap({ topics: ["校园报到"] }), ["校园报到"]);
});

test("builds the complete daily task schema", () => {
  const request = buildGenerationRequest("task", {
    taskId: "task-1",
    dayNumber: 1,
    topic: "校园报到",
    taskType: "core",
    learningGoal: "赴日留学",
    previousWeaknesses: [],
    difficulty: "basic",
  });
  assert.equal(request.schema.properties.scenes.minItems, 3);
  assert.equal(request.schema.properties.targetPatterns.minItems, 3);
  assert.equal(request.schema.properties.warmup.minItems, 10);
  assert.match(request.prompt, /task-1/);
});

test("rejects invalid requests before calling Gemini", () => {
  assert.throws(() => buildGenerationRequest("topics", { learningGoal: "", dayCount: 30 }), /学习目的/);
  assert.throws(() => buildGenerationRequest("unknown", {}), /不支持/);
});

test("parses JSON responses and compares service tokens", () => {
  assert.deepEqual(extractJsonResult({ text: '{"topics":["校园报到"]}' }), { topics: ["校园报到"] });
  assert.equal(timingSafeTokenEqual("secret", "secret"), true);
  assert.equal(timingSafeTokenEqual("secret", "other"), false);
  assert.equal(timingSafeTokenEqual("", ""), false);
});
