import assert from "node:assert/strict";
import test from "node:test";
import type { PublishRecord } from "../src/types.js";
import { checkRateLimits } from "../src/naver/publish.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";

const settings = { ...DEFAULT_SETTINGS, dailyLimit: 2, minIntervalMinutes: 30 };
const NOW = new Date("2026-09-08T12:00:00.000Z");

function published(at: string, id = at): PublishRecord {
  return { id, postId: id, title: "t", keyword: "k", url: `https://blog.naver.com/x/${id}`, mode: "auto", at };
}

function draft(at: string, id = at): PublishRecord {
  return { id, postId: id, title: "t", keyword: "k", url: null, mode: "draft", at };
}

test("allows publishing when nothing has been published", () => {
  assert.equal(checkRateLimits(settings, NOW, []).ok, true);
});

test("blocks once the daily limit is reached", () => {
  const gate = checkRateLimits(settings, NOW, [
    published("2026-09-08T01:00:00.000Z"),
    published("2026-09-08T02:00:00.000Z"),
  ]);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /한도/);
});

test("yesterday's publishes do not count toward today", () => {
  const gate = checkRateLimits(settings, NOW, [
    published("2026-09-07T01:00:00.000Z"),
    published("2026-09-07T02:00:00.000Z"),
  ]);
  assert.equal(gate.ok, true);
});

test("blocks until the minimum interval has passed", () => {
  const gate = checkRateLimits(settings, NOW, [published("2026-09-08T11:50:00.000Z")]);
  assert.equal(gate.ok, false);
  // 11:50 + 30min interval means 20 minutes are still outstanding at 12:00.
  assert.match(gate.reason, /20분 더 기다려/);
});

test("allows again once the interval has elapsed", () => {
  assert.equal(checkRateLimits(settings, NOW, [published("2026-09-08T11:00:00.000Z")]).ok, true);
});

test("uses the most recent publish regardless of input order", () => {
  // dailyLimit 0 isolates the interval check from the daily cap.
  const gate = checkRateLimits({ ...settings, dailyLimit: 0 }, NOW, [
    published("2026-09-08T01:00:00.000Z", "old"),
    published("2026-09-08T11:55:00.000Z", "new"),
  ]);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /25분 더 기다려야/);
});

test("the daily cap takes precedence over the interval message", () => {
  const gate = checkRateLimits(settings, NOW, [
    published("2026-09-08T01:00:00.000Z"),
    published("2026-09-08T11:55:00.000Z"),
  ]);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /한도/);
});

test("a zero daily limit and zero interval mean unlimited", () => {
  const gate = checkRateLimits({ ...settings, dailyLimit: 0, minIntervalMinutes: 0 }, NOW, [
    published("2026-09-08T11:59:00.000Z"),
    published("2026-09-08T11:58:00.000Z"),
    published("2026-09-08T11:57:00.000Z"),
  ]);
  assert.equal(gate.ok, true);
});

test("draft saves do not count against either limit", () => {
  const gate = checkRateLimits(settings, NOW, [
    draft("2026-09-08T11:50:00.000Z", "d1"),
    draft("2026-09-08T11:55:00.000Z", "d2"),
    draft("2026-09-08T11:59:00.000Z", "d3"),
  ]);
  assert.equal(gate.ok, true);
});
