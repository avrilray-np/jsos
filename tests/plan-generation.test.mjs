import assert from "node:assert/strict";
import test from "node:test";
import { getBeijingCalendarDate, normalizeGeneratedTaskContent, normalizeGeneratedTopics, validatePlanDraftInput } from "../lib/plan-generation.ts";

test("validates a custom plan goal and day count", () => {
  assert.deepEqual(validatePlanDraftInput(" 赴日留学和日常打工 ", 30), {
    ok: true,
    learningGoal: "赴日留学和日常打工",
    dayCount: 30,
  });
  assert.equal(validatePlanDraftInput("", 30).ok, false);
  assert.equal(validatePlanDraftInput("赴日留学", 91).ok, false);
});

test("requires exactly one non-empty topic for every day", () => {
  assert.deepEqual(normalizeGeneratedTopics([" 校园报到 ", "便利店打工"], 2), ["校园报到", "便利店打工"]);
  assert.throws(() => normalizeGeneratedTopics(["只有一天"], 2), /数量/);
  assert.throws(() => normalizeGeneratedTopics(["第一天", "   "], 2), /Day 2/);
});

test("uses the natural Beijing date before the 01:00 training boundary", () => {
  assert.equal(getBeijingCalendarDate(new Date("2026-08-23T16:30:00.000Z")), "2026-08-24");
});

test("accepts only complete daily task content", () => {
  const content = normalizeGeneratedTaskContent({
    scenes: [1, 2, 3].map((number) => ({ title: `场景 ${number}`, roles: ["用户", "店员"], goals: ["说明需求"] })),
    targetPatterns: ["～たいです", "～てもいいですか", "～をお願いします"],
    basePrompt: "根据三个场景进行日语角色扮演。",
    warmup: Array.from({ length: 10 }, (_, index) => ({ promptZh: `预热 ${index + 1}`, answerJa: `練習 ${index + 1}` })),
  });
  assert.equal(content.scenes.length, 3);
  assert.equal(content.warmup.length, 10);
  assert.throws(() => normalizeGeneratedTaskContent({ ...content, warmup: content.warmup.slice(0, 9) }), /10 条/);
});
