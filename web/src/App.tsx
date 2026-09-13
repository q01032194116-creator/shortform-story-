import { useCallback, useEffect, useRef, useState } from "react";
import { api, imageUrl, type Draft, type LogEvent, type Settings, type Status, type Topic } from "./api";

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      // 서버가 가진 로그로 갈아끼웁니다. 재연결 시 화면에 남은 옛 로그를 치우기 위함입니다.
      setLogs(next.logs);
      if (!keyword && next.settings.keywords[0]) setKeyword(next.settings.keywords[0]);
      setTopics(await api.topics());
      setDrafts(await api.drafts());
      setConnected(true);
      return true;
    } catch (err) {
      // fetch 자체가 실패하면 서버가 안 떠 있는 것입니다. 앱 오류와 구분해서 다룹니다.
      if (err instanceof TypeError) setConnected(false);
      else setError((err as Error).message);
      return false;
    }
  }, [keyword]);

  useEffect(() => {
    void refresh();
    // 서버가 흘려보내는 진행 상황을 실시간으로 받습니다.
    const source = new EventSource("/api/events");
    source.addEventListener("open", () => {
      setConnected(true);
      void refresh();
    });
    source.addEventListener("log", (e) => {
      setLogs((prev) => [...prev, JSON.parse((e as MessageEvent).data) as LogEvent].slice(-400));
    });
    source.addEventListener("state", (e) => {
      const state = JSON.parse((e as MessageEvent).data) as { busy: boolean; label: string };
      setStatus((prev) => (prev ? { ...prev, busy: state.busy, busyLabel: state.label } : prev));
      if (!state.busy) void refresh();
    });
    // EventSource 는 스스로 재접속하지만, 끊긴 동안은 화면에 그 사실을 알려 줍니다.
    source.addEventListener("error", () => setConnected(false));

    // 서버가 꺼졌다 켜지면 알아서 복구되도록 주기적으로 확인합니다.
    const poll = setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      source.close();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guard = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      void refresh();
    }
  };

  if (!status) {
    return (
      <div className="app">
        {connected ? <p className="muted">서버에 연결하는 중...</p> : <Disconnected />}
      </div>
    );
  }

  const busy = status.busy;

  return (
    <div className="app">
      <header className="top">
        <h1>
          네이버 블로그 <span>오토파일럿</span>
        </h1>
        <div className="inline">
          <span className={`pill ${status.hasSession ? "on" : "off"}`}>
            <i className="dot" />
            {status.hasSession ? "네이버 로그인됨" : "로그인 필요"}
          </span>
          {status.hasSession ? (
            <button className="ghost small" disabled={busy} onClick={() => guard(api.logout)}>
              세션 삭제
            </button>
          ) : null}
          <button className="primary" disabled={busy} onClick={() => guard(api.login)}>
            {status.hasSession ? "다시 로그인" : "네이버 로그인"}
          </button>
        </div>
      </header>

      {!connected ? <Disconnected /> : null}
      {connected && error ? <div className="banner error">{error}</div> : null}
      {status.limitMessage ? <div className="banner warn">{status.limitMessage}</div> : null}
      {busy ? <div className="banner warn">실행 중: {status.busyLabel}</div> : null}

      <div className="grid">
        <div>
          <RunCard
            keyword={keyword}
            setKeyword={setKeyword}
            settings={status.settings}
            busy={busy}
            hasSession={status.hasSession}
            publishedToday={status.publishedToday}
            onRun={() => guard(() => api.run(keyword))}
            onTopics={() => guard(() => api.findTopics(keyword))}
          />
          <Console logs={logs} />
          <TopicList topics={topics} busy={busy} onDraft={(id) => guard(() => api.draftFromTopic(id))} />
        </div>

        <div>
          <SettingsCard settings={status.settings} busy={busy} onSave={(patch) => guard(() => api.saveSettings(patch))} />
          <DraftList
            drafts={drafts}
            busy={busy}
            openId={openDraft}
            onToggle={(id) => setOpenDraft((prev) => (prev === id ? null : id))}
            onPublish={(id) => guard(() => api.publish(id))}
          />
        </div>
      </div>
    </div>
  );
}

