import { useCallback, useEffect, useState } from "react";
import type { Post, PublishRecord, Settings, Topic } from "../../src/types";
import { api, type Status } from "./api";
import { useEvents } from "./useEvents";
import { LogPanel } from "./components/LogPanel";
import { Preview } from "./components/Preview";

type Tab = "run" | "topics" | "post" | "history" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "run", label: "실행" },
  { id: "topics", label: "글감" },
  { id: "post", label: "초안 · 이미지" },
  { id: "history", label: "히스토리" },
  { id: "settings", label: "설정" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("run");
  const [status, setStatus] = useState<Status | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [history, setHistory] = useState<PublishRecord[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [current, setCurrent] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void api.status().then(setStatus).catch(() => {});
    void api.posts().then((list) => {
      setPosts(list);
      setCurrent((prev) => (prev ? list.find((p) => p.id === prev.id) ?? prev : list[0] ?? null));
    });
    void api.history().then(setHistory).catch(() => {});
  }, []);

  const lines = useEvents(refresh);
  useEffect(refresh, [refresh]);

  const busy = status?.job.running ?? false;
  const call = async <T,>(fn: () => Promise<T>, after?: (value: T) => void) => {
    setError(null);
    try {
      after?.(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refresh();
    }
  };

  return (
    <div className="app">
      <nav className="nav">
        <h1>네이버 블로그 자동화</h1>
        <p className="sub">Claude 구독 · Playwright</p>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="main">
        <div className="content">
          {tab === "run" && (
            <RunTab status={status} busy={busy} call={call} setTopics={setTopics} setTab={setTab} setCurrent={setCurrent} />
          )}
          {tab === "topics" && <TopicsTab topics={topics} busy={busy} call={call} setTab={setTab} setCurrent={setCurrent} />}
          {tab === "post" && <PostTab post={current} posts={posts} busy={busy} call={call} onSelect={setCurrent} />}
          {tab === "history" && <HistoryTab history={history} />}
          {tab === "settings" && <SettingsTab status={status} call={call} />}
          {error && <div className="err">⚠ {error}</div>}
        </div>
        <LogPanel lines={lines} />
      </div>
    </div>
  );
}

type Call = <T,>(fn: () => Promise<T>, after?: (value: T) => void) => Promise<void>;

/* ------------------------------------------------------------------ 실행 */

