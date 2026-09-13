/**
 * 서버가 조용히 죽어 대시보드에 "Failed to fetch" 만 남는 상황을 막기 위한 테스트입니다.
 *
 * 처리되지 않은 Promise 거부는 Node 에서 기본적으로 프로세스를 종료시킵니다.
 * 실제로 publish 의 insertImage 가 사진 버튼을 못 찾고 빠져나갈 때
 * 아무도 기다리지 않는 waitForEvent Promise 를 남겨 서버를 죽이고 있었습니다.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const PORT = 8791;

test("아무도 기다리지 않는 거부 Promise 에도 서버가 죽지 않는다", async () => {
  const script = `
    import("./server/index.ts").then(async () => {
      await new Promise((r) => setTimeout(r, 2500));
      Promise.reject(new Error("고아 거부 테스트"));
      await new Promise((r) => setTimeout(r, 2500));
      const res = await fetch("http://localhost:${PORT}/api/status");
      console.log("RESULT:" + (res.ok ? "ALIVE" : "DEAD"));
      process.exit(0);
    });
  `;

  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    env: { ...process.env, PORT: String(PORT) },
  });

  let out = "";
  child.stdout.on("data", (c: Buffer) => (out += c.toString()));
  child.stderr.on("data", (c: Buffer) => (out += c.toString()));
  await new Promise((resolve) => child.on("close", resolve));

  assert.ok(out.includes("처리되지 않은 오류"), "오류가 로그에 남아야 합니다");
  assert.ok(out.includes("RESULT:ALIVE"), `서버가 살아 있어야 합니다.\n${out.slice(-600)}`);
});

test("사진 버튼을 못 찾는 경로에 고아 Promise 가 없다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../server/naver/publish.ts", import.meta.url), "utf8");

  const line = source.split("\n").find((l) => l.includes('waitForEvent("filechooser"'));
  assert.ok(line, "filechooser 대기 코드를 찾지 못했습니다");
  assert.ok(
    line.includes(".catch("),
    "waitForEvent 에는 즉시 .catch 를 붙여야 합니다. 버튼을 못 찾아 return 하면 고아 Promise 가 되어 서버가 죽습니다",
  );
});
