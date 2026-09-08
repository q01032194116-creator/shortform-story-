/**
 * Selector doctor.
 *
 * Opens the Naver blog editor with the saved session and reports which of our
 * selector candidates actually match. Run this on the machine that has a real
 * Naver login whenever writing or publishing breaks — the output says exactly
 * which selector list in src/naver/selectors.ts needs updating.
 *
 *   npm run doctor
 */
import type { Frame } from "playwright";
import { naverContext } from "../naver/browser.js";
import { getAccount } from "../store/db.js";
import { SELECTORS, dumpDebug, type SelectorKey } from "../naver/selectors.js";
import { checkSession } from "../naver/session.js";

const account = await checkSession();
if (!account.loggedIn || !account.blogId) {
  console.error("✗ 네이버에 로그인되어 있지 않습니다. 먼저 대시보드에서 로그인해 주세요.");
  process.exit(1);
}
console.log(`✓ 로그인됨 (블로그 ID: ${account.blogId})\n`);

const context = await naverContext(false);
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`https://blog.naver.com/${account.blogId}?Redirect=Write&`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5000);

  const frame: Frame =
    page.frames().find((f) => f.name() === "mainFrame") ??
    page.frames().find((f) => f.url().includes("PostWriteForm")) ??
    page.mainFrame();

  console.log(`프레임: ${frame.name() || "(main)"} — ${frame.url().slice(0, 90)}\n`);
  console.log("셀렉터 점검 (✓ = 이 셀렉터를 쓰면 됩니다):\n");

  for (const key of Object.keys(SELECTORS) as SelectorKey[]) {
    const results: string[] = [];
    for (const selector of SELECTORS[key]) {
      try {
        const locator = frame.locator(selector).first();
        const visible = await locator.isVisible({ timeout: 700 });
        const count = await frame.locator(selector).count();
        results.push(`${visible ? "✓" : count > 0 ? "·" : "✗"} ${selector}${count ? ` (${count}개)` : ""}`);
      } catch {
        results.push(`✗ ${selector}`);
      }
    }
    const ok = results.some((r) => r.startsWith("✓"));
    console.log(`${ok ? "✓" : "✗"} ${key}`);
    for (const line of results) console.log(`    ${line}`);
  }

  await dumpDebug(page, "doctor-editor");
  console.log("\ndata/debug/ 에 에디터 스크린샷과 HTML을 저장했습니다.");
  console.log("✗ 표시된 항목이 있으면 그 HTML에서 실제 셀렉터를 찾아 src/naver/selectors.ts 에 추가하세요.");
} finally {
  await context.close().catch(() => {});
}
