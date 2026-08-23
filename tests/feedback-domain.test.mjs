import assert from "node:assert/strict";
import test from "node:test";
import { feedbackErrorMessage, validateFeedbackBody } from "../lib/feedback-domain.ts";

test("accepts trimmed feedback up to 500 characters", () => {
  assert.deepEqual(validateFeedbackBody("  页面按钮没有反应  "), { ok: true, body: "页面按钮没有反应" });
  assert.equal(validateFeedbackBody("好".repeat(500)).ok, true);
});

test("rejects empty or overlong feedback", () => {
  assert.equal(validateFeedbackBody("   ").ok, false);
  assert.equal(validateFeedbackBody("好".repeat(501)).ok, false);
});

test("shows a clear daily submission limit message", () => {
  assert.match(feedbackErrorMessage("daily feedback limit reached"), /10 次/);
});
