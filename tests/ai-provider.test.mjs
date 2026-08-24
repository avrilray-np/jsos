import assert from "node:assert/strict";
import test from "node:test";
import { GeminiServiceProvider } from "../lib/ai-provider.ts";

test("Gemini service provider sends server-only authentication", async () => {
  let observed;
  const provider = new GeminiServiceProvider("https://gemini.example.test/", "private-token", async (url, init) => {
    observed = { url, init };
    return Response.json({ ok: true, result: ["校园报到", "便利店打工"] });
  });
  const result = await provider.generateTopics({ learningGoal: "赴日留学", dayCount: 2 });
  assert.deepEqual(result, ["校园报到", "便利店打工"]);
  assert.equal(observed.url, "https://gemini.example.test/v1/generate");
  assert.equal(observed.init.headers["x-jsos-service-token"], "private-token");
  assert.deepEqual(JSON.parse(observed.init.body), {
    operation: "topics",
    input: { learningGoal: "赴日留学", dayCount: 2 },
  });
});

test("Gemini service provider hides upstream errors", async () => {
  const provider = new GeminiServiceProvider("https://gemini.example.test", "private-token", async () => (
    Response.json({ ok: false, error: "internal detail" }, { status: 502 })
  ));
  await assert.rejects(() => provider.generateTopics({ learningGoal: "赴日留学", dayCount: 2 }), /生成失败/);
  await assert.rejects(
    () => new GeminiServiceProvider("https://gemini.example.test", "wrong", async () => Response.json({ ok: false }, { status: 401 }))
      .generateTopics({ learningGoal: "赴日留学", dayCount: 2 }),
    /鉴权失败/,
  );
});
