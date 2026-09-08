import type { Source } from "../types.js";
import { closeScrapeContext, jitter } from "./browser.js";
import { extractBodies } from "./extract.js";
import { relatedKeywords, searchBlog, searchNews } from "./search.js";

export interface Collection {
  keyword: string;
  sources: Source[];
  related: string[];
  notes: string[];
}

export type Reporter = (message: string) => void;

/**
 * Scrape Naver for a keyword.
 *
 * Every source is allowed to fail on its own: a Naver markup change should
 * degrade the run, not abort it, so callers get whatever was collected plus a
 * note explaining what came back empty.
 */
export async function collect(keyword: string, report: Reporter = () => {}): Promise<Collection> {
  const notes: string[] = [];

  report(`"${keyword}" 뉴스 탭 수집 중…`);
  const news = await searchNews(keyword);
  notes.push(news.note);
  await jitter();

  report(`"${keyword}" 블로그 탭 수집 중…`);
  const blog = await searchBlog(keyword);
  notes.push(blog.note);
  await jitter();

  report("연관 검색어 확인 중…");
  const related = await relatedKeywords(keyword);

  const sources = [...news.sources.slice(0, 12), ...blog.sources.slice(0, 12)];
  if (sources.length === 0) {
    throw new Error(`"${keyword}" 수집 결과가 없습니다. ${notes.join(" / ")}`);
  }

  report(`본문 추출 중… (${Math.min(sources.length, 12)}건)`);
  const withBodies = await extractBodies(sources, 12);
  const withText = withBodies.filter((s) => s.body).length;
  notes.push(`본문 확보 ${withText}건`);
  report(`수집 완료: ${sources.length}건 (본문 ${withText}건)`);

  return { keyword, sources: withBodies, related, notes };
}

export { closeScrapeContext };
