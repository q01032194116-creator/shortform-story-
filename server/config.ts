import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.NBA_DATA_DIR
  ? path.resolve(process.env.NBA_DATA_DIR)
  : path.join(ROOT, "data");

export const SESSION_FILE = path.join(DATA_DIR, "naver-session.json");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const STORE_FILE = path.join(DATA_DIR, "store.json");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const DEBUG_DIR = path.join(DATA_DIR, "debug");

for (const dir of [DATA_DIR, IMAGES_DIR, DEBUG_DIR]) fs.mkdirSync(dir, { recursive: true });

export const PORT = Number(process.env.PORT ?? 8787);

export type Settings = {
  /** 관심 분야 키워드. 자동 실행 시 순서대로 돌아갑니다. */
  keywords: string[];
  /** 네이버 블로그 아이디. 로그인 시 자동 감지되며 비어 있으면 수동 입력이 필요합니다. */
  blogId: string;
  /** 발행할 카테고리 이름. 비우면 기본 카테고리에 발행됩니다. */
  category: string;
  /** 모든 글에 공통으로 붙일 태그. */
  fixedTags: string[];
  visibility: "public" | "private";
  /** 한 글에 넣을 이미지 개수(본문 블록 기준 상한). */
  imagesPerPost: number;
  /** 이미지 한 자리당 후보로 내려받아 AI에게 보여줄 장수. */
  imageCandidates: number;
  /** 본문 최소 글자 수(공백 제외 대략치). */
  minChars: number;
  /** 하루 최대 발행 수 — 계정 보호용 상한. */
  maxPostsPerDay: number;
  /** 발행 간 최소 간격(분) — 계정 보호용. */
  minMinutesBetweenPosts: number;
  /** 수집 시 네이버 뉴스/블로그에서 읽어올 상위 결과 수. */
  sourcesPerKeyword: number;
  /** true면 승인 없이 발행까지 자동으로 진행합니다. */
  autoPublish: boolean;
  /** 발행 자동화를 헤드리스로 돌릴지 여부. 처음에는 false 권장(눈으로 확인). */
  headless: boolean;
  /** 각 단계마다 스크린샷을 data/debug 에 남깁니다. */
  debugShots: boolean;
  /** claude CLI 에 넘길 모델. 비우면 CLI 기본값. */
  claudeModel: string;
  /** claude CLI 호출 타임아웃(초). */
  claudeTimeoutSec: number;
};

export const DEFAULT_SETTINGS: Settings = {
  keywords: [],
  blogId: "",
  category: "",
  fixedTags: [],
  visibility: "public",
  imagesPerPost: 3,
  imageCandidates: 5,
  minChars: 1200,
  maxPostsPerDay: 3,
  minMinutesBetweenPosts: 90,
  sourcesPerKeyword: 8,
  autoPublish: true,
  headless: false,
  debugShots: true,
  claudeModel: "",
  claudeTimeoutSec: 600,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}
