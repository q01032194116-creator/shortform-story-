import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _cliJsNear } from "../src/ai/resolveClaude.js";

test("finds cli.js next to an npm shim", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-shim-"));
  try {
    // Mirrors a Windows npm global install: %APPDATA%\npm\claude.cmd
    const pkg = join(root, "node_modules", "@anthropic-ai", "claude-code");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "cli.js"), "// entry");
    const shim = join(root, "claude.cmd");
    writeFileSync(shim, "@echo off");

    assert.equal(_cliJsNear(shim), join(pkg, "cli.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("returns null when there is no package nearby", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-bare-"));
  try {
    const shim = join(root, "claude.cmd");
    writeFileSync(shim, "@echo off");
    assert.equal(_cliJsNear(shim), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
