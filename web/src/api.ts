export type Settings = {
  keywords: string[];
  blogId: string;
  category: string;
  fixedTags: string[];
  visibility: "public" | "private";
  imagesPerPost: number;
  imageCandidates: number;
  minChars: number;
  maxPostsPerDay: number;
  minMinutesBetweenPosts: number;
  sourcesPerKeyword: number;
  autoPublish: boolean;
  headless: boolean;
  debugShots: boolean;
  claudeModel: string;
  claudeTimeoutSec: number;
};

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "divider" }
  | { type: "image"; query: string; need: string; caption: string; file?: string; sourceUrl?: string; verdict?: string };

export type Draft = {
  id: string;
  keyword: string;
  title: string;
  tags: string[];
  blocks: Block[];
  sourceUrls: string[];
  createdAt: string;
  status: "draft" | "images-ready" | "published" | "failed";
  publishedAt?: string;
  postUrl?: string;
  error?: string;
};

export type Topic = {
  id: string;
  keyword: string;
  title: string;
  angle: string;
  why: string;
  outline: string[];
  createdAt: string;
  usedAt?: string;
};

export type LogEvent = { at: string; level: string; scope: string; message: string };

export type Status = {
  hasSession: boolean;
  busy: boolean;
  busyLabel: string;
  settings: Settings;
  publishedToday: number;
  limitMessage: string | null;
  logs: LogEvent[];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const payload = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(payload.error ?? "알 수 없는 오류");
  return payload.data as T;
}

const post = <T,>(url: string, body?: unknown) =>
  call<T>(url, { method: "POST", body: body ? JSON.stringify(body) : undefined });

export const api = {
  status: () => call<Status>("/api/status"),
  saveSettings: (patch: Partial<Settings>) => post<Settings>("/api/settings", patch),
  login: () => post<{ blogId: string }>("/api/naver/login"),
  logout: () => post<{ cleared: boolean }>("/api/naver/logout"),
  checkSession: () => call<{ valid: boolean }>("/api/naver/check"),
  run: (keyword: string) => post<Draft>("/api/run", { keyword }),
  findTopics: (keyword: string) => post<Topic[]>("/api/topics", { keyword }),
  draftFromTopic: (topicId: string) => post<Draft>("/api/draft", { topicId }),
  publish: (draftId: string) => post<Draft>("/api/publish", { draftId }),
  topics: () => call<Topic[]>("/api/topics"),
  drafts: () => call<Draft[]>("/api/drafts"),
};

export const imageUrl = (file: string) => `/files/image?path=${encodeURIComponent(file)}`;
