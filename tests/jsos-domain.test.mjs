import test from "node:test";
import assert from "node:assert/strict";
import { validateSummary } from "../lib/jsos-domain.ts";

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