function RunTab({
  status,
  busy,
  call,
  setTopics,
  setTab,
  setCurrent,
}: {
  status: Status | null;
  busy: boolean;
  call: Call;
  setTopics: (t: Topic[]) => void;
  setTab: (t: Tab) => void;
  setCurrent: (p: Post) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const account = status?.account;
  const settings = status?.settings;
  const profileBusy = status?.profileBusy ?? null;
  const ready = Boolean(account?.loggedIn && keyword.trim() && !busy && !profileBusy);

  return (
    <>
      <h2>실행</h2>
      <p className="hint">
        키워드 하나로 수집 → 글감 선정 → 본문 작성 → 이미지 판정 → 에디터 입력 → 발행까지 진행합니다.
      </p>

      <div className="card">
        <h3>네이버 계정</h3>
        <div className="row">
          {account?.loggedIn ? (
            <>
              <span className="pill ok">로그인됨</span>
              <span className="grow">
                {account.blogId ? `블로그 ID: ${account.blogId}` : "블로그 ID 확인 실패"}
                {account.nickname ? ` · ${account.nickname}` : ""}
              </span>
              <button
                className="btn ghost small"
                disabled={Boolean(profileBusy)}
                onClick={() => void call(api.naverStatus)}
              >
                세션 확인
              </button>
              <button
                className="btn ghost small"
                disabled={Boolean(profileBusy)}
                onClick={() => void call(api.naverLogout)}
              >
                로그아웃
              </button>
            </>
          ) : (
            <>
              <span className="pill bad">로그인 필요</span>
              <span className="grow">버튼을 누르면 네이버 로그인 창이 열립니다. 아이디·비밀번호는 저장하지 않습니다.</span>
              <button className="btn" disabled={Boolean(profileBusy)} onClick={() => void call(api.naverLogin)}>
                {profileBusy === "login" ? "로그인 창 확인" : "네이버 로그인"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3>전자동 실행</h3>
        <div className="row">
          <input
            className="grow"
            type="text"
            placeholder="관심 분야 키워드 (예: 전기차 보조금)"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ready) void call(() => api.run(keyword.trim()), (p) => { setCurrent(p); setTab("post"); });
            }}
          />
          <button
            className="btn"
            disabled={!ready}
            onClick={() => void call(() => api.run(keyword.trim()), (p) => { setCurrent(p); setTab("post"); })}
          >
            {settings?.publishMode === "auto" ? "수집 → 작성 → 발행" : "수집 → 작성 → 임시저장"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn ghost small"
            disabled={!keyword.trim() || busy}
            onClick={() => void call(() => api.collect(keyword.trim()), (r) => { setTopics(r.topics); setTab("topics"); })}
          >
            글감만 찾기
          </button>
          <button
            className="btn ghost small"
            disabled={!keyword.trim() || busy}
            onClick={() => void call(() => api.draft(keyword.trim()), (p) => { setCurrent(p); setTab("post"); })}
          >
            초안까지만 (발행 안 함)
          </button>
        </div>
        {busy && <p className="hint" style={{ marginTop: 12 }}>진행 중… 아래 로그를 확인하세요. (전체 3~6분)</p>}
        {profileBusy === "login" && (
          <p className="hint" style={{ marginTop: 12 }}>
            로그인 창이 열려 있습니다. 창에서 로그인을 마쳐야 다음 작업을 시작할 수 있습니다.
          </p>
        )}
      </div>

      <div className="card">
        <h3>상태</h3>
        <div className="row">
          <span className={`pill ${settings?.publishMode === "auto" ? "warn" : ""}`}>
            {settings?.publishMode === "auto" ? "완전 자동 발행" : "임시저장만"}
          </span>
          <span className={`pill ${status?.rateLimit.ok ? "ok" : "bad"}`}>
            {status?.rateLimit.ok ? `하루 ${settings?.dailyLimit}건 한도 내` : status?.rateLimit.reason}
          </span>
          <span className={`pill ${settings?.hasPexelsKey || settings?.hasUnsplashKey ? "ok" : "warn"}`}>
            {settings?.hasPexelsKey || settings?.hasUnsplashKey ? "이미지 API 설정됨" : "이미지 API 키 없음"}
          </span>
        </div>
        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>Claude CLI: {status?.claude}</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 글감 */

function TopicsTab({
  topics,
  busy,
  call,
  setTab,
  setCurrent,
}: {
  topics: Topic[];
  busy: boolean;
  call: Call;
  setTab: (t: Tab) => void;
  setCurrent: (p: Post) => void;
}) {
  return (
    <>
      <h2>글감</h2>
      <p className="hint">AI가 수집한 뉴스·인기 블로그를 근거로 고른 글감입니다.</p>
      {topics.length === 0 && <div className="card">아직 없습니다. 실행 탭에서 “글감만 찾기”를 눌러 주세요.</div>}
      {topics.map((topic) => (
        <div className="card" key={topic.id}>
          <div className="topic">
            <div className="t">
              [{topic.score}점] {topic.title}
            </div>
            <div className="m">각도: {topic.angle}</div>
            <div className="m">지금 쓰는 이유: {topic.whyNow}</div>
            <div className="m">
              검색어: {topic.targetKeyword} · 근거 {topic.sourceIds.length}건 · {topic.competitionNote}
            </div>
          </div>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              void call(() => api.draft(topic.targetKeyword, topic), (p) => {
                setCurrent(p);
                setTab("post");
              })
            }
          >
            이 글감으로 초안 작성
          </button>
        </div>
      ))}
    </>
  );
}

/* ---------------------------------------------------------- 초안 · 이미지 */

function PostTab({
  post,
  posts,
  busy,
  call,
  onSelect,
}: {
  post: Post | null;
  posts: Post[];
  busy: boolean;
  call: Call;
  onSelect: (p: Post) => void;
}) {
  if (!post) return <div className="card">작성된 초안이 없습니다.</div>;

  return (
    <>
      <h2>초안 · 이미지</h2>
      <div className="card">
        <div className="row">
          <select
            className="grow"
            value={post.id}
            onChange={(e) => {
              const next = posts.find((p) => p.id === e.target.value);
              if (next) onSelect(next);
            }}
          >
            {posts.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.status}] {p.title}
              </option>
            ))}
          </select>
          <span className={`pill ${post.status === "published" ? "ok" : post.status === "failed" ? "bad" : ""}`}>
            {post.status}
          </span>
          <button className="btn" disabled={busy} onClick={() => void call(() => api.publish(post.id))}>
            네이버에 올리기
          </button>
        </div>
        {post.publishedUrl && (
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
            발행됨: <a href={post.publishedUrl} target="_blank" rel="noreferrer">{post.publishedUrl}</a>
          </p>
        )}
        {post.error && <div className="err">{post.error}</div>}
      </div>

      {post.slots.map((slot) => (
        <div className="card" key={slot.slotId}>
          <h3>
            이미지 {slot.slotId} — {slot.hint} {slot.unresolved && <span className="pill bad">미해결</span>}
          </h3>
          <p className="hint">검색어: {slot.queries.join(", ") || "-"}</p>
          <div className="cands">
            {slot.candidates.map((c) => (
              <div key={c.id} className={`cand ${c.id === slot.chosenId ? "on" : ""}`}>
                {c.filePath && (
                  <img src={`/images/${post.id}/${c.filePath.split(/[\\/]/).pop()}`} alt={c.altText ?? ""} />
                )}
                <div className="b">
                  <div className="s">
                    {c.score ?? "-"}점 {c.fits ? "· 적합" : "· 부적합"}
                  </div>
                  <div>{c.reason}</div>
                  <button
                    className="btn ghost small"
                    style={{ marginTop: 6 }}
                    disabled={busy || c.id === slot.chosenId}
                    onClick={() => void call(() => api.chooseImage(post.id, slot.slotId, c.id))}
                  >
                    {c.id === slot.chosenId ? "선택됨" : "이걸로 교체"}
                  </button>
                </div>
              </div>
            ))}
            {slot.candidates.length === 0 && <p className="hint">후보가 없습니다. 설정에서 이미지 API 키를 확인하세요.</p>}
          </div>
        </div>
      ))}

      <div className="card">
        <h3>미리보기</h3>
        <Preview post={post} />
      </div>
    </>
  );
}

