import assert from "node:assert/strict";
import test from "node:test";
import { bodyLength, normaliseBlocks } from "../src/write/compose.js";

test("normalises model output into renderable blocks", () => {
  const { blocks, slots } = normaliseBlocks(
    [
      { type: "divider" },
      { type: "paragraph", text: "  첫 문단입니다.  " },
      { type: "paragraph", text: "   " },
      { type: "heading", text: "소제목" },
      { type: "image", hint: "가을 산길" },
      { type: "list", items: ["항목 1", "  ", "항목 2"] },
      { type: "divider" },
      { type: "divider" },
      { type: "quote", text: "핵심 한 줄" },
    ],
    3,
  );

  assert.equal(blocks[0]!.type, "paragraph", "leading divider is dropped");
  assert.equal(blocks.filter((b) => b.type === "divider").length, 1, "stacked dividers collapse");
  assert.ok(!blocks.some((b) => b.type === "paragraph" && b.text === ""), "empty paragraphs dropped");
  assert.deepEqual(
    blocks.find((b) => b.type === "list"),
    { type: "list", items: ["항목 1", "항목 2"] },
  );
  assert.equal(slots.length, 1);
  assert.equal(slots[0]!.slotId, "img1");
  assert.equal(slots[0]!.hint, "가을 산길");
});

test("caps image slots at the configured count", () => {
  const raw = Array.from({ length: 6 }, () => ({ type: "image" as const, hint: "사진" }));
  const { blocks, slots } = normaliseBlocks(raw, 2);
  assert.equal(slots.length, 2);
  assert.equal(blocks.filter((b) => b.type === "image").length, 2);
});

test("image slots fall back to a default hint", () => {
  const { slots } = normaliseBlocks([{ type: "image" }], 1);
  assert.equal(slots[0]!.hint, "글 주제와 어울리는 사진");
});

test("bodyLength counts prose but not dividers or images", () => {
  const length = bodyLength([
    { type: "paragraph", text: "12345" },
    { type: "heading", text: "123" },
    { type: "list", items: ["12", "34"] },
    { type: "divider" },
    { type: "image", slotId: "img1", hint: "무시됨" },
  ]);
  assert.equal(length, 5 + 3 + 4);
});
