import { loadSettings, saveSettings } from "../config.js";
import { logger } from "../util/log.js";
import { closeBrowser, isLoggedIn, openBrowser, saveSession, shot, sleep, type Session } from "./browser.js";

const log = logger("login");

/**
 * 눈에 보이는 브라우저 창을 띄워 사용자가 직접 네이버에 로그인하게 합니다.
 * 앱은 아이디/비밀번호를 받지도, 저장하지도, 대신 입력하지도 않습니다.
 * 로그인이 끝나면 쿠키(storageState)만 로컬 파일로 저장합니다.
 */
export async function interactiveLogin(timeoutSec = 300): Promise<{ blogId: string }> {
  let session: Session | null = null;
  try {
    log.step("로그인 창을 엽니다. 브라우저에서 직접 로그인해 주세요.");
    session = await openBrowser({ headless: false, useSession: false });
    const { page, context } = session;

    await page.goto("https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com", {
      waitUntil: "domcontentloaded",
    });

    const deadline = Date.now() + timeoutSec * 1000;
    let announced = 0;
    while (Date.now() < deadline) {
      if (await isLoggedIn(context)) break;
      await sleep(2000);
      const waited = Math.floor((timeoutSec * 1000 - (deadline - Date.now())) / 1000);
      if (waited - announced >= 30) {
        announced = waited;
        log.info(`로그인 대기 중... (${waited}초 / 최대 ${timeoutSec}초)`);
      }
      if (page.isClosed()) throw new Error("로그인 창이 닫혔습니다. 다시 시도해 주세요.");
    }

    if (!(await isLoggedIn(context))) {
      throw new Error(`${timeoutSec}초 안에 로그인이 완료되지 않았습니다.`);
    }

    await shot(page, "logged-in");
    await saveSession(context);
    log.info("로그인 세션을 로컬에 저장했습니다.");

    const blogId = await detectBlogId(session);
    if (blogId) {
      saveSettings({ blogId });
      log.done(`로그인 완료. 블로그 아이디: ${blogId}`);
    } else {
      log.warn("블로그 아이디를 자동으로 찾지 못했습니다. 설정에서 직접 입력해 주세요.");
    }
    return { blogId: blogId ?? loadSettings().blogId };
  } finally {
    await closeBrowser(session);
  }
}

/** 로그인된 상태에서 본인 블로그 아이디를 추출합니다. */
async function detectBlogId({ page }: Session): Promise<string> {
  // blog.naver.com 루트는 로그인 사용자의 블로그로 리다이렉트됩니다.
  try {
    await page.goto("https://blog.naver.com/", { waitUntil: "domcontentloaded" });
    const fromUrl = page.url().match(/blog\.naver\.com\/([A-Za-z0-9_-]+)/)?.[1];
    if (fromUrl && !["PostList", "MyBlog", "section"].includes(fromUrl)) return fromUrl;
  } catch {
    /* 다음 방법 시도 */
  }

  // 블로그 홈의 '내 블로그' 링크에서 추출합니다.
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded" });
    const href = await page
      .locator('a[href*="blog.naver.com/"]')
      .evaluateAll((els) =>
        els
          .map((el) => (el as HTMLAnchorElement).href)
          .find((h) => /blog\.naver\.com\/[A-Za-z0-9_-]+\/?$/.test(h)),
      )
      .catch(() => undefined);
    const id = href?.match(/blog\.naver\.com\/([A-Za-z0-9_-]+)/)?.[1];
    if (id) return id;
  } catch {
    /* 자동 감지 실패 */
  }
  return "";
}

/** 저장된 세션이 아직 유효한지 확인합니다. */
export async function checkSession(): Promise<boolean> {
  let session: Session | null = null;
  try {
    session = await openBrowser({ headless: true, useSession: true });
    await session.page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });
    return await isLoggedIn(session.context);
  } catch {
    return false;
  } finally {
    await closeBrowser(session);
  }
}
