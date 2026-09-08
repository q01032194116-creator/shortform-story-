import type { Frame, Page } from "playwright";
import type { ImageSlot, PostBlock, Settings } from "../types.js";
import { chosenCandidate } from "../images/resolve.js";
import { pause } from "./browser.js";
import { dumpDebug, findFirst, findOptional } from "./selectors.js";

export type Reporter = (message: string) => void;

const WRITE_URL = (blogId: string) => `https://blog.naver.com/${blogId}?Redirect=Write&`;

/** SmartEditor lives inside #mainFrame; everything below operates on that frame. */
export async function openEditor(page: Page, blogId: string, report: Reporter): Promise<Frame> {
  report("네이버 에디터를 여는 중…");
  await page.goto(WRITE_URL(blogId), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);

  const frame =
    page.frames().find((f) => f.name() === "mainFrame") ??
    page.frames().find((f) => f.url().includes("PostWriteForm")) ??
    page.mainFrame();

  // Naver offers to restore the previous draft; decline so we start clean.
  const cancel = await findOptional(frame, "restorePopupCancel", 4000);
  if (cancel) {
    await cancel.click().catch(() => {});
    report("이전 임시저장 복구 팝업을 닫았습니다.");
    await page.waitForTimeout(800);
  }

  // Confirm the editor really loaded before we start typing into nothing.
  await findFirst(frame, "titleInput", { timeoutMs: 20_000, page });
  return frame;
}

/** Type with a varying delay so input does not look machine-generated. */
async function humanType(frame: Frame, text: string): Promise<void> {
  for (const chunk of text.match(/.{1,12}/gs) ?? []) {
    await frame.page().keyboard.type(chunk, { delay: 18 + Math.random() * 32 });
  }
}

async function clickToolbar(frame: Frame, key: "quoteButton" | "dividerButton" | "imageButton", page: Page): Promise<void> {
  const button = await findFirst(frame, key, { timeoutMs: 6000, page });
  await button.click();
  await pause(300, 700);
}

async function insertImage(frame: Frame, page: Page, filePath: string, caption: string | null): Promise<void> {
  // The toolbar button opens a picker backed by a hidden file input; setting
  // files on that input is far more reliable than driving the OS dialog.
  const fileInputBefore = frame.locator('input[type="file"]').first();
  const hasInput = await fileInputBefore.count().then((c) => c > 0).catch(() => false);

  if (!hasInput) await clickToolbar(frame, "imageButton", page);

  const fileInput = frame.locator('input[type="file"]').first();
  await fileInput.setInputFiles(filePath, { timeout: 20_000 });

  // Wait for the uploaded image component to appear in the document.
  await frame
    .locator(".se-image, .se-component.se-image, figure")
    .last()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => {});
  await pause(1200, 2200);

  if (caption) {
    const captionBox = frame.locator('[data-placeholder*="설명"], .se-caption [contenteditable="true"]').last();
    if (await captionBox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await captionBox.click();
      await humanType(frame, caption);
      await pause(300, 600);
    }
  }

  // Move the caret past the image so the next block is not swallowed by it.
  await frame.page().keyboard.press("Escape").catch(() => {});
  await frame.page().keyboard.press("End").catch(() => {});
  await frame.page().keyboard.press("Enter").catch(() => {});
}

/**
 * Write the whole post into the editor.
 *
 * The block array is the contract produced by the writing stage, so the editor
 * never has to parse prose — it just plays back typed blocks and formatting.
 */
export async function writeIntoEditor(
  page: Page,
  frame: Frame,
  title: string,
  blocks: PostBlock[],
  slots: ImageSlot[],
  settings: Settings,
  report: Reporter,
): Promise<void> {
  const slotById = new Map(slots.map((s) => [s.slotId, s]));

  report("제목 입력…");
  const titleBox = await findFirst(frame, "titleInput", { timeoutMs: 15_000, page });
  await titleBox.click();
  await humanType(frame, title);
  await pause(500, 900);

  // Tab moves from the title into the body in SmartEditor.
  await page.keyboard.press("Tab");
  await pause(400, 800);

  const body = await findFirst(frame, "bodyArea", { timeoutMs: 15_000, page });
  await body.click().catch(() => {});
  await pause(300, 600);

  for (const [index, block] of blocks.entries()) {
    report(`본문 입력 ${index + 1}/${blocks.length} (${block.type})`);
    try {
      switch (block.type) {
        case "heading": {
          if (settings.formatting.headingStyle === "quote") {
            await clickToolbar(frame, "quoteButton", page);
            await humanType(frame, block.text);
            await page.keyboard.press("Enter");
            // Leave the quote block so the next paragraph is plain text.
            await page.keyboard.press("Enter");
          } else {
            await humanType(frame, block.text);
            await page.keyboard.press("Enter");
          }
          break;
        }
        case "paragraph": {
          await humanType(frame, block.text);
          await page.keyboard.press("Enter");
          break;
        }
        case "quote": {
          await clickToolbar(frame, "quoteButton", page);
          await humanType(frame, block.text);
          await page.keyboard.press("Enter");
          await page.keyboard.press("Enter");
          break;
        }
        case "list": {
          for (const item of block.items) {
            await humanType(frame, `· ${item}`);
            await page.keyboard.press("Enter");
          }
          break;
        }
        case "divider": {
          if (settings.formatting.dividerBetweenSections) {
            await clickToolbar(frame, "dividerButton", page);
            await pause(500, 900);
          }
          break;
        }
        case "image": {
          const slot = slotById.get(block.slotId);
          const candidate = slot ? chosenCandidate(slot) : null;
          if (!candidate?.filePath) {
            report(`  이미지 ${block.slotId}: 채택된 사진이 없어 건너뜁니다.`);
            break;
          }
          await insertImage(frame, page, candidate.filePath, candidate.caption);
          break;
        }
      }
      await pause(200, 500);
    } catch (error) {
      await dumpDebug(page, `block-${index}-${block.type}`);
      throw new Error(`본문 ${index + 1}번째 블록(${block.type}) 입력 실패: ${(error as Error).message}`);
    }
  }

  report("본문 입력 완료.");
}
