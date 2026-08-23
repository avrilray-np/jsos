import assert from "node:assert/strict";
import test from "node:test";
import { getJsosTrainingDate, getPreviousTrainingDate, millisecondsUntilNextTrainingDay } from "../lib/training-day.ts";

test("keeps the previous training date before 01:00 Beijing time", () => {
  assert.equal(getJsosTrainingDate(new Date("2026-08-10T16:59:59.000Z")), "2026-08-10");
});

test("changes the training date at 01:00 Beijing time", () => {
  assert.equal(getJsosTrainingDate(new Date("2026-08-10T17:00:00.000Z")), "2026-08-11");
});

test("schedules the next refresh at the following 01:00 boundary", () => {
  assert.equal(millisecondsUntilNextTrainingDay(new Date("2026-08-10T16:30:00.000Z"), 0), 30 * 60 * 1000);
  assert.equal(millisecondsUntilNextTrainingDay(new Date("2026-08-10T17:30:00.000Z"), 0), 23.5 * 60 * 60 * 1000);
});

test("finds the previous date relative to a historical task", () => {
  assert.equal(getPreviousTrainingDate("2026-08-08"), "2026-08-07");
  assert.equal(getPreviousTrainingDate("2026-03-01"), "2026-02-28");
});