/** 서버가 안 떠 있을 때. "Failed to fetch" 만으로는 무엇을 해야 할지 알 수 없습니다. */
function Disconnected() {
  return (
    <div className="banner error">
      <strong>서버에 연결할 수 없습니다.</strong>
      <div style={{ marginTop: 6, lineHeight: 1.7 }}>
        앱을 실행한 터미널이 꺼졌거나 서버가 멈췄습니다. 터미널에서 <code>npm run dev</code> 가
        돌고 있는지 확인하세요. 터미널에 오류가 찍혀 있다면 그 내용이 원인입니다.
        <br />
        서버가 다시 뜨면 이 화면은 자동으로 복구됩니다.
      </div>
    </div>
  );
}

function RunCard(props: {
  keyword: string;
  setKeyword: (v: string) => void;
  settings: Settings;
  busy: boolean;
  hasSession: boolean;
  publishedToday: number;
  onRun: () => void;
  onTopics: () => void;
}) {
  const { settings } = props;
  return (
    <div className="card">
      <h2>자동 실행</h2>
      <label className="field">
        <span>관심 분야 키워드</span>
        <input
          value={props.keyword}
          placeholder="예: 캠핑 장비, 서울 맛집, 국내 주식"
          onChange={(e) => props.setKeyword(e.target.value)}
        />
      </label>
      <div className="row">
        <button className="primary" disabled={props.busy || !props.keyword.trim()} onClick={props.onRun}>
          {settings.autoPublish ? "수집 → 작성 → 이미지 → 발행" : "수집 → 작성 → 이미지 (발행 제외)"}
        </button>
        <button disabled={props.busy || !props.keyword.trim()} onClick={props.onTopics}>
          글감만 찾기
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: 12 }}>
        오늘 {props.publishedToday}/{settings.maxPostsPerDay}개 발행 · 최소 간격 {settings.minMinutesBetweenPosts}분
        {props.hasSession ? "" : " · 발행하려면 먼저 네이버에 로그인하세요"}
      </p>
    </div>
  );
}

