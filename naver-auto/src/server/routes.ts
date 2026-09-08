import { Router } from "express";
import { healthCheck } from "../ai/claude.js";
import { describeClaude } from "../ai/resolveClaude.js";
import { collect, closeScrapeContext } from "../collect/index.js";
import { draftPost, publishDraft, runFullPipeline } from "../pipeline.js";
import { login, loginInProgress } from "../naver/login.js";
import { checkSession, logout } from "../naver/session.js";
import { checkRateLimits } from "../naver/publish.js";
import { loadSettings, redactSettings, saveSettings } from "../settings.js";
import { getAccount, getPost, listPosts, listPublishes, upsertPost } from "../store/db.js";
import { proposeTopics } from "../write/compose.js";
import { log } from "./events.js";
import { jobState, runJob } from "./jobs.js";

export const api = Router();

function fail(res: import("express").Response, error: unknown, status = 500): void {
  const message = (error as Error).message ?? String(error);
  res.status(status).json({ error: message });
}

api.get("/status", async (_req, res) => {
  const settings = loadSettings();
  res.json({
    job: jobState(),
    account: getAccount(),
    settings: redactSettings(settings),
    claude: describeClaude(),
    rateLimit: checkRateLimits(settings),
    loginInProgress: loginInProgress(),
  });
});

api.get("/health/claude", async (_req, res) => {
  res.json(await healthCheck());
});

api.get("/settings", (_req, res) => res.json(redactSettings(loadSettings())));

api.put("/settings", (req, res) => {
  try {
    const patch = { ...req.body } as Record<string, unknown>;
    // A masked key coming back from the UI must not overwrite the real one.
    for (const key of ["pexelsKey", "unsplashKey"]) {
      if (typeof patch[key] === "string" && /^[•]+$/.test(patch[key] as string)) delete patch[key];
    }
    res.json(redactSettings(saveSettings(patch)));
  } catch (error) {
    fail(res, error, 400);
  }
});

/* ---------------------------------------------------------------- Naver auth */

api.post("/naver/login", async (_req, res) => {
  try {
    // Returns as soon as the window is open; progress arrives over SSE.
    void login(log).catch((error) => log(`로그인 실패: ${(error as Error).message}`));
    res.json({ started: true });
  } catch (error) {
    fail(res, error);
  }
});

api.get("/naver/status", async (_req, res) => {
  try {
    res.json(await checkSession());
  } catch (error) {
    fail(res, error);
  }
});

api.post("/naver/logout", (_req, res) => res.json(logout()));

/* ------------------------------------------------------------------- Content */

api.post("/collect", async (req, res) => {
  const keyword = String(req.body?.keyword ?? "").trim();
  if (!keyword) return fail(res, new Error("키워드를 입력해 주세요."), 400);
  try {
    const result = await runJob(`수집: ${keyword}`, async () => {
      const collection = await collect(keyword, log);
      await closeScrapeContext();
      const topics = await proposeTopics(keyword, collection.sources, loadSettings());
      return { ...collection, topics };
    });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

api.post("/draft", async (req, res) => {
  const keyword = String(req.body?.keyword ?? "").trim();
  if (!keyword) return fail(res, new Error("키워드를 입력해 주세요."), 400);
  try {
    const post = await runJob(`초안: ${keyword}`, () => draftPost(keyword, loadSettings(), log, req.body?.topic));
    res.json(post);
  } catch (error) {
    fail(res, error);
  }
});

api.post("/run", async (req, res) => {
  const keyword = String(req.body?.keyword ?? "").trim();
  if (!keyword) return fail(res, new Error("키워드를 입력해 주세요."), 400);
  try {
    const post = await runJob(`전자동: ${keyword}`, () => runFullPipeline(keyword, loadSettings(), log));
    res.json(post);
  } catch (error) {
    fail(res, error);
  }
});

api.post("/posts/:id/publish", async (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return fail(res, new Error("글을 찾을 수 없습니다."), 404);
  try {
    const result = await runJob(`발행: ${post.title}`, () => publishDraft(post, loadSettings(), log));
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

api.get("/posts", (_req, res) => res.json(listPosts()));

api.get("/posts/:id", (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return fail(res, new Error("글을 찾을 수 없습니다."), 404);
  res.json(post);
});

/** Swap in a different image candidate the AI scored but did not pick. */
api.post("/posts/:id/slots/:slotId/choose", (req, res) => {
  const post = getPost(req.params.id);
  if (!post) return fail(res, new Error("글을 찾을 수 없습니다."), 404);
  const candidateId = String(req.body?.candidateId ?? "");
  const slot = post.slots.find((s) => s.slotId === req.params.slotId);
  if (!slot) return fail(res, new Error("이미지 슬롯을 찾을 수 없습니다."), 404);
  if (!slot.candidates.some((c) => c.id === candidateId)) {
    return fail(res, new Error("해당 후보가 없습니다."), 400);
  }
  slot.chosenId = candidateId;
  slot.unresolved = false;
  res.json(upsertPost(post));
});

api.get("/history", (_req, res) => res.json(listPublishes()));
