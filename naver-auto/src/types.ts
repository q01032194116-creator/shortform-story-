/** Shared domain types for the Naver blog automation pipeline. */

/** A block of the generated post. This array is the contract that drives both
 *  the dashboard preview and the SmartEditor automation. */
export type PostBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "divider" }
  | { type: "image"; slotId: string; hint: string };

export type SourceKind = "news" | "blog";

/** A news article or blog post scraped from Naver search. */
export interface Source {
  id: string;
  kind: SourceKind;
  rank: number;
  title: string;
  url: string;
  publisher: string | null;
  postedAt: string | null;
  snippet: string;
  /** Full article text, filled in by collect/extract.ts for the top results. */
  body: string | null;
}

/** A topic candidate proposed by the AI from the collected sources. */
export interface Topic {
  id: string;
  title: string;
  angle: string;
  whyNow: string;
  targetKeyword: string;
  sourceIds: string[];
  score: number;
  competitionNote: string;
}

export interface ImageCandidate {
  id: string;
  provider: "pexels" | "unsplash";
  query: string;
  pageUrl: string;
  downloadUrl: string;
  credit: string;
  filePath: string | null;
  /** Filled in by the AI vision pass. */
  score: number | null;
  fits: boolean | null;
  reason: string | null;
  altText: string | null;
  caption: string | null;
}

export interface ImageSlot {
  slotId: string;
  hint: string;
  queries: string[];
  candidates: ImageCandidate[];
  chosenId: string | null;
  /** Set when every candidate was rejected by the AI. */
  unresolved: boolean;
}

export type PostStatus =
  | "drafting"
  | "ready"
  | "editing"
  | "saved"
  | "published"
  | "failed";

export interface Post {
  id: string;
  keyword: string;
  topic: Topic;
  title: string;
  blocks: PostBlock[];
  tags: string[];
  slots: ImageSlot[];
  status: PostStatus;
  publishedUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublishMode = "auto" | "draft";

export interface FormattingProfile {
  /** Naver body font size in pt. */
  bodyFontSize: number;
  align: "left" | "center";
  /** Render section headings as a Naver quote block (most readable) or plain bold. */
  headingStyle: "quote" | "bold";
  dividerBetweenSections: boolean;
  imagesPerPost: number;
  tagCount: number;
}

export interface Settings {
  keywords: string[];
  publishMode: PublishMode;
  dailyLimit: number;
  minIntervalMinutes: number;
  visibility: "public" | "private";
  categoryName: string | null;
  /** Show the browser window while writing/publishing. Slower but easier to debug. */
  headful: boolean;
  models: { rank: string; write: string; vision: string };
  formatting: FormattingProfile;
  pexelsKey: string;
  unsplashKey: string;
}

export interface NaverAccount {
  loggedIn: boolean;
  blogId: string | null;
  nickname: string | null;
  checkedAt: string | null;
}

export interface PublishRecord {
  id: string;
  postId: string;
  title: string;
  keyword: string;
  url: string | null;
  mode: PublishMode;
  at: string;
}
