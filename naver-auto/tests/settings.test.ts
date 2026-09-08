import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "naver-auto-settings-"));
process.env.NAVER_AUTO_DATA = scratch;

const { loadSettings, saveSettings, redactSettings } = await import("../src/settings.js");

test("round-trips a real key without persisting presentation flags", () => {
  saveSettings({ pexelsKey: "REALKEY", dailyLimit: 5 });
  const redacted = redactSettings(loadSettings());

  assert.equal(redacted.pexelsKey, "••••••••");
  assert.equal(redacted.hasPexelsKey, true);

  // The dashboard sends the redacted object straight back on save.
  saveSettings(redacted as unknown as Parameters<typeof saveSettings>[0]);
  const stored = loadSettings() as unknown as Record<string, unknown>;

  assert.equal(stored.dailyLimit, 5);
  assert.ok(!("hasPexelsKey" in stored), "helper flags must not be stored");
  assert.ok(!("hasUnsplashKey" in stored), "helper flags must not be stored");
});

test("a settings file that already has junk keys heals on the next save", () => {
  // Simulates a file written by an earlier build that persisted the redacted view.
  const file = join(scratch, "settings.json");
  writeFileSync(
    file,
    JSON.stringify({ dailyLimit: 3, hasPexelsKey: true, hasUnsplashKey: false, stray: "x" }),
    "utf8",
  );

  saveSettings({ dailyLimit: 6 });
  const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

  assert.equal(stored.dailyLimit, 6);
  assert.ok(!("hasPexelsKey" in stored), "junk from an older file is dropped");
  assert.ok(!("stray" in stored));
});

test("unknown keys are ignored", () => {
  saveSettings({ nonsense: 1 } as unknown as Parameters<typeof saveSettings>[0]);
  assert.ok(!("nonsense" in (loadSettings() as unknown as Record<string, unknown>)));
});

test("nested defaults survive a partial save", () => {
  saveSettings({ dailyLimit: 9 });
  const settings = loadSettings();
  assert.equal(settings.dailyLimit, 9);
  assert.equal(settings.formatting.tagCount, 10, "formatting defaults are preserved");
  assert.equal(settings.models.write, "opus");
});

process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
