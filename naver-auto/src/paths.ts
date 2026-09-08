import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

/** Project root (the `naver-auto/` directory). */
export const ROOT = resolve(here, "..");

/**
 * Everything the app writes at runtime lives under `data/` and is gitignored.
 * NAVER_AUTO_DATA redirects it, which is how the tests get a scratch store.
 */
export const DATA = process.env.NAVER_AUTO_DATA
  ? resolve(process.env.NAVER_AUTO_DATA)
  : resolve(ROOT, "data");

export const PATHS = {
  data: DATA,
  settings: resolve(DATA, "settings.json"),
  db: resolve(DATA, "db.json"),
  /** Persistent Chromium profile for the logged-in Naver account. */
  naverProfile: resolve(DATA, "naver-profile"),
  session: resolve(DATA, "session"),
  storageState: resolve(DATA, "session", "naver-state.json"),
  images: resolve(DATA, "images"),
  logs: resolve(DATA, "logs"),
  /** Screenshots + HTML dumps written when a selector fails. */
  debug: resolve(DATA, "debug"),
  fixtures: resolve(ROOT, "tests", "fixtures"),
} as const;

export function ensureDirs(): void {
  for (const dir of [PATHS.data, PATHS.session, PATHS.images, PATHS.logs, PATHS.debug]) {
    mkdirSync(dir, { recursive: true });
  }
}
