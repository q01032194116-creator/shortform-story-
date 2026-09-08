import type { Page } from "playwright";
import type { Source } from "../types.js";
import { jitter, withPage } from "./browser.js";
import { isBlogPostUrl } from "./parse.js";

/** Pull the main article text out of whatever page we landed on. */
async function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const CANDIDATES = [
      ".se-main-container", // Naver blog SmartEditor ONE
      "#postViewArea", // legacy Naver blog
      "#dic_area", // Naver news
      "#newsct_article",
      "#articleBodyContents",
      "article",
      "#articleBody",
      ".article_body",
      ".news_end",
    ];
    for (const selector of CANDIDATES) {
      const el = document.querySelector<HTMLElement>(selector);
      const text = el?.innerText?.trim() ?? "";
      if (text.length > 200) return text;
    }
    // Fall back to the densest block of text on the page.
    let best = "";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("div,section,main"))) {
      const text = el.innerText ?? "";
      if (text.length > best.length && text.length < 40_000) best = text;
    }
    return best.trim();
  });
}

async function extractOne(source: Source): Promise<string | null> {
  return withPage(async (page) => {
    try {
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      await page.waitForTimeout(800);

      // Naver blog posts render inside an iframe; step into it.
      if (isBlogPostUrl(source.url)) {
        const frame = page.frames().find((f) => f.name() === "mainFrame") ?? null;
        if (frame) {
          const text = await frame.evaluate(() => {
            const el =
              document.querySelector<HTMLElement>(".se-main-container") ??
              document.querySelector<HTMLElement>("#postViewArea");
            return el?.innerText?.trim() ?? "";
          });
          if (text.length > 200) return text.slice(0, 12_000);
        }
      }

      const text = await readableText(page);
      return text.length > 200 ? text.slice(0, 12_000) : null;
    } catch {
      return null;
    }
  });
}

/**
 * Fetch full text for the top sources so the AI writes from substance rather
 * than search snippets. Runs sequentially with jitter to stay polite.
 */
export async function extractBodies(sources: Source[], limit = 12): Promise<Source[]> {
  const out = [...sources];
  const targets = out.slice(0, limit);

  for (const source of targets) {
    source.body = await extractOne(source);
    await jitter(1200, 2800);
  }

  return out;
}
