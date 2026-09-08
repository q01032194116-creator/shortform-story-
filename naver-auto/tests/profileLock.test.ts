import assert from "node:assert/strict";
import test from "node:test";
import { profileHolder, withProfile } from "../src/naver/browser.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("runs profile users one at a time", async () => {
  const order: string[] = [];
  let concurrent = 0;
  let peak = 0;

  const task = (name: string, ms: number) =>
    withProfile(name, async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      order.push(`${name}:start`);
      await wait(ms);
      order.push(`${name}:end`);
      concurrent -= 1;
    });

  await Promise.all([task("login", 60), task("session-check", 10), task("publish", 10)]);

  assert.equal(peak, 1, "only one owner may hold the profile at a time");
  assert.deepEqual(order, [
    "login:start",
    "login:end",
    "session-check:start",
    "session-check:end",
    "publish:start",
    "publish:end",
  ]);
});

test("a failing owner does not deadlock the queue", async () => {
  await assert.rejects(withProfile("boom", async () => { throw new Error("실패"); }), /실패/);

  // The chain must still accept work after a rejection.
  const result = await withProfile("after", async () => "ok");
  assert.equal(result, "ok");
  assert.equal(profileHolder(), null, "the lock is released after each owner");
});

test("reports who holds the profile while work is in flight", async () => {
  let seen: string | null = "unset";
  await withProfile("login", async () => {
    seen = profileHolder();
  });
  assert.equal(seen, "login");
  assert.equal(profileHolder(), null);
});
