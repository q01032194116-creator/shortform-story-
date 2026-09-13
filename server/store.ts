import fs from "node:fs";
import { STORE_FILE } from "./config.js";

export type Source = {
  kind: "news" | "blog";
  title: string;
  url: string;
  press?: string;
  snippet?: string;
  body?: string;
  collectedAt: string;
};

export type Topic = {
  id: string;
  keyword: string;
  title: string;
  angle: string;
  why: string;
  outline: string[];
  searchTerms: string[];
  sourceUrls: string[];
  createdAt: string;
  usedAt?: string;
};

export type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "divider" }
  | {
      type: "image";
      query: string;
      need: string;
      caption: string;
      /** 판정을 통과해 실제로 붙은 파일 (없으면 발행 시 이 블록은 건너뜁니다) */
      file?: string;
      sourceUrl?: string;
      verdict?: string;
    };

export type Draft = {
  id: string;
  topicId: string;
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

type Shape = {
  topics: Topic[];
  drafts: Draft[];
  /** 이미 다뤄서 반복을 피해야 하는 제목들 */
  usedTitles: string[];
};

const EMPTY: Shape = { topics: [], drafts: [], usedTitles: [] };

function read(): Shape {
  try {
    return { ...EMPTY, ...(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as Partial<Shape>) };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(data: Shape) {
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const store = {
  all: read,
  topics: () => read().topics,
  drafts: () => read().drafts,

  addTopics(topics: Topic[]) {
    const data = read();
    data.topics = [...topics, ...data.topics].slice(0, 500);
    write(data);
  },

  getTopic(id: string) {
    return read().topics.find((t) => t.id === id);
  },

  markTopicUsed(id: string) {
    const data = read();
    const topic = data.topics.find((t) => t.id === id);
    if (topic) {
      topic.usedAt = new Date().toISOString();
      if (!data.usedTitles.includes(topic.title)) data.usedTitles.unshift(topic.title);
      data.usedTitles = data.usedTitles.slice(0, 300);
      write(data);
    }
  },

  saveDraft(draft: Draft) {
    const data = read();
    const i = data.drafts.findIndex((d) => d.id === draft.id);
    if (i >= 0) data.drafts[i] = draft;
    else data.drafts.unshift(draft);
    data.drafts = data.drafts.slice(0, 300);
    write(data);
  },

  getDraft(id: string) {
    return read().drafts.find((d) => d.id === id);
  },

  usedTitles: () => read().usedTitles,

  /** 오늘 발행한 글 수 (로컬 날짜 기준) */
  publishedToday(): number {
    const today = new Date().toDateString();
    return read().drafts.filter(
      (d) => d.status === "published" && d.publishedAt && new Date(d.publishedAt).toDateString() === today,
    ).length;
  },

  lastPublishedAt(): Date | null {
    const times = read()
      .drafts.filter((d) => d.status === "published" && d.publishedAt)
      .map((d) => new Date(d.publishedAt!).getTime());
    return times.length ? new Date(Math.max(...times)) : null;
  },
};
