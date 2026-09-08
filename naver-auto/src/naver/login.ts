import type { BrowserContext } from "playwright";
import type { NaverAccount } from "../types.js";
import { PATHS } from "../paths.js";
import { setAccount } from "../store/db.js";
import { naverContext, withProfile } from "./browser.js";
import { hasLoginCookies, readBlogIdentity } from "./session.js";

const LOGIN_URL = "https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com";
const POLL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export type Reporter = (message: string) => void;

let inFlight: Promise<NaverAccount> | null = null;

/**
 * Open a real browser window and let the user sign in themselves.
 *
 * We never receive, type, or store the ID and password: the user types them
 * into Naver's own page. That keeps credentials out of this app entirely and
 * avoids the bot detection that scripted credential entry triggers.
 */
async function runLogin(report: Reporter, timeoutMs: number): Promise<NaverAccount> {
  let context: BrowserContext | null = null;
  try {
    report("로그인 창을 여는 중…");
    context = await naverContext(false);

    if (await hasLoginCookies(context)) {
      report("이미 로그인되어 있습니다. 세션을 갱신합니다.");
    } else {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      report("열린 창에서 네이버에 로그인해 주세요. (아이디·비밀번호는 저장하지 않습니다)");

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await hasLoginCookies(context)) break;
        if (context.pages().length === 0) throw new Error("로그인 창이 닫혔습니다.");
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      if (!(await hasLoginCookies(context))) {
        throw new Error("제한 시간 안에 로그인이 완료되지 않았습니다.");
      }
    }

    report("로그인 확인됨. 블로그 정보를 읽는 중…");
    const identity = await readBlogIdentity(context);
    await context.storageState({ path: PATHS.storageState });

    const account: NaverAccount = {
      loggedIn: true,
      blogId: identity.blogId,
      nickname: identity.nickname,
      checkedAt: new Date().toISOString(),
    };
    setAccount(account);
    report(`로그인 완료${account.blogId ? ` (블로그 ID: ${account.blogId})` : ""}`);
    return account;
  } finally {
    // Closing the context is what flushes the persistent profile to disk.
    await context?.close().catch(() => {});
  }
}

/** Only one login window at a time. */
export function login(report: Reporter = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<NaverAccount> {
  if (inFlight) return inFlight;
  inFlight = withProfile("login", () => runLogin(report, timeoutMs)).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function loginInProgress(): boolean {
  return inFlight !== null;
}
