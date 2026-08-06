import assert from "node:assert/strict";
import test from "node:test";
import { getWarmupSet, warmupStableKeys } from "../lib/warmup-content.ts";

test("provides ten convenience-store warmup prompts without exposing them to Live", () => {
  const warmup = getWarmupSet("life_convenience_supermarket");
  assert.ok(warmup);
  assert.equal(warmup.items.length, 10);
  assert.match(warmup.items.at(-1).answerJa, /値段/);
  assert.deepEqual(warmup.items.at(-1).answerParts.find((part) => part.text === "値段"), { text: "値段", reading: "ねだん" });
});

test("provides ten prompts for all forty curriculum themes", () => {
  assert.equal(warmupStableKeys.length, 40);
  for (const stableKey of warmupStableKeys) {
    const warmup = getWarmupSet(stableKey);
    assert.ok(warmup, stableKey);
    assert.equal(warmup.items.length, 10, stableKey);
    for (const item of warmup.items) {
      assert.ok(item.promptZh);
      assert.ok(item.answerJa);
      assert.equal(item.answerJa, item.answerParts.map((part) => part.text).join(""));
    }
  }
});

test("provides dining warmup content for the next session", () => {
  const warmup = getWarmupSet("life_dining");
  assert.ok(warmup);
  assert.equal(warmup.title, "外食");
  assert.equal(warmup.items.length, 10);
  assert.match(warmup.items[0].answerJa, /おすすめ/);
});
