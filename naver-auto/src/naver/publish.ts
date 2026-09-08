import type { Frame, Page } from "playwright";
import type { PublishMode, PublishRecord, Settings } from "../types.js";
import { listPublishes } from "../store/db.js";
import { pause } from "./browser.js";
import { dumpDebug, findFirst, findOptional } from "./selectors.js";

export type Reporter = (message: string) => void;

export interface Gate {
  ok: boolean;
  reason: string;
}

/**
 * Rate limits, checked before we touch the publish button.
 *
 * Fully automatic publishing is what the user asked for; these caps exist so a
 * loop or a bad run cannot burn the account in one afternoon.
 */
export function checkRateLimits(
  settings: Settings,
  now = new Date(),
  records: PublishRecord[] = listPublishes(),
): Gate {
  // Only real publishes count; a draft save costs the account nothing.
  const published = records
    .filter((p) => p.url !== null)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));

  if (settings.dailyLimit > 0) {
    const today = now.toISOString().slice(0, 10);
    const todayCount = published.filter((p) => p.at.slice(0, 10) === today).length;
    if (todayCount >= settings.dailyLimit) {
      return { ok: false, reason: `오늘 발행 한도(${settings.dailyLimit}건)에 도달했습니다.` };
    }
  }

  if (settings.minIntervalMinutes > 0 && published[0]) {
    const elapsedMin = (now.getTime() - new Date(published[0].at).getTime()) / 60_000;
    if (elapsedMin < settings.minIntervalMinutes) {
      const wait = Math.ceil(settings.minIntervalMinutes - elapsedMin);
      return { ok: false, reason: `직전 발행 후 ${wait}분 더 기다려야 합니다.` };
    }
  }

  return { ok: true, reason: "" };
}

async function fillTags(frame: Frame, tags: string[], report: Reporter): Promise<void> {
  if (tags.length === 0) return;
  const input = await findOptional(frame, "tagInput", 5000);
  if (!input) {
    report("태그 입력란을 찾지 못해 태그를 건너뜁니다.");
    return;
  }
  await input.click();
  for (const tag of tags) {
    await input.type(tag, { delay: 40 });
    await frame.page().keyboard.press("Enter");
    await pause(200, 450);
  }
  report(`태그 ${tags.length}개 입력 완료.`);
}

async function chooseCategory(frame: Frame, categoryName: string | null, report: Reporter): Promise<void> {
  if (!categoryName) return;
  const trigger = await findOptional(frame, "categorySelect", 4000);
  if (!trigger) {
    report("카테고리 선택 UI를 찾지 못해 기본 카테고리로 발행합니다.");
    return;
  }
  await trigger.click().catch(() => {});
  await pause(400, 800);
  const option = frame.locator(`text="${categoryName}"`).first();
  if (await option.isVisible({ timeout: 2500 }).catch(() => false)) {
    await option.click();
    report(`카테고리: ${categoryName}`);
  } else {
    report(`카테고리 "${categoryName}"를 찾지 못해 기본값으로 둡니다.`);
  }
  await pause(300, 600);
}

/** Save without publishing. Used by draft mode and as the fallback on a gate failure. */
export async function saveDraft(page: Page, frame: Frame, report: Reporter): Promise<void> {
  report("임시저장 중…");
  const save = await findFirst(frame, "saveButton", { timeoutMs: 10_000, page });
  await save.click();
  await pause(2000, 3500);
  report("임시저장 완료.");
}

/**
 * Publish the post that is currently open in the editor.
 * Returns the published URL when Naver navigates to it.
 */
export async function publishPost(
  page: Page,
  frame: Frame,
  settings: Settings,
  tags: string[],
  report: Reporter,
): Promise<string | null> {
  report("발행 패널을 여는 중…");
  const publishButton = await findFirst(frame, "publishButton", { timeoutMs: 15_000, page });
  await publishButton.click();
  await pause(1500, 2500);

  await chooseCategory(frame, settings.categoryName, report);
  await fillTags(frame, tags, report);

  if (settings.visibility === "private") {
    const privateOption = frame.locator('text="비공개"').first();
    if (await privateOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await privateOption.click();
      report("공개설정: 비공개");
    }
  }

  report("발행 확정…");
  const confirm = await findFirst(frame, "publishConfirm", { timeoutMs: 10_000, page });
  await confirm.click();

  // Naver navigates to the published post once it finishes.
  try {
    await page.waitForURL(/blog\.naver\.com\/[^/]+\/\d{6,}/, { timeout: 60_000 });
    const url = page.url();
    report(`발행 완료: ${url}`);
    return url;
  } catch {
    await page.waitForTimeout(5000);
    const url = page.url();
    if (/blog\.naver\.com\/[^/]+\/\d{6,}/.test(url)) {
      report(`발행 완료: ${url}`);
      return url;
    }
    await dumpDebug(page, "publish-result");
    report("발행 버튼은 눌렀지만 결과 URL을 확인하지 못했습니다. 블로그에서 직접 확인해 주세요.");
    return null;
  }
}

export function describeMode(mode: PublishMode): string {
  return mode === "auto" ? "완전 자동 발행" : "임시저장만";
}