function Console({ logs }: { logs: LogEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs]);

  return (
    <div className="card">
      <h2>진행 상황</h2>
      <div className="console" ref={ref}>
        {logs.length === 0 ? <span className="muted">아직 로그가 없습니다.</span> : null}
        {logs.map((entry, i) => (
          <div className="line" key={`${entry.at}-${i}`}>
            <span className="scope">{entry.scope}</span>
            <span className={entry.level}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopicList({ topics, busy, onDraft }: { topics: Topic[]; busy: boolean; onDraft: (id: string) => void }) {
  if (topics.length === 0) return null;
  return (
    <div className="card">
      <h2>추천 글감</h2>
      {topics.slice(0, 12).map((topic) => (
        <div className="item" key={topic.id}>
          <h3>{topic.title}</h3>
          <div className="meta">
            {topic.keyword} · {new Date(topic.createdAt).toLocaleString("ko-KR")}
            {topic.usedAt ? " · 사용함" : ""}
          </div>
          <div className="why">{topic.angle}</div>
          <div className="why">💡 {topic.why}</div>
          <div style={{ marginTop: 10 }}>
            <button className="small" disabled={busy} onClick={() => onDraft(topic.id)}>
              이 글감으로 초안 작성
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftList(props: {
  drafts: Draft[];
  busy: boolean;
  openId: string | null;
  onToggle: (id: string) => void;
  onPublish: (id: string) => void;
}) {
  return (
    <div className="card">
      <h2>작성된 글</h2>
      {props.drafts.length === 0 ? <p className="muted">아직 없습니다.</p> : null}
      {props.drafts.map((draft) => (
        <div className="item" key={draft.id}>
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h3 style={{ flex: 1 }}>{draft.title}</h3>
            <span className={`status-tag ${draft.status}`}>{statusLabel(draft.status)}</span>
          </div>
          <div className="meta">
            {draft.keyword} · {new Date(draft.createdAt).toLocaleString("ko-KR")}
          </div>
          {draft.error ? <div className="banner error" style={{ marginTop: 8 }}>{draft.error}</div> : null}
          {draft.postUrl ? (
            <div className="meta" style={{ marginTop: 6 }}>
              <a href={draft.postUrl} target="_blank" rel="noreferrer">{draft.postUrl}</a>
            </div>
          ) : null}
          <div className="inline" style={{ marginTop: 10 }}>
            <button className="small ghost" onClick={() => props.onToggle(draft.id)}>
              {props.openId === draft.id ? "미리보기 닫기" : "미리보기"}
            </button>
            {draft.status !== "published" ? (
              <button className="small" disabled={props.busy} onClick={() => props.onPublish(draft.id)}>
                지금 발행
              </button>
            ) : null}
          </div>
          {props.openId === draft.id ? <Preview draft={draft} /> : null}
        </div>
      ))}
    </div>
  );
}

function statusLabel(status: Draft["status"]) {
  return { draft: "초안", "images-ready": "이미지 완료", published: "발행됨", failed: "실패" }[status];
}

function Preview({ draft }: { draft: Draft }) {
  return (
    <div className="preview">
      {draft.blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return <h4 key={i}>{block.text}</h4>;
          case "paragraph":
            return <p key={i}>{block.text}</p>;
          case "quote":
            return <blockquote key={i}>{block.text}</blockquote>;
          case "list":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case "divider":
            return <hr key={i} />;
          case "image":
            return block.file ? (
              <figure key={i}>
                <img src={imageUrl(block.file)} alt={block.caption} />
                <figcaption>
                  {block.caption}
                  {block.verdict ? ` — AI 판정: ${block.verdict}` : ""}
                </figcaption>
              </figure>
            ) : (
              <div className="missing" key={i}>
                이미지 자리 비어 있음 ("{block.query}") — {block.verdict ?? "적합한 사진을 찾지 못했습니다"}
              </div>
            );
        }
      })}
      <div className="tags">
        {draft.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>
    </div>
  );
}

function SettingsCard(props: { settings: Settings; busy: boolean; onSave: (patch: Partial<Settings>) => void }) {
  const [form, setForm] = useState(props.settings);
  useEffect(() => setForm(props.settings), [props.settings]);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const num = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Number(e.target.value) as never);

  return (
    <div className="card">
      <h2>설정</h2>
      <label className="field">
        <span>관심 분야 (쉼표로 구분)</span>
        <input
          value={form.keywords.join(", ")}
          onChange={(e) => set("keywords", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      </label>
      <div className="row">
        <label className="field">
          <span>블로그 아이디</span>
          <input value={form.blogId} onChange={(e) => set("blogId", e.target.value)} />
        </label>
        <label className="field">
          <span>카테고리 (비우면 기본)</span>
          <input value={form.category} onChange={(e) => set("category", e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>공통 태그 (쉼표로 구분)</span>
        <input
          value={form.fixedTags.join(", ")}
          onChange={(e) => set("fixedTags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
        />
      </label>
      <div className="row">
        <label className="field">
          <span>공개 설정</span>
          <select value={form.visibility} onChange={(e) => set("visibility", e.target.value as Settings["visibility"])}>
            <option value="public">전체공개</option>
            <option value="private">비공개</option>
          </select>
        </label>
        <label className="field">
          <span>이미지 수</span>
          <input type="number" min={0} max={10} value={form.imagesPerPost} onChange={num("imagesPerPost")} />
        </label>
        <label className="field">
          <span>자리당 후보 장수</span>
          <input type="number" min={1} max={10} value={form.imageCandidates} onChange={num("imageCandidates")} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>최소 글자 수</span>
          <input type="number" min={300} step={100} value={form.minChars} onChange={num("minChars")} />
        </label>
        <label className="field">
          <span>하루 최대 발행</span>
          <input type="number" min={1} max={20} value={form.maxPostsPerDay} onChange={num("maxPostsPerDay")} />
        </label>
        <label className="field">
          <span>발행 간격(분)</span>
          <input type="number" min={0} step={10} value={form.minMinutesBetweenPosts} onChange={num("minMinutesBetweenPosts")} />
        </label>
      </div>
      <div className="row">
        <label className="field">
          <span>수집 자료 수</span>
          <input type="number" min={2} max={20} value={form.sourcesPerKeyword} onChange={num("sourcesPerKeyword")} />
        </label>
        <label className="field">
          <span>claude 모델 (비우면 기본)</span>
          <input value={form.claudeModel} placeholder="예: opus" onChange={(e) => set("claudeModel", e.target.value)} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 8, margin: "4px 0 14px" }}>
        <label className="inline">
          <input type="checkbox" checked={form.autoPublish} onChange={(e) => set("autoPublish", e.target.checked)} />
          <span>승인 없이 발행까지 자동 진행</span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={form.headless} onChange={(e) => set("headless", e.target.checked)} />
          <span>발행 시 브라우저 창 숨기기 (처음에는 끄고 눈으로 확인하세요)</span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={form.debugShots} onChange={(e) => set("debugShots", e.target.checked)} />
          <span>단계별 스크린샷 저장 (data/debug)</span>
        </label>
      </div>
      <button disabled={props.busy} onClick={() => props.onSave(form)}>
        설정 저장
      </button>
    </div>
  );
}
