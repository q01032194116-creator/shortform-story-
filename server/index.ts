import fs from "node:fs";
import path from "node:path";
import express from "express";
import { DATA_DIR, PORT, ROOT, loadSettings, saveSettings } from "./config.js";
import { clearSession, hasSession } from "./naver/browser.js";
import { checkSession, interactiveLogin } from "./naver/login.js";
import { attachImages } from "./naver/images.js";
import { checkPublishLimits, findTopics, publishExisting, runAuto, writeDraft } from "./pipeline/run.js";
import { collectSources } from "./naver/collect.js";
import { store } from "./store.js";
import { log, logger } from "./util/log.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

const serverLog = logger("server");

/** 실패를 항상 JSON 으로 돌려주는 래퍼. */
const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json({ ok: true, data: await fn(req, res) });
    } catch (err) {
      const message = (err as Error).message;
      serverLog.error(message);
      res.status(400).json({ ok: false, error: message });
    }
  };

/* ---------- 상태 ---------- */

app.get(
  "/api/status",
  handle(async () => ({
    hasSession: hasSession(),
    busy: log.busy,
    busyLabel: log.label,
    settings: loadSettings(),
    publishedToday: store.publishedToday(),
    limitMessage: checkPublishLimits(),
    logs: log.recent().slice(-200),
  })),
);

/** 진행 상황 실시간 스트림 (SSE) */
app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");

  const onLog = (event: unknown) => res.write(`event: log\ndata: ${JSON.stringify(event)}\n\n`);
  const onState = () => res.write(`event: state\ndata: ${JSON.stringify({ busy: log.busy, label: log.label })}\n\n`);
  log.on("log", onLog);
  log.on("state", onState);

  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(keepAlive);
    log.off("log", onLog);
    log.off("state", onState);
  });
});

/* ---------- 설정 ---------- */

app.get("/api/settings", handle(async () => loadSettings()));
app.post("/api/settings", handle(async (req) => saveSettings(req.body ?? {})));

/* ---------- 네이버 로그인 ---------- */

app.post(
  "/api/naver/login",
  handle(async () => log.lock("네이버 로그인", () => interactiveLogin())),
);

app.get("/api/naver/check", handle(async () => ({ valid: hasSession() && (await checkSession()) })));

app.post(
  "/api/naver/logout",
  handle(async () => {
    clearSession();
    serverLog.info("저장된 로그인 세션을 삭제했습니다.");
    return { cleared: true };
  }),
);

/* ---------- 파이프라인 ---------- */

app.post(
  "/api/run",
  handle(async (req) => {
    const keyword = String(req.body?.keyword ?? "").trim() || loadSettings().keywords[0];
    if (!keyword) throw new Error("관심 분야 키워드를 입력해 주세요.");
    return log.lock(`자동 실행: ${keyword}`, () => runAuto(keyword));
  }),
);

app.post(
  "/api/topics",
  handle(async (req) => {
    const keyword = String(req.body?.keyword ?? "").trim();
    if (!keyword) throw new Error("키워드를 입력해 주세요.");
    return log.lock(`글감 찾기: ${keyword}`, async () => (await findTopics(keyword)).topics);
  }),
);

app.post(
  "/api/draft",
  handle(async (req) => {
    const topicId = String(req.body?.topicId ?? "");
    const topic = store.getTopic(topicId);
    if (!topic) throw new Error("글감을 찾을 수 없습니다.");
    return log.lock(`초안 작성: ${topic.title}`, async () => {
      // 글감을 만들 때 쓴 자료를 다시 읽어 옵니다.
      const sources = await collectSources(topic.keyword, loadSettings().sourcesPerKeyword);
      store.markTopicUsed(topic.id);
      const draft = await writeDraft(topic, sources);
      return attachImages(draft, loadSettings().imageCandidates).then((d) => {
        store.saveDraft(d);
        return d;
      });
    });
  }),
);

app.post(
  "/api/publish",
  handle(async (req) => {
    const draftId = String(req.body?.draftId ?? "");
    return log.lock(`발행: ${draftId}`, () => publishExisting(draftId));
  }),
);

/* ---------- 데이터 조회 ---------- */

app.get("/api/topics", handle(async () => store.topics().slice(0, 50)));
app.get("/api/drafts", handle(async () => store.drafts().slice(0, 50)));
app.get(
  "/api/drafts/:id",
  handle(async (req) => {
    const draft = store.getDraft(String(req.params.id));
    if (!draft) throw new Error("초안을 찾을 수 없습니다.");
    return draft;
  }),
);

/** 초안 미리보기에서 심사를 통과한 이미지를 보여주기 위한 정적 제공. */
app.get("/files/image", (req, res) => {
  const file = path.resolve(String(req.query.path ?? ""));
  // data 디렉터리 밖의 파일은 절대 내보내지 않습니다.
  if (!file.startsWith(path.resolve(DATA_DIR)) || !fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

/* ---------- 대시보드 정적 파일 ---------- */

const webDist = path.join(ROOT, "dist", "web");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

/**
 * 로컬 도구 서버가 조용히 죽는 것이 가장 나쁜 결과입니다.
 * (대시보드에는 "Failed to fetch" 만 뜨고 원인은 어디에도 남지 않습니다.)
 * 예상 못 한 오류는 크게 남기고 서버는 살려 둡니다.
 */
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  serverLog.error(`처리되지 않은 오류: ${err.message}`);
  if (err.stack) console.error(err.stack);
  serverLog.warn("서버는 계속 실행됩니다. 이 오류가 반복되면 위 내용을 알려 주세요.");
});

process.on("uncaughtException", (err) => {
  serverLog.error(`예기치 못한 오류: ${err.message}`);
  if (err.stack) console.error(err.stack);
  serverLog.warn("서버는 계속 실행됩니다. 이 오류가 반복되면 위 내용을 알려 주세요.");
});

app.listen(PORT, () => {
  serverLog.info(`대시보드 API 준비 완료 → http://localhost:${PORT}`);
  if (!fs.existsSync(webDist)) {
    serverLog.info("개발 모드에서는 http://localhost:5173 으로 접속하세요.");
  }
});
