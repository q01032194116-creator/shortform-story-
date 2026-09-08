import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Frame, Locator, Page } from "playwright";
import { PATHS, ensureDirs } from "../paths.js";

export class SelectorError extends Error {
  constructor(readonly what: string, readonly tried: string[]) {
    super(`네이버 에디터에서 "${what}" 요소를 찾지 못했습니다. data/debug/ 의 스크린샷을 확인해 주세요.`);
    this.name = "SelectorError";
  }
}

/**
 * Selector candidates, most stable first.
 *
 * Naver ships hashed CSS class names that change without notice, so we lead
 * with the visible Korean labels and ARIA roles and keep class selectors only
 * as a backstop.
 */
export const SELECTORS = {
  restorePopupCancel: [
    'button:has-text("취소")',
    ".se-popup-button-cancel",
    '.se-popup-button:has-text("취소")',
  ],
  titleInput: [
    '[contenteditable="true"][data-placeholder*="제목"]',
    ".se-documentTitle .se-text-paragraph",
    ".se-documentTitle",
    ".se-title-text",
  ],
  bodyArea: [
    ".se-main-container .se-text-paragraph",
    '.se-component-content [contenteditable="true"]',
    ".se-main-container",
  ],
  imageButton: [
    'button[aria-label*="사진"]',
    'button[data-name="image"]',
    'button:has-text("사진")',
    ".se-image-toolbar-button",
  ],
  imageFileInput: ['input[type="file"]'],
  quoteButton: [
    'button[aria-label*="인용구"]',
    'button[data-name="quotation"]',
    ".se-quotation-toolbar-button",
  ],
  dividerButton: [
    'button[aria-label*="구분선"]',
    'button[data-name="horizontalLine"]',
    ".se-horizontalLine-toolbar-button",
  ],
  saveButton: [
    'button:has-text("저장")',
    '[class*="save_btn"]',
    ".btn_save",
  ],
  publishButton: [
    'button:has-text("발행")',
    '[class*="publish_btn"]',
    ".btn_publish",
  ],
  tagInput: [
    'input[placeholder*="태그"]',
    "#tag-input",
    ".tag_input input",
    '[class*="tag_input"] input',
  ],
  categorySelect: [
    'button[class*="category"]',
    'a[class*="category"]',
    "#category",
  ],
  /** The confirm button inside the publish side panel. */
  publishConfirm: [
    '[class*="publish"] button:has-text("발행")',
    'button:has-text("발행")',
    ".btn_ok",
  ],
} as const;

export type SelectorKey = keyof typeof SELECTORS;

/** Save a screenshot and the DOM so a broken selector is diagnosable. */
export async function dumpDebug(page: Page, name: string): Promise<void> {
  try {
    ensureDirs();
    const stamp = `${name}-${Date.now()}`;
    await page.screenshot({ path: join(PATHS.debug, `${stamp}.png`), fullPage: true }).catch(() => {});
    writeFileSync(join(PATHS.debug, `${stamp}.html`), await page.content(), "utf8");
  } catch {
    /* diagnostics are best-effort */
  }
}

/**
 * Return the first selector in the list that resolves to a visible element.
 * Throws a SelectorError naming everything it tried, so failures point at the
 * exact thing to fix rather than surfacing a generic timeout.
 */
export async function findFirst(
  scope: Frame | Page,
  key: SelectorKey,
  options: { timeoutMs?: number; page?: Page } = {},
): Promise<Locator> {
  const { timeoutMs = 8000, page } = options;
  const candidates = SELECTORS[key];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const selector of candidates) {
      const locator = scope.locator(selector).first();
      try {
        if (await locator.isVisible({ timeout: 500 })) return locator;
      } catch {
        /* try the next candidate */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (page) await dumpDebug(page, `selector-${key}`);
  throw new SelectorError(key, [...candidates]);
}

/** Like findFirst but returns null instead of throwing — for optional UI. */
export async function findOptional(
  scope: Frame | Page,
  key: SelectorKey,
  timeoutMs = 3000,
): Promise<Locator | null> {
  try {
    return await findFirst(scope, key, { timeoutMs });
  } catch {
    return null;
  }
}
