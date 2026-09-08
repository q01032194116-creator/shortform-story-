/** Verify that `claude -p` works and honours a JSON Schema. */
import { healthCheck, ask } from "../ai/claude.js";
import { describeClaude } from "../ai/resolveClaude.js";

const health = await healthCheck();
console.log(`Claude CLI: ${describeClaude()}`);
console.log(health.ok ? "✓ 연결 정상" : `✗ ${health.message}`);
if (!health.ok) process.exit(1);

const result = await ask<{ title: string; tags: string[] }>({
  prompt: '"가을 등산 준비물"로 네이버 블로그 제목 하나와 태그 3개를 만들어 줘.',
  schema: {
    type: "object",
    properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
    required: ["title", "tags"],
    additionalProperties: false,
  },
  label: "smoke",
});
console.log("✓ 구조화 응답:", JSON.stringify(result, null, 2));
