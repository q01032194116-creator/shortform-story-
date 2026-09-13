import type { Page } from "playwright";
import type { Source } from "../store.js";
import { logger } from "../util/log.js";
import { closeBrowser, openBrowser, shot, sleep, type Session } from "./browser.js";

const log = logger("collect");

type Hit = { title: string; url: string; press?: string; snippet?: string };

/**
 * 네이버 검색 결과 DOM 은 자주 바뀝니다.
 * 그래서 알려진 셀렉터를 먼저 시도하고, 실패하면 "링크 자체"를 기준으로 긁는 범용 방식으로 떨어집니다.
 */
export async function scrapeSearch(page: Page, url: string, kind: "news" | "blog", limit: number): Promise<Hit[]> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(1200);
  await page.mouse.wheel(0, 2000);
  await sleep(800);
  await shot(page, `search-${kind}`);

  return page.evaluate(
    ({ kind, limit }) => {
      const seen = new Set<string>();
      const results: Hit[] = [];
      type Hit = { title: string; url: string; press?: string; snippet?: string };

      const matchesKind = (href: string) =>
        kind === "news"
          ? /n\.news\.naver\.com|news\.naver\.com|\/\/[a-z0-9.-]+\.(co\.kr|com|kr|net)\//i.test(href) &&
            !/search\.naver|blog\.naver|cafe\.naver|shopping\.naver|naver\.me\/help/i.test(href)
          : /blog\.naver\.com\/[^/]+\/\d+|blog\.me\//i.test(href);

      // 1차: 알려진 셀렉터
      const known =
        kind === "news"
          ? ["a.news_tit", ".news_area a.news_tit", ".sds-comps-base-layout a[href][target]"]
          : ["a.title_link", ".view_wrap a.title_link", ".api_txt_lines.total_tit"];

      const pushHit = (el: Element) => {
        const anchor = el as HTMLAnchorElement;
        const href = anchor.href;
        const title = (anchor.getAttribute("title") || anchor.textContent || "").replace(/\s+/g, " ").trim();
        if (!href || !title || title.length < 8 || seen.has(href)) return;
        if (!matchesKind(href)) return;
        seen.add(href);

        // 같은 결과 카드 안에서 언론사/요약문을 찾아봅니다.
        const card = anchor.closest("li, div[class*=wrap], div[class*=area], div[class*=item]");
        const text = (card?.textContent ?? "").replace(/\s+/g, " ").trim();
        const snippet = text.replace(title, "").trim().slice(0, 300);
        const press =
          card?.querySelector("a.info.press, .press, .sub_txt, .user_info a")?.textContent?.trim() || undefined;

        results.push({ title, url: href, press, snippet: snippet || undefined });
      };

      for (const selector of known) {
        document.querySelectorAll(selector).forEach(pushHit);
        if (results.length >= limit) break;
      }

      // 2차: 범용 폴백 — 결과 영역의 모든 링크에서 조건에 맞는 것만 추립니다.
      if (results.length < limit) {
        const scope = document.querySelector("#main_pack, #content, main") ?? document.body;
        scope.querySelectorAll("a[href]").forEach(pushHit);
      }

      return results.slice(0, limit);
    },
    { kind, limit },
  );
}

/** 뉴스 기사 / 블로그 글의 본문을 읽어옵니다. 실패하면 빈 문자열. */
async function readArticle(page: Page, url: string): Promise<string> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await sleep(600);

    // 네이버 블로그는 본문이 #mainFrame iframe 안에 있습니다.
    const frame = page.frames().find((f) => f.name() === "mainFrame") ?? page.mainFrame();

    const text = await frame.evaluate(() => {
      const candidates = [
        "#dic_area", // 네이버 뉴스 본문
        "#articeBody",
        "#newsct_article",
        ".se-main-container", // 스마트에디터 ONE 블로그 본문
        "#postViewArea", // 구버전 블로그
        "article",
        "#articleBodyContents",
      ];
      for (const selector of candidates) {
        const el = document.querySelector(selector);
        const value = (el as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim();
        if (value && value.length > 200) return value;
      }
      return document.body.innerText.replace(/\s+/g, " ").trim();
    });

    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

/** 관심 키워드에 대해 네이버 뉴스 + 인기 블로그 글을 모읍니다. */
export async function collectSources(keyword: string, limit: number): Promise<Source[]> {
  let session: Session | null = null;
  try {
    session = await openBrowser({ headless: true });
    const { page } = session;
    const query = encodeURIComponent(keyword);
    const newsCount = Math.ceil(limit / 2);
    const blogCount = limit - newsCount;

    log.step(`"${keyword}" 네이버 뉴스 수집 중...`);
    // nso=so:r,p:1w — 최근 1주일, 관련도순
    const news = await scrapeSearch(
      page,
      `https://search.naver.com/search.naver?where=news&query=${query}&sort=0&nso=so%3Ar%2Cp%3A1w`,
      "news",
      newsCount,
    );
    log.info(`뉴스 ${news.length}건`);

    log.step(`"${keyword}" 인기 블로그 글 수집 중...`);
    const blogs = await scrapeSearch(
      page,
      `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${query}`,
      "blog",
      blogCount,
    );
    log.info(`블로그 ${blogs.length}건`);

    if (news.length + blogs.length === 0) {
      throw new Error(
        `"${keyword}" 검색 결과를 하나도 읽지 못했습니다. 네이버 검색 DOM 이 바뀌었을 수 있습니다. data/debug 의 스크린샷을 확인해 주세요.`,
      );
    }

    const collectedAt = new Date().toISOString();
    const sources: Source[] = [];
    for (const [kind, hits] of [
      ["news", news],
      ["blog", blogs],
    ] as const) {
      for (const hit of hits) {
        log.info(`본문 읽는 중: ${hit.title.slice(0, 40)}`);
        const body = await readArticle(page, hit.url);
        sources.push({ kind, ...hit, body, collectedAt });
        await sleep(400 + Math.random() * 600); // 과도한 요청 방지
      }
    }

    log.done(`총 ${sources.length}건 수집 완료`);
    return sources;
  } finally {
    await closeBrowser(session);
  }
}
