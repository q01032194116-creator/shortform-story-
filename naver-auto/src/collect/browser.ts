import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

let browser: Browser | null = null;
let context: BrowserContext | null = null;

/**
 * Browser used only for scraping search results.
 *
 * Deliberately anonymous and separate from the logged-in Naver profile so that
 * crawling traffic is never tied to the user's account.
 */
export async function scrapeContext(): Promise<BrowserContext> {
  if (context) return context;

  const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  browser = await chromium.launch({
    headless: true,
    proxy: proxyServer ? { server: proxyServer } : undefined,
  });
  context = await browser.newContext({
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: Boolean(proxyServer),
  });

  // Skip everything we never read; roughly halves page load time.
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "media" || type === "font") return route.abort();
    return route.continue();
  });

  return context;
}

export async function closeScrapeContext(): Promise<void> {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  context = null;
  browser = null;
}

/** Human-ish pause between requests so we do not hammer Naver. */
export function jitter(minMs = 1500, maxMs = 4000): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await scrapeContext();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}
