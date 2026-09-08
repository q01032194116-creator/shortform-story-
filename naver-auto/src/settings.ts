import type { Settings } from "./types.js";
import { PATHS } from "./paths.js";
import { readJson, writeJson } from "./store/json.js";

export const DEFAULT_SETTINGS: Settings = {
  keywords: [],
  publishMode: "auto",
  dailyLimit: 3,
  minIntervalMinutes: 30,
  visibility: "public",
  categoryName: null,
  headful: true,
  models: { rank: "sonnet", write: "opus", vision: "sonnet" },
  formatting: {
    bodyFontSize: 16,
    align: "left",
    headingStyle: "quote",
    dividerBetweenSections: true,
    imagesPerPost: 3,
    tagCount: 10,
  },
  pexelsKey: "",
  unsplashKey: "",
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;

/**
 * Drop anything that is not a real setting.
 *
 * The dashboard round-trips the redacted view, which carries presentation flags
 * like hasPexelsKey. Filtering on both load and save means a file that already
 * picked up such keys heals itself on the next write instead of carrying them
 * forever.
 */
function pickKnown(source: Partial<Settings>): Partial<Settings> {
  const clean: Partial<Settings> = {};
  for (const key of SETTING_KEYS) {
    if (source[key] !== undefined) (clean as Record<string, unknown>)[key] = source[key];
  }
  return clean;
}

export function loadSettings(): Settings {
  const stored = pickKnown(readJson<Partial<Settings>>(PATHS.settings, {}));
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    models: { ...DEFAULT_SETTINGS.models, ...stored.models },
    formatting: { ...DEFAULT_SETTINGS.formatting, ...stored.formatting },
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...pickKnown(patch) };
  writeJson(PATHS.settings, next);
  return next;
}

/** Keys never leave the machine, but also should never reach the dashboard twice. */
export function redactSettings(settings: Settings): Settings & { hasPexelsKey: boolean; hasUnsplashKey: boolean } {
  return {
    ...settings,
    pexelsKey: settings.pexelsKey ? "••••••••" : "",
    unsplashKey: settings.unsplashKey ? "••••••••" : "",
    hasPexelsKey: Boolean(settings.pexelsKey),
    hasUnsplashKey: Boolean(settings.unsplashKey),
  };
}
