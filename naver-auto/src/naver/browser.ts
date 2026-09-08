import { existsSync, rmSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { PATHS, ensureDirs } from "../paths.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * The logged-in Naver browser.
 *
 * Uses a persistent profile rather than storageState alone: Naver treats a
 * stable profile as a known device, which avoids the "new device login" checks
 * that would otherwise interrupt every automated run.
 */
export async function naverContext(headless: boolean): Promise<BrowserContext> {
  ensureDirs();
  const proxyServer = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  return chromium.launchPersistentContext(PATHS.naverProfile, {
    headless,
    proxy: proxyServer ? { server: proxyServer } : undefined,
    ignoreHTTPSErrors: Boolean(proxyServer),
    userAgent: UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: headless ? { width: 1440, height: 960 } : null,
    args: [
      // Naver's login page reacts badly to obvious automation fingerprints.
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
    ],
  });
}

export function clearProfile(): void {
  for (const target of [PATHS.naverProfile, PATHS.storageState]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

/** Random human-scale pause. Used between editor actions. */
export function pause(minMs: number, maxMs: number): Promise<void> {
  return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

let profileLock: Promise<unknown> = Promise.resolve();
let holder: string | null = null;

/** Who currently owns the Naver profile, if anyone. */
export function profileHolder(): string | null {
  return holder;
}

/**
 * Serialise every use of the Naver profile.
 *
 * Chromium does not refuse a second instance on the same user-data-dir, which
 * is worse than refusing: cookies written by a live window are not on disk yet,
 * so a concurrent session check reads a half-written profile, concludes the
 * user is logged out, and overwrites good account state. One owner at a time
 * removes that whole class of bug.
 */
export function withProfile<T>(owner: string, fn: () => Promise<T>): Promise<T> {
  const run = profileLock.then(async () => {
    holder = owner;
    try {
      return await fn();
    } finally {
      holder = null;
    }
  });
  // Keep the chain alive even when this task rejects.
  profileLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
