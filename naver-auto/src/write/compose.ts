import { randomUUID } from "node:crypto";
import type { ImageSlot, PostBlock, Settings, Source, Topic } from "../types.js";
import { ask } from "../ai/claude.js";
import { outlinePrompt, topicsPrompt, writePrompt } from "../ai/prompts.js";
import { outlineSchema, postSchema, topicsSchema } from "../ai/schemas.js";

export interface Outline {
  titleCandidates: string[];
  hook: string;
  sections: Array<{ heading: string; points: string[]; imageHint: string }>;
  tags: string[];
}

interface RawBlock {
  type: PostBlock["type"];
  text?: string;
  items?: string[];
  hint?: string;
}

/** Stage 1: pick what is worth writing about. */
export async function proposeTopics(keyword: string, sources: Source[], settings: Settings): Promise<Topic[]> {
  const result = await ask<{ topics: Array<Omit<Topic, "id">> }>({
    prompt: topicsPrompt(keyword, sources),
    schema: topicsSchema as unknown as Record<string, unknown>,
    model: settings.models.rank,
    label: "proposeTopics",
  });

  const validIds = new Set(sources.map((s) => s.id));
  return result.topics
    .map((topic) => ({
      ...topic,
      id: randomUUID().slice(0, 8),
      sourceIds: topic.sourceIds.filter((id) => validIds.has(id)),
    }))
    .sort((a, b) => b.score - a.score);
}

/** Stage 2: structure the article before writing it. */
export async function buildOutline(topic: Topic, sources: Source[], settings: Settings): Promise<Outline> {
  return ask<Outline>({
    prompt: outlinePrompt(topic, sources, settings.formatting),
    schema: outlineSchema as unknown as Record<string, unknown>,
    model: settings.models.write,
    label: "buildOutline",
  });
}

/**
 * Normalise whatever the model returned into blocks we can actually render.
 * The schema guarantees the field names, not that a paragraph has text.
 */
export function normaliseBlocks(raw: RawBlock[], imagesWanted: number): { blocks: PostBlock[]; slots: ImageSlot[] } {
  const blocks: PostBlock[] = [];
  const slots: ImageSlot[] = [];

  for (const item of raw) {
    switch (item.type) {
      case "heading":
      case "paragraph":
      case "quote": {
        const text = (item.text ?? "").trim();
        if (text) blocks.push({ type: item.type, text });
        break;
      }
      case "list": {
        const items = (item.items ?? []).map((i) => i.trim()).filter(Boolean);
        if (items.length > 0) blocks.push({ type: "list", items });
        break;
      }
      case "divider":
        // Never start with a divider or stack two in a row.
        if (blocks.length > 0 && blocks[blocks.length - 1]!.type !== "divider") blocks.push({ type: "divider" });
        break;
      case "image": {
        if (slots.length >= imagesWanted) break;
        const slotId = `img${slots.length + 1}`;
        const hint = (item.hint ?? item.text ?? "").trim() || "글 주제와 어울리는 사진";
        blocks.push({ type: "image", slotId, hint });
        slots.push({ slotId, hint, queries: [], candidates: [], chosenId: null, unresolved: false });
        break;
      }
    }
  }

  return { blocks, slots };
}

/** Stage 3: write the body. */
export async function writePost(
  topic: Topic,
  outline: Outline,
  sources: Source[],
  settings: Settings,
): Promise<{ title: string; blocks: PostBlock[]; slots: ImageSlot[]; tags: string[] }> {
  const result = await ask<{ title: string; blocks: RawBlock[]; tags: string[] }>({
    prompt: writePrompt(topic, outline, sources, settings.formatting),
    schema: postSchema as unknown as Record<string, unknown>,
    model: settings.models.write,
    label: "writePost",
    timeoutMs: 420_000,
  });

  const { blocks, slots } = normaliseBlocks(result.blocks, settings.formatting.imagesPerPost);
  const tags = result.tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean).slice(0, settings.formatting.tagCount);

  return { title: result.title.trim(), blocks, slots, tags };
}

/** Plain-text length of the body, used for the pre-publish sanity gate. */
export function bodyLength(blocks: PostBlock[]): number {
  return blocks.reduce((total, block) => {
    if (block.type === "paragraph" || block.type === "heading" || block.type === "quote") return total + block.text.length;
    if (block.type === "list") return total + block.items.join("").length;
    return total;
  }, 0);
}
