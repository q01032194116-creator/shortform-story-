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