/* --------------------------------------------------------------- 히스토리 */

function HistoryTab({ history }: { history: PublishRecord[] }) {
  return (
    <>
      <h2>히스토리</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>시각</th>
              <th>키워드</th>
              <th>제목</th>
              <th>방식</th>
              <th>링크</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.at).toLocaleString("ko-KR")}</td>
                <td>{r.keyword}</td>
                <td>{r.title}</td>
                <td>{r.mode === "auto" ? "발행" : "임시저장"}</td>
                <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">열기</a> : "-"}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={5}>아직 기록이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ 설정 */

function SettingsTab({ status, call }: { status: Status | null; call: Call }) {
  const [form, setForm] = useState<Partial<Settings> | null>(null);
  useEffect(() => {
    if (status?.settings && !form) setForm(status.settings);
  }, [status, form]);
  if (!form) return null;

  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });
  const setFmt = (patch: Partial<Settings["formatting"]>) =>
    setForm({ ...form, formatting: { ...form.formatting!, ...patch } });

  return (
    <>
      <h2>설정</h2>
      <p className="hint">모든 값은 이 PC의 data/settings.json 에만 저장됩니다.</p>

      <div className="card">
        <h3>발행</h3>
        <label>발행 방식</label>
        <select value={form.publishMode} onChange={(e) => set({ publishMode: e.target.value as Settings["publishMode"] })}>
          <option value="auto">완전 자동 발행</option>
          <option value="draft">임시저장만 (확인 후 수동 발행)</option>
        </select>
        <label>하루 발행 상한 (0 = 무제한)</label>
        <input type="number" value={form.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} />
        <label>발행 간 최소 간격 (분)</label>
        <input
          type="number"
          value={form.minIntervalMinutes}
          onChange={(e) => set({ minIntervalMinutes: Number(e.target.value) })}
        />
        <label>공개 범위</label>
        <select value={form.visibility} onChange={(e) => set({ visibility: e.target.value as Settings["visibility"] })}>
          <option value="public">전체 공개</option>
          <option value="private">비공개</option>
        </select>
        <label>카테고리 이름 (비우면 기본 카테고리)</label>
        <input type="text" value={form.categoryName ?? ""} onChange={(e) => set({ categoryName: e.target.value || null })} />
        <label>
          <input
            type="checkbox"
            checked={form.headful}
            onChange={(e) => set({ headful: e.target.checked })}
            style={{ width: "auto", marginRight: 8 }}
          />
          글 쓰는 브라우저 창 보이기 (문제 파악에 유리)
        </label>
      </div>

      <div className="card">
        <h3>가독성 서식</h3>
        <label>소제목 스타일</label>
        <select
          value={form.formatting!.headingStyle}
          onChange={(e) => setFmt({ headingStyle: e.target.value as "quote" | "bold" })}
        >
          <option value="quote">인용구 (네이버에서 가장 잘 읽힘)</option>
          <option value="bold">일반 텍스트</option>
        </select>
        <label>글당 이미지 개수</label>
        <input
          type="number"
          value={form.formatting!.imagesPerPost}
          onChange={(e) => setFmt({ imagesPerPost: Number(e.target.value) })}
        />
        <label>태그 개수</label>
        <input
          type="number"
          value={form.formatting!.tagCount}
          onChange={(e) => setFmt({ tagCount: Number(e.target.value) })}
        />
        <label>
          <input
            type="checkbox"
            checked={form.formatting!.dividerBetweenSections}
            onChange={(e) => setFmt({ dividerBetweenSections: e.target.checked })}
            style={{ width: "auto", marginRight: 8 }}
          />
          섹션 사이에 구분선 넣기
        </label>
      </div>

      <div className="card">
        <h3>이미지 API 키</h3>
        <p className="hint">
          pexels.com/api 와 unsplash.com/developers 에서 무료로 발급받습니다. 하나만 넣어도 동작합니다.
        </p>
        <label>Pexels API Key</label>
        <input type="password" value={form.pexelsKey ?? ""} onChange={(e) => set({ pexelsKey: e.target.value })} />
        <label>Unsplash Access Key</label>
        <input type="password" value={form.unsplashKey ?? ""} onChange={(e) => set({ unsplashKey: e.target.value })} />
      </div>

      <div className="card">
        <h3>AI 모델</h3>
        <p className="hint">claude -p 로 호출합니다. 구독 요금제로 동작하며 API 키는 필요 없습니다.</p>
        <label>글감 선정</label>
        <input type="text" value={form.models!.rank} onChange={(e) => set({ models: { ...form.models!, rank: e.target.value } })} />
        <label>본문 작성</label>
        <input type="text" value={form.models!.write} onChange={(e) => set({ models: { ...form.models!, write: e.target.value } })} />
        <label>이미지 판정</label>
        <input type="text" value={form.models!.vision} onChange={(e) => set({ models: { ...form.models!, vision: e.target.value } })} />
      </div>

      <button className="btn" onClick={() => void call(() => api.saveSettings(form))}>
        설정 저장
      </button>
    </>
  );
}
