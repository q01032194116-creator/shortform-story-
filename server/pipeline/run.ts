import { loadSettings } from "../config.js";
import { extractJson, runClaude } from "../ai/claude.js";
import { topicPrompt, writePrompt } from "../ai/prompts.js";
import { collectSources } from "../naver/collect.js";
import { attachImages } from "../naver/images.js";
import { publishDraft } from "../naver/publish.js";
import { newId, store, type Block, type Draft, type Source, type Topic } from "../store.js";
import { logger } from "../util/log.js";

const log = logger("pipeline");

type RawTopic = {
  title: string;
  angle: string;
  why: string;
  outline?: string[];
  searchTerms?: string[];
  sourceIndexes?: number[];
};

/** 1단계: 수집 + 글감 추천 */
export async function findTopics(keyword: string): Promise<{ topics: Topic[]; sources: Source[] }> {
  const settings = loadSettings();
  const sources = await collectSources(keyword, settings.sourcesPerKeyword);

  log.step("AI 가 글감을 고르는 중...");
  const answer = await runClaude(topicPrompt(keyword, sources, store.usedTitles()), { label: `topics:${keyword}` });
  const raw = extractJson<RawTopic[]>(answer);
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("AI 가 글감을 반환하지 않았습니다.");

  const createdAt = new Date().toISOString();
  const topics: Topic[] = raw.map((item) => ({
    id: newId("topic"),
    keyword,
    title: String(item.title ?? "").trim(),
    angle: String(item.angle ?? "").trim(),
    why: String(item.why ?? "").trim(),
    outline: (item.outline ?? []).map(String),
    searchTerms: (item.searchTerms ?? []).map(String),
    // 모델은 1-기반 인덱스로 답합니다.
    sourceUrls: (item.sourceIndexes ?? [])
      .map((i) => sources[i - 1]?.url)
      .filter((u): u is string => Boolean(u)),
    createdAt,
  }));

  store.addTopics(topics);
  log.done(`글감 ${topics.length}개 추천 완료`);
  return { topics, sources };
}

const VALID_BLOCK_TYPES = new Set(["heading", "paragraph", "quote", "list", "divider", "image"]);

/** 모델이 만든 블록 배열을 검증하고 정리합니다. */
function normalizeBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) throw new Error("blocks 가 배열이 아닙니다.");
  const blocks: Block[] = [];
  for (const item of input as Record<string, unknown>[]) {
    const type = String(item?.type ?? "");
    if (!VALID_BLOCK_TYPES.has(type)) continue;
    if (type === "divider") {
      blocks.push({ type: "divider" });
    } else if (type === "list") {
      const items = Array.isArray(item.items) ? item.items.map(String).filter(Boolean) : [];
      if (items.length) blocks.push({ type: "list", items });
    } else if (type === "image") {
      const query = String(item.query ?? "").trim();
      if (query) {
        blocks.push({
          type: "image",
          query,
          need: String(item.need ?? query),
          caption: String(item.caption ?? ""),
        });
      }
    } else {
      const text = String(item.text ?? "").trim();
      if (text) blocks.push({ type: type as "heading" | "paragraph" | "quote", text });
    }
  }
  if (blocks.length === 0) throw new Error("쓸 수 있는 본문 블록이 하나도 없습니다.");
  return blocks;
}

/** 2단계: 글감 → 초안 */
export async function writeDraft(topic: Topic, sources: Source[]): Promise<Draft> {
  const settings = loadSettings();
  log.step(`"${topic.title}" 본문 작성 중...`);

  const relevant = topic.sourceUrls.length
    ? sources.filter((s) => topic.sourceUrls.includes(s.url))
    : sources;

  const answer = await runClaude(
    writePrompt(topic, relevant.length ? relevant : sources, {
      minChars: settings.minChars,
      imagesPerPost: settings.imagesPerPost,
    }),
    { label: `write:${topic.title}` },
  );
  const parsed = extractJson<{ title?: string; tags?: string[]; blocks?: unknown }>(answer);

  const draft: Draft = {
    id: newId("draft"),
    topicId: topic.id,
    keyword: topic.keyword,
    title: String(parsed.title ?? topic.title).trim(),
    tags: (parsed.tags ?? []).map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean),
    blocks: normalizeBlocks(parsed.blocks),
    sourceUrls: relevant.map((s) => s.url),
    createdAt: new Date().toISOString(),
    status: "draft",
  };

  const chars = draft.blocks
    .map((b) => ("text" in b ? b.text : "items" in b ? b.items.join("") : ""))
    .join("").length;
  log.done(`초안 완성: "${draft.title}" (${chars}자, 블록 ${draft.blocks.length}개)`);

  store.saveDraft(draft);
  return draft;
}

/** 발행 전 계정 보호 한도를 확인합니다. */
export function checkPublishLimits(): string | null {
  const settings = loadSettings();

  const today = store.publishedToday();
  if (today >= settings.maxPostsPerDay) {
    return `오늘 이미 ${today}개를 발행했습니다 (하루 한도 ${settings.maxPostsPerDay}개).`;
  }

  const last = store.lastPublishedAt();
  if (last) {
    const minutesSince = (Date.now() - last.getTime()) / 60_000;
    if (minutesSince < settings.minMinutesBetweenPosts) {
      const wait = Math.ceil(settings.minMinutesBetweenPosts - minutesSince);
      return `직전 발행 후 ${Math.floor(minutesSince)}분 지났습니다. ${wait}분 더 기다려야 합니다 (최소 간격 ${settings.minMinutesBetweenPosts}분).`;
    }
  }

  return null;
}

/** 전 과정 자동 실행: 수집 → 글감 → 작성 → 이미지 → 발행 */
export async function runAuto(keyword: string): Promise<Draft> {
  const settings = loadSettings();

  if (settings.autoPublish) {
    const blocked = checkPublishLimits();
    if (blocked) throw new Error(`${blocked} 설정에서 한도를 조정할 수 있습니다.`);
  }

  const { topics, sources } = await findTopics(keyword);
  const topic = topics.find((t) => t.title && !store.usedTitles().includes(t.title)) ?? topics[0]!;
  log.info(`선택한 글감: ${topic.title} — ${topic.why}`);
  store.markTopicUsed(topic.id);

  let draft = await writeDraft(topic, sources);
  draft = await attachImages(draft, settings.imageCandidates);
  store.saveDraft(draft);

  if (!settings.autoPublish) {
    log.done("자동 발행이 꺼져 있어 초안까지만 만들었습니다. 대시보드에서 확인 후 발행하세요.");
    return draft;
  }

  try {
    const postUrl = await publishDraft(draft);
    draft.status = "published";
    draft.publishedAt = new Date().toISOString();
    draft.postUrl = postUrl;
  } catch (err) {
    draft.status = "failed";
    draft.error = (err as Error).message;
    store.saveDraft(draft);
    throw err;
  }

  store.saveDraft(draft);
  return draft;
}

/** 이미 만들어 둔 초안을 발행합니다. */
export async function publishExisting(draftId: string): Promise<Draft> {
  const draft = store.getDraft(draftId);
  if (!draft) throw new Error("초안을 찾을 수 없습니다.");
  if (draft.status === "published") throw new Error("이미 발행된 글입니다.");

  const blocked = checkPublishLimits();
  if (blocked) throw new Error(blocked);

  try {
    draft.postUrl = await publishDraft(draft);
    draft.status = "published";
    draft.publishedAt = new Date().toISOString();
  } catch (err) {
    draft.status = "failed";
    draft.error = (err as Error).message;
    store.saveDraft(draft);
    throw err;
  }

  store.saveDraft(draft);
  return draft;
}
