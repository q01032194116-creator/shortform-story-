import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { Source, SourceKind } from "../types.js";
import { PATHS, ensureDirs } from "../paths.js";
import { jitter, withPage } from "./browser.js";
import { anchorsToHits } from "./parse.js";

/** Harvest every anchor with enough context to rank and describe it. */
async function harvestAnchors(page: Page) {
  return page.evaluate(() => {
    const results: Array<{ href: string; text: string; containerText: string; order: number }> = [];
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    anchors.forEach((a, order) => {
      const el = a as HTMLAnchorElement;
      const href = el.href;
      if (!href.startsWith("http")) return;
      // Walk up to a container big enough to hold the snippet but not the page.
      let container: HTMLElement = el;
      for (let i = 0; i < 5 && container.parentElement; i += 1) {
        container = container.parentElement;
        if ((container.innerText ?? "").length > 80) break;
      }
      results.push({
        href,
        text: el.innerText ?? el.textContent ?? "",
        containerText: (container.innerText ?? "").slice(0, 800),
        order,
      });
    });
    return results;
  });
}

function dumpDebug(name: string, html: string): void {
  try {
    ensureDirs();
    writeFileSync(join(PATHS.debug, `${name}-${Date.now()}.html`), html, "utf8");
  } catch {
    /* debug output is best-effort */
  }
}

export interface SearchResult {
  sources: Source[];
  /** Per-source diagnostics surfaced in the dashboard instead of a hard failure. */
  note: string;
}

async function searchTab(keyword: string, kind: SourceKind, sort: string, idPrefix: string): Promise<SearchResult> {
  const where = kind === "news" ? "news" : "blog";
  const url = `https://search.naver.com/search.naver?where=${where}&query=${encodeURIComponent(keyword)}&sort=${sort}`;

  return withPage(async (page) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch (error) {
      return { sources: [], note: `${where} 접속 실패: ${(error as Error).message.slice(0, 120)}` };
    }

    // Naver lazy-loads more results as you scroll.
    for (let i = 0; i < 3; i += 1) {
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(600);
    }

    const anchors = await harvestAnchors(page);
    const hits = anchorsToHits(anchors, kind);

    if (hits.length === 0) {
      dumpDebug(`search-${where}`, await page.content());
      return {
        sources: [],
        note: `${where} 결과 0건 — data/debug/ 에 HTML을 저장했습니다. 네이버가 마크업을 바꿨을 수 있습니다.`,
      };
    }

    const sources: Source[] = hits.slice(0, 20).map((hit, index) => ({
      id: `${idPrefix}${index + 1}`,
      kind,
      rank: index + 1,
      title: hit.title,
      url: hit.url,
      publisher: hit.publisher,
      postedAt: hit.postedAt,
      snippet: hit.snippet,
      body: null,
    }));

    return { sources, note: `${where} ${sources.length}건` };
  });
}

export async function searchNews(keyword: string): Promise<SearchResult> {
  // sort=1 is "latest", which is what makes a topic timely.
  return searchTab(keyword, "news", "1", "N");
}

export async function searchBlog(keyword: string): Promise<SearchResult> {
  // sort=0 is Naver's own relevance ranking — i.e. what is actually winning.
  return searchTab(keyword, "blog", "0", "B");
}

/** Related-search suggestions, used to widen a keyword into sub-topics. */
export async function relatedKeywords(keyword: string): Promise<string[]> {
  const url = `https://search.naver.com/search.naver?query=${encodeURIComponent(keyword)}`;
  return withPage(async (page) => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(500);
      const words = await page.evaluate(() => {
        const out = new Set<string>();
        for (const a of Array.from(document.querySelectorAll('a[href*="query="]'))) {
          const text = (a as HTMLElement).innerText?.trim() ?? "";
          if (text.length >= 2 && text.length <= 25 && !text.includes("\n")) out.add(text);
        }
        return Array.from(out);
      });
      return words.filter((w) => w !== keyword).slice(0, 20);
    } catch {
      return [];
    }
  });
}

export { jitter };
