import test from "node:test";
import assert from "node:assert/strict";
import { parseSummaryText, SummaryParseError, validateSummary } from "../lib/jsos-domain.ts";

function summary(completed = true) {
  return {
    schemaVersion: "1.0",
    rubricVersion: "1.0",
    task: { taskId: "11111111-1111-4111-8111-111111111111" },
    session: { completed },
    scores: {
      communication: { score: 4 },
      fluency: { score: 3 },
      pronunciation: { score: null },
    },
  };
}

test("accepts a completed summary with the three fixed scores", () => {
  assert.equal(validateSummary(summary()).ok, true);
});

test("does not complete a task when the session is unfinished", () => {
  const result = validateSummary(summary(false));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /session\.completed/);
});

test("rejects a score outside the 1–5 rubric", () => {
  const value = summary();
  value.scores.fluency.score = 6;
  const result = validateSummary(value);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /fluency/);
});

test("repairs structural smart quotes only after standard JSON parsing fails", () => {
  const parsed = parseSummaryText("```json\n{“schemaVersion”:“1.0”,“rubricVersion”:“1.0”,“task”:{“taskId”:“11111111-1111-4111-8111-111111111111”,“difficulty”:null},“session”:{“completed”:true},“scores”:{“communication”:{“score”:2},“fluency”:{“score”:2},“pronunciation”:{“score”:null}},“sentences”:[{“userSentence”:“古い文”,“recommendedSentence”:“自然な文”}]}\n```");
  const result = validateSummary(parsed);
  assert.equal(result.ok, true);
  assert.equal(result.data.task.difficulty, "basic");
  assert.equal(result.data.sentences[0].original, "古い文");
  assert.equal(result.data.sentences[0].corrected, "自然な文");
});

test("preserves smart quotes inside a valid JSON string", () => {
  const parsed = parseSummaryText('{"schemaVersion":"1.0","summaryZh":"用户说“今天开始使用”后继续训练"}');
  assert.equal(parsed.summaryZh, "用户说“今天开始使用”后继续训练");
});

test("repairs mixed structural smart quotes without changing valid string content", () => {
  const parsed = parseSummaryText('{“schemaVersion”:"1.0",“summaryZh”:"引用“今天开始使用”作为原话"}');
  assert.equal(parsed.summaryZh, "引用“今天开始使用”作为原话");
});

test("reports a stable error code and location while leaving invalid input untouched", () => {
  const input = '{\n  "summaryZh": "未结束"';
  assert.throws(() => parseSummaryText(input), (error) => {
    assert.equal(error instanceof SummaryParseError, true);
    assert.match(error.message, /位置：第 \d+ 行第 \d+ 列/);
    assert.match(error.errorCode, /^JSOS-JSON-[0-9A-F]{8}$/);
    assert.equal(input, '{\n  "summaryZh": "未结束"');
    return true;
  });
});
