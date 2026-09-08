import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeForTyping } from "../src/naver/editor.js";

// Heads up when editing this file: several inputs below contain real invisible
// characters -- U+2028 line separator, U+2029 paragraph separator, and
// non-breaking spaces. They look like ordinary spaces in an editor, so a
// "collapses X to a space" case can read as a no-op assertion. It is not:
// the expected values are plain ASCII spaces. Verify with `od -c` before
// "simplifying" any of them.

test("collapses newlines that would split an editor block", () => {
  // keyboard.type() turns "\n" into a real Enter, which would break one
  // paragraph into several SmartEditor blocks.
  assert.equal(sanitizeForTyping("첫 줄입니다.\n\n두 번째 문단입니다."), "첫 줄입니다. 두 번째 문단입니다.");
  assert.equal(sanitizeForTyping("윈도우\r\n개행"), "윈도우 개행");
  assert.equal(sanitizeForTyping("탭\t문자"), "탭 문자");
});

test("removes Unicode line and paragraph separators", () => {
  assert.equal(sanitizeForTyping("a b c"), "a b c");
});

test("trims and collapses runs of spaces", () => {
  assert.equal(sanitizeForTyping("  넉넉한   공백   "), "넉넉한 공백");
  assert.equal(sanitizeForTyping("논브레이킹  공백"), "논브레이킹 공백");
});

test("leaves ordinary text untouched", () => {
  const text = "전기차 보조금은 지자체마다 다릅니다.";
  assert.equal(sanitizeForTyping(text), text);
});

test("whitespace-only input becomes empty so nothing is typed", () => {
  assert.equal(sanitizeForTyping("   \n\t  "), "");
});

test("chunking never emits a newline keystroke", () => {
  const chunks = sanitizeForTyping("가나다\n라마바".repeat(20)).match(/.{1,12}/g) ?? [];
  assert.ok(chunks.length > 0);
  assert.ok(!chunks.some((c) => c.includes("\n")));
});
