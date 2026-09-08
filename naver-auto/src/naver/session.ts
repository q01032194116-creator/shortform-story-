import type { BrowserContext } from "playwright";
import type { NaverAccount } from "../types.js";
import { PATHS } from "../paths.js";
import { getAccount, setAccount } from "../store/db.js";
import { clearProfile, naverContext } from "./browser.js";

/** Naver sets both cookies only for a fully authenticated session. */
export async function hasLoginCookies(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.naver.com");
  const names = new Set(cookies.map((c) => c.name));
  return names.has("NID_AUT") && names.has("NID_SES");
}

/** Read the signed-in blog id and nickname straight from the blog home page. */
export async function readBlogIdentity(
  context: BrowserContext,
): Promise<{ blogId: string | null; nickname: string | null }> {
  const page = await context.newPage();
  try {
    await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForTimeout(1200);

    // Landing on blog.naver.com while signed in redirects to /<blogId>.
    const fromUrl = /blog\.naver\.com\/([A-Za-z0-9_-]+)/.exec(page.url())?.[1] ?? null;

    const found = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="blog.naver.com/"]');
      const id = link ? /blog\.naver\.com\/([A-Za-z0-9_-]+)/.exec(link.href)?.[1] ?? null : null;
      const nickEl = document.querySelector<HTMLElement>(".nick, .user_name, .blog_name, .itemfont");
      return { id, nickname: nickEl?.innerText?.trim() ?? null };
    });

    const blogId = fromUrl && fromUrl !== "PostList.naver" ? fromUrl : found.id;
    return { blogId, nickname: found.nickname };
  } catch {
    return { blogId: null, nickname: null };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Check the saved session without showing a window. */
export async function checkSession(): Promise<NaverAccount> {
  let context: BrowserContext | null = null;
  try {
    context = await naverContext(true);
    const loggedIn = await hasLoginCookies(context);
    if (!loggedIn) {
      const account: NaverAccount = { loggedIn: false, blogId: null, nickname: null, checkedAt: new Date().toISOString() };
      setAccount(account);
      return account;
    }

    const identity = await readBlogIdentity(context);
    await context.storageState({ path: PATHS.storageState });

    const account: NaverAccount = {
      loggedIn: true,
      blogId: identity.blogId ?? getAccount().blogId,
      nickname: identity.nickname ?? getAccount().nickname,
      checkedAt: new Date().toISOString(),
    };
    setAccount(account);
    return account;
  } catch {
    return { ...getAccount(), checkedAt: new Date().toISOString() };
  } finally {
    await context?.close().catch(() => {});
  }
}

export function logout(): NaverAccount {
  clearProfile();
  const account: NaverAccount = { loggedIn: false, blogId: null, nickname: null, checkedAt: new Date().toISOString() };
  setAccount(account);
  return account;
}
