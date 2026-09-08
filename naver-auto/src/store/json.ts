import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Minimal atomic JSON file store.
 *
 * Deliberately not SQLite: this is a single-user local tool writing a handful of
 * records a day, and avoiding native modules (node-gyp) removes the most common
 * Windows install failure.
 */
export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // A truncated file (power loss mid-write) should not brick the app.
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, file);
}
