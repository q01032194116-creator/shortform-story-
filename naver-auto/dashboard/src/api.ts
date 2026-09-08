import type { NaverAccount, Post, PublishRecord, Settings, Topic } from "../../src/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.error ?? `요청 실패 (${response.status})`);
  return body as T;
}

export interface JobState {
  id: string | null;
  name: string | null;
  running: boolean;
  startedAt: string | null;
  error: string | null;
}

export interface Status {
  job: JobState;
  account: NaverAccount;
  settings: Settings & { hasPexelsKey: boolean; hasUnsplashKey: boolean };
  claude: string;
  rateLimit: { ok: boolean; reason: string };
  loginInProgress: boolean;
}

export const api = {
  status: () => request<Status>("/status"),
  saveSettings: (patch: Partial<Settings>) =>
    request<Status["settings"]>("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  naverLogin: () => request<{ started: boolean }>("/naver/login", { method: "POST" }),
  naverStatus: () => request<NaverAccount>("/naver/status"),
  naverLogout: () => request<NaverAccount>("/naver/logout", { method: "POST" }),
  collect: (keyword: string) =>
    request<{ topics: Topic[]; notes: string[] }>("/collect", { method: "POST", body: JSON.stringify({ keyword }) }),
  draft: (keyword: string, topic?: Topic) =>
    request<Post>("/draft", { method: "POST", body: JSON.stringify({ keyword, topic }) }),
  run: (keyword: string) => request<Post>("/run", { method: "POST", body: JSON.stringify({ keyword }) }),
  posts: () => request<Post[]>("/posts"),
  post: (id: string) => request<Post>(`/posts/${id}`),
  publish: (id: string) => request<Post>(`/posts/${id}/publish`, { method: "POST" }),
  chooseImage: (postId: string, slotId: string, candidateId: string) =>
    request<Post>(`/posts/${postId}/slots/${slotId}/choose`, {
      method: "POST",
      body: JSON.stringify({ candidateId }),
    }),
  history: () => request<PublishRecord[]>("/history"),
};
