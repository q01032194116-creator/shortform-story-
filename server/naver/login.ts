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

    const current = loadSettings().blogId.trim();
    const detected = await detectBlogId(session);

    if (current) {
      // 사용자가 직접 넣은 값은 절대 덮어쓰지 않습니다. 자동 감지가 틀릴 수 있기 때문입니다.
      if (detected && detected !== current) {
        log.warn(`자동 감지된 아이디(${detected})가 설정값(${current})과 다릅니다. 설정값을 그대로 씁니다.`);
      }
      log.done(`로그인 완료. 블로그 아이디: ${current}`);
      return { blogId: current };
    }

    if (detected) {
      saveSettings({ blogId: detected });
      log.done(`로그인 완료. 블로그 아이디: ${detected}`);
      return { blogId: detected };
    }

    log.warn("블로그 아이디를 자동으로 찾지 못했습니다. 설정에서 직접 입력해 주세요.");
    return { blogId: "" };
  } finally {
    await closeBrowser(session);
  }
}

/**
 * blog.naver.com 링크에서 블로그 아이디를 엄격하게 추출합니다.
 * section.blog.naver.com/BlogHome.naver 같은 주소에서 "BlogHome" 을 아이디로
 * 잘못 집어내던 문제가 있어, 호스트와 경로 모양을 모두 검사합니다.
 */
export function extractBlogId(href: string): string {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return "";
  }

  // section./m. 같은 하위 도메인은 사용자 블로그 주소가 아닙니다.
  if (parsed.hostname !== "blog.naver.com") return "";

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return "";

  const id = segments[0]!;
  // PostList.naver 처럼 확장자가 붙은 네이버 내부 페이지를 걸러냅니다.
  if (id.includes(".")) return "";
  if (RESERVED_PATHS.has(id.toLowerCase())) return "";
  // 네이버 아이디 규칙: 영문으로 시작, 영숫자/_/- 조합 3~20자
  if (!/^[A-Za-z][A-Za-z0-9_-]{2,19}$/.test(id)) return "";

  return id;
}

const RESERVED_PATHS = new Set(
  [
    "postlist", "postview", "bloghome", "myblog", "section", "prologue", "goblog",
    "nblogmain", "blogtopview", "postwriteform", "rabbitwrite", "guestbook",
    "widget", "blogmain", "recommend", "search", "mylog", "admin",
  ].map((s) => s.toLowerCase()),
);

/**
 * 로그인된 상태에서 본인 블로그 아이디를 추출합니다.
 * 확신할 수 없으면 빈 문자열을 돌려줍니다 — 틀린 값을 저장하는 것보다 낫습니다.
 */
async function detectBlogId({ page }: Session): Promise<string> {
  // blog.naver.com 루트와 MyBlog.naver 는 로그인 사용자의 블로그로 리다이렉트됩니다.
  for (const entry of ["https://blog.naver.com/", "https://blog.naver.com/MyBlog.naver"]) {
    try {
      await page.goto(entry, { waitUntil: "domcontentloaded" });
      const id = extractBlogId(page.url());
      if (id) return id;
    } catch {
      /* 다음 방법 시도 */
    }
  }

  // 블로그 홈 상단의 "내 블로그" 링크에서만 찾습니다.
  // 피드에 있는 남의 블로그 링크를 주워오지 않도록 링크 문구를 한정합니다.
  try {
    await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded" });
    const hrefs = await page
      .locator('a:has-text("내 블로그"), a[title*="내 블로그"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const id = extractBlogId(href);
      if (id) return id;
    }
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
