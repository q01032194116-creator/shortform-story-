import type { ImageCandidate, ImageSlot, Settings } from "../types.js";
import { ask } from "../ai/claude.js";
import { imageQueryPrompt, imageVerdictPrompt } from "../ai/prompts.js";
import { imageQuerySchema, imageVerdictSchema } from "../ai/schemas.js";
import { downloadImage } from "./download.js";
import { searchStock } from "./stock.js";

const ACCEPT_SCORE = 7;
const CANDIDATES_PER_QUERY = 3;

interface Verdict {
  score: number;
  fits: boolean;
  reason: string;
  altText: string;
  caption: string;
}

/** Ask the model for stock-friendly English queries for a Korean image hint. */
async function queriesFor(postTitle: string, hint: string, model: string): Promise<string[]> {
  const result = await ask<{ queries: string[] }>({
    prompt: imageQueryPrompt(postTitle, hint),
    schema: imageQuerySchema as unknown as Record<string, unknown>,
    model,
    label: "imageQuery",
  });
  return result.queries.filter((q) => q.trim().length > 0);
}

/** Have the model actually open the file and judge whether it fits the section. */
async function judge(
  candidate: ImageCandidate,
  postTitle: string,
  hint: string,
  model: string,
): Promise<Verdict | null> {
  if (!candidate.filePath) return null;
  try {
    return await ask<Verdict>({
      prompt: imageVerdictPrompt(candidate.filePath, postTitle, hint),
      schema: imageVerdictSchema as unknown as Record<string, unknown>,
      model,
      images: [candidate.filePath],
      label: "imageVerdict",
      retries: 1,
    });
  } catch {
    return null;
  }
}

export type Reporter = (message: string) => void;

/**
 * Fill one image slot: search stock, download candidates, let the AI look at
 * each one, and take the best accepted photo. If every candidate is rejected we
 * try the next query rather than silently inserting a bad picture.
 */
export async function resolveSlot(
  postId: string,
  postTitle: string,
  slot: ImageSlot,
  settings: Settings,
  report: Reporter = () => {},
): Promise<ImageSlot> {
  const keys = { pexelsKey: settings.pexelsKey, unsplashKey: settings.unsplashKey };
  if (!keys.pexelsKey && !keys.unsplashKey) {
    return { ...slot, unresolved: true, candidates: [] };
  }

  const queries = slot.queries.length > 0 ? slot.queries : await queriesFor(postTitle, slot.hint, settings.models.vision);
  const tried: ImageCandidate[] = [];

  for (const query of queries.slice(0, 3)) {
    report(`이미지 검색: "${query}"`);
    let found: ImageCandidate[] = [];
    try {
      found = (await searchStock(query, keys)).slice(0, CANDIDATES_PER_QUERY);
    } catch (error) {
      report(`이미지 검색 실패 (${query}): ${(error as Error).message}`);
      continue;
    }
    if (found.length === 0) continue;

    for (const candidate of found) {
      try {
        candidate.filePath = await downloadImage(postId, candidate.id, candidate.downloadUrl);
      } catch {
        continue;
      }
      const verdict = await judge(candidate, postTitle, slot.hint, settings.models.vision);
      if (verdict) {
        candidate.score = verdict.score;
        candidate.fits = verdict.fits;
        candidate.reason = verdict.reason;
        candidate.altText = verdict.altText;
        candidate.caption = verdict.caption;
      }
      tried.push(candidate);
      report(
        `  ${candidate.provider} ${candidate.id}: ${verdict ? `${verdict.score}점 ${verdict.fits ? "채택가능" : "부적합"}` : "판정 실패"}`,
      );
    }

    const accepted = tried
      .filter((c) => c.fits === true && (c.score ?? 0) >= ACCEPT_SCORE)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    if (accepted[0]) {
      report(`  → 채택: ${accepted[0].id} (${accepted[0].score}점)`);
      return { ...slot, queries, candidates: tried, chosenId: accepted[0].id, unresolved: false };
    }
    report("  전부 탈락 — 다른 검색어로 재시도");
  }

  report("  적합한 이미지를 찾지 못했습니다 (이미지 없이 진행).");
  return { ...slot, queries, candidates: tried, chosenId: null, unresolved: true };
}

export async function resolveSlots(
  postId: string,
  postTitle: string,
  slots: ImageSlot[],
  settings: Settings,
  report: Reporter = () => {},
): Promise<ImageSlot[]> {
  const out: ImageSlot[] = [];
  for (const [index, slot] of slots.entries()) {
    report(`이미지 ${index + 1}/${slots.length}: ${slot.hint}`);
    out.push(await resolveSlot(postId, postTitle, slot, settings, report));
  }
  return out;
}

export function chosenCandidate(slot: ImageSlot): ImageCandidate | null {
  return slot.candidates.find((c) => c.id === slot.chosenId) ?? null;
}
