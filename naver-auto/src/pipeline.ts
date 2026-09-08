import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";
import type { Post, Settings, Topic } from "./types.js";
import { collect, closeScrapeContext } from "./collect/index.js";
import { resolveSlots } from "./images/resolve.js";
import { naverContext } from "./naver/browser.js";
import { openEditor, writeIntoEditor } from "./naver/editor.js";
import { checkRateLimits, publishPost, saveDraft } from "./naver/publish.js";
import { getAccount } from "./store/db.js";
import { recordPublish, upsertPost } from "./store/db.js";
import { bodyLength, buildOutline, proposeTopics, writePost } from "./write/compose.js";

export type Reporter = (message: string) => void;

/** Everything before the browser: scrape, rank, write, illustrate. */
export async function draftPost(
  keyword: string,
  settings: Settings,
  report: Reporter,
  presetTopic?: Topic,
): Promise<Post> {
  const collection = await collect(keyword, report);
  await closeScrapeContext();

  let topic = presetTopic ?? null;
  if (!topic) {
    report("글감을 고르는 중… (AI)");
    const topics = await proposeTopics(keyword, collection.sources, settings);
    topic = topics[0] ?? null;
    if (!topic) throw new Error("AI가 글감을 제안하지 못했습니다.");
    report(`글감 선정: ${topic.title} (${topic.score}점) — ${topic.angle}`);
  }

  // Give the writer the sources it actually cited, plus the rest as context.
  const cited = new Set(topic.sourceIds);
  const ordered = [
    ...collection.sources.filter((s) => cited.has(s.id)),
    ...collection.sources.filter((s) => !cited.has(s.id)),
  ].slice(0, 14);

  report("구성 잡는 중… (AI)");
  const outline = await buildOutline(topic, ordered, settings);
  report(`구성 완료: ${outline.sections.map((s) => s.heading).join(" / ")}`);

  report("본문 작성 중… (AI, 1~3분 소요)");
  const written = await writePost(topic, outline, ordered, settings);
  report(`본문 작성 완료: "${written.title}" (${bodyLength(written.blocks)}자, 블록 ${written.blocks.length}개)`);

  const post: Post = {
    id: randomUUID().slice(0, 8),
    keyword,
    topic,
    title: written.title,
    blocks: written.blocks,
    tags: written.tags.length > 0 ? written.tags : outline.tags,
    slots: written.slots,
    status: "drafting",
    publishedUrl: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertPost(post);

  if (post.slots.length > 0) {
    report(`이미지 ${post.slots.length}개 찾는 중… (AI가 사진을 직접 보고 판정)`);
    post.slots = await resolveSlots(post.id, post.title, post.slots, settings, report);
  }

  post.status = "ready";
  return upsertPost(post);
}

/** Refuse to publish something obviously broken. */
export function preflight(post: Post): { ok: boolean; reason: string } {
  if (!post.title.trim()) return { ok: false, reason: "제목이 비어 있습니다." };
  if (post.blocks.length < 4) return { ok: false, reason: "본문 블록이 너무 적습니다." };
  if (bodyLength(post.blocks) < 600) return { ok: false, reason: "본문이 너무 짧습니다 (600자 미만)." };
  return { ok: true, reason: "" };
}

/** Put an already-drafted post into the Naver editor, then save or publish it. */
export async function publishDraft(post: Post, settings: Settings, report: Reporter): Promise<Post> {
  const account = getAccount();
  if (!account.loggedIn || !account.blogId) {
    throw new Error("네이버에 로그인되어 있지 않습니다. 대시보드에서 로그인해 주세요.");
  }

  const check = preflight(post);
  if (!check.ok) throw new Error(`발행 전 검사 실패: ${check.reason}`);

  let mode = settings.publishMode;
  if (mode === "auto") {
    const limits = checkRateLimits(settings);
    if (!limits.ok) {
      report(`${limits.reason} 임시저장으로 전환합니다.`);
      mode = "draft";
    }
  }

  const unresolved = post.slots.filter((s) => s.unresolved).length;
  if (unresolved > 0) report(`이미지 ${unresolved}개는 적합한 사진을 찾지 못해 비워둡니다.`);

  let context: BrowserContext | null = null;
  try {
    context = await naverContext(!settings.headful);
    const page = context.pages()[0] ?? (await context.newPage());

    const frame = await openEditor(page, account.blogId, report);
    post.status = "editing";
    upsertPost(post);

    await writeIntoEditor(page, frame, post.title, post.blocks, post.slots, settings, report);

    if (mode === "auto") {
      const url = await publishPost(page, frame, settings, post.tags, report);
      post.status = "published";
      post.publishedUrl = url;
      recordPublish({
        id: randomUUID().slice(0, 8),
        postId: post.id,
        title: post.title,
        keyword: post.keyword,
        url,
        mode: "auto",
        at: new Date().toISOString(),
      });
    } else {
      await saveDraft(page, frame, report);
      post.status = "saved";
      recordPublish({
        id: randomUUID().slice(0, 8),
        postId: post.id,
        title: post.title,
        keyword: post.keyword,
        url: null,
        mode: "draft",
        at: new Date().toISOString(),
      });
    }

    post.error = null;
    return upsertPost(post);
  } catch (error) {
    post.status = "failed";
    post.error = (error as Error).message;
    upsertPost(post);
    throw error;
  } finally {
    // Closing flushes the persistent profile, keeping the session warm.
    await context?.close().catch(() => {});
  }
}

/** The one-button path: keyword in, published URL out. */
export async function runFullPipeline(keyword: string, settings: Settings, report: Reporter): Promise<Post> {
  const post = await draftPost(keyword, settings, report);
  return publishDraft(post, settings, report);
}
