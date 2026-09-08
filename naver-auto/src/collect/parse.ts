import type { SourceKind } from "../types.js";

export interface RawHit {
  title: string;
  url: string;
  publisher: string | null;
  postedAt: string | null;
  snippet: string;
}

/**
 * Naver renames its search-result CSS classes often, so we do not depend on
 * them. We identify results by the shape of their URLs, which is stable, and
 * only use class names as a hint for the surrounding metadata.
 */
const BLOG_POST = /^https?:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{6,})/;
const NAVER_NEWS = /^https?:\/\/n\.news\.naver\.com\/(?:mnews\/)?article\/(\d+)\/(\d+)/;

const NOISE_HOSTS = new Set([
  "search.naver.com",
  "www.naver.com",
  "naver.com",
  "nid.naver.com",
  "help.naver.com",
  "policy.naver.com",
  "adcr.naver.com",
  "saedu.naver.com",
]);

const NOISE_TEXT = /^(더보기|관련뉴스|네이버뉴스|전체보기|신고|옵션|검색|로그인|블로그|카페|지식iN|이미지|동영상|뉴스|쇼핑)$/;

export function isBlogPostUrl(url: string): boolean {
  return BLOG_POST.test(url);
}

export function isNewsUrl(url: string): boolean {
  if (NAVER_NEWS.test(url)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (NOISE_HOSTS.has(host) || host.endsWith("blog.naver.com")) return false;
    // A news result that Naver did not host itself points at the publisher.
    return /news|press|media|ilbo|times|daily|herald|hankyung|mk\.co\.kr|yna\.co\.kr|chosun|joongang|donga|khan|hani|seoul|edaily|newsis|sbs|kbs|mbc|ytn|zdnet|etnews|inews/i.test(
      host,
    );
  } catch {
    return false;
  }
}

/** Normalise a Naver blog URL so the mobile and desktop forms dedupe together. */
export function canonicalUrl(url: string): string {
  const blog = BLOG_POST.exec(url);
  if (blog) return `https://blog.naver.com/${blog[1]}/${blog[2]}`;
  const news = NAVER_NEWS.exec(url);
  if (news) return `https://n.news.naver.com/mnews/article/${news[1]}/${news[2]}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|from$|sid$|oid$|aid$|cds|nsc|trackingCode)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function blogIdFromUrl(url: string): string | null {
  return BLOG_POST.exec(url)?.[1] ?? null;
}

interface AnchorInput {
  href: string;
  text: string;
  /** Text of the nearest result container, used for snippet + publisher. */
  containerText: string;
  /** DOM order, which mirrors Naver's own ranking. */
  order: number;
}

const DATE_PATTERN =
  /(\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?|\d+\s*(?:분|시간|일|주|개월)\s*전|어제|오늘)/;

/**
 * Turn harvested anchors into ranked results.
 *
 * Exported separately from the Playwright code so it can be unit-tested against
 * saved HTML fixtures without a browser or network.
 */
export function anchorsToHits(anchors: AnchorInput[], kind: SourceKind): RawHit[] {
  const accept = kind === "blog" ? isBlogPostUrl : isNewsUrl;
  const seen = new Set<string>();
  const hits: RawHit[] = [];

  for (const anchor of anchors.sort((a, b) => a.order - b.order)) {
    const title = anchor.text.replace(/\s+/g, " ").trim();
    if (title.length < 8 || NOISE_TEXT.test(title)) continue;
    if (!accept(anchor.href)) continue;

    const url = canonicalUrl(anchor.href);
    if (seen.has(url)) continue;
    seen.add(url);

    const container = anchor.containerText.replace(/\s+/g, " ").trim();
    const snippet = container.replace(title, "").trim().slice(0, 400);

    let publisher: string | null = null;
    if (kind === "blog") {
      publisher = blogIdFromUrl(url);
    } else {
      try {
        publisher = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        publisher = null;
      }
    }

    hits.push({
      title,
      url,
      publisher,
      postedAt: DATE_PATTERN.exec(container)?.[1] ?? null,
      snippet,
    });
  }

  return hits;
}
