import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { DEBUG_DIR, SESSION_FILE, loadSettings } from "../config.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function hasSession(): boolean {
  return fs.existsSync(SESSION_FILE);
}

export function clearSession() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

export type Session = { browser: Browser; context: BrowserContext; page: Page };

export async function openBrowser(options: { headless?: boolean; useSession?: boolean } = {}): Promise<Session> {
  const settings = loadSettings();
  const headless = options.headless ?? settings.headless;
  const useSession = options.useSession ?? true;

  const browser = await chromium.launch({
    headless,
    // 시스템에 이미 있는 Chrome/Chromium 을 쓰고 싶을 때 경로를 지정할 수 있습니다.
    executablePath: process.env.NBA_CHROME_PATH || undefined,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 960 },
    storageState: useSession && hasSession() ? SESSION_FILE : undefined,
  });

  // 일반 브라우저와 같은 값(false)을 돌려주도록 해 기본적인 자동화 탐지를 피합니다.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  // tsx(esbuild) 는 keepNames 옵션 때문에 함수를 __name(fn, "이름") 으로 감쌉니다.
  // 그 헬퍼는 Node 쪽에만 있는데 page.evaluate 는 함수 소스를 브라우저에서 실행하므로
  // 브라우저에도 같은 이름의 통과 함수를 심어 두지 않으면 ReferenceError 가 납니다.
  await context.addInitScript(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") g.__name = (fn: unknown) => fn;
  });

  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  return { browser, context, page };
}

export async function saveSession(context: BrowserContext) {
  await context.storageState({ path: SESSION_FILE });
}

export async function closeBrowser(session: Session | null) {
  if (!session) return;
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}

/** 로그인 쿠키가 살아 있는지 확인합니다. */
export async function isLoggedIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.naver.com");
  return cookies.some((c) => (c.name === "NID_AUT" || c.name === "NID_SES") && !!c.value);
}

let shotIndex = 0;
let shotDir = "";

export function startDebugRun(label: string) {
  shotIndex = 0;
  shotDir = path.join(DEBUG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}_${label}`);
}

/** debugShots 설정이 켜져 있을 때만 스크린샷을 남깁니다. 실패해도 흐름을 막지 않습니다. */
export async function shot(page: Page, name: string) {
  if (!loadSettings().debugShots) return;
  try {
    if (!shotDir) startDebugRun("run");
    fs.mkdirSync(shotDir, { recursive: true });
    const file = path.join(shotDir, `${String(++shotIndex).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
  } catch {
    /* 스크린샷 실패는 무시 */
  }
}

/** 사람처럼 한 글자씩 입력합니다. 네이버 에디터는 붙여넣기보다 타이핑에 안정적입니다. */
export async function humanType(page: Page, text: string, perCharMs = 12) {
  await page.keyboard.type(text, { delay: perCharMs + Math.random() * perCharMs });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
