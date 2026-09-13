import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { IMAGES_DIR } from "../config.js";
import { extractJson, runClaude } from "../ai/claude.js";
import { imageJudgePrompt } from "../ai/prompts.js";
import type { Block, Draft } from "../store.js";
import { logger } from "../util/log.js";
import { closeBrowser, openBrowser, shot, sleep, type Session } from "./browser.js";

const log = logger("images");

type Candidate = { url: string; file: string };

/**
 * 네이버 이미지 검색 결과에서 원본 이미지 URL 목록을 뽑습니다.
 * 썸네일은 `search.pstatic.net/common/?src=<원본URL>` 형태라 src 파라미터를 디코딩하면 원본을 얻을 수 있습니다.
 */
async function searchImageUrls(page: Page, query: string, want: number): Promise<string[]> {
  const url = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(query)}&res_fr=780&res_to=1000000`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1800);
    await sleep(700);
  }
  await shot(page, `image-search-${query.slice(0, 12)}`);

  return page.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<string>();

    const resolveOriginal = (src: string): string | null => {
      try {
        const parsed = new URL(src, location.href);
        const inner = parsed.searchParams.get("src");
        const original = inner ? decodeURIComponent(inner) : parsed.href;
        if (!/^https?:\/\//.test(original)) return null;
        if (/\.(svg|gif)(\?|$)/i.test(original)) return null; // 애니메이션/벡터 제외
        return original;
      } catch {
        return null;
      }
    };

    document.querySelectorAll("img").forEach((img) => {
      const raw =
        img.getAttribute("data-lazy-src") || img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (!raw || raw.startsWith("data:")) return;
      const original = resolveOriginal(raw);
      if (!original || seen.has(original)) return;
      // 아이콘/로고 같은 작은 이미지는 제외합니다.
      if ((img.naturalWidth || img.width) < 120) return;
      seen.add(original);
      out.push(original);
    });

    return out;
  }).then((urls) => urls.slice(0, want * 3));
}

/** 후보 이미지를 내려받습니다. 이미지가 아니거나 너무 작으면 버립니다. */
async function download(page: Page, url: string, dest: string): Promise<boolean> {
  try {
    const response = await page.context().request.get(url, {
      headers: { referer: "https://search.naver.com/", "user-agent": await page.evaluate(() => navigator.userAgent) },
      timeout: 20_000,
    });
    if (!response.ok()) return false;
    const type = response.headers()["content-type"] ?? "";
    if (!type.startsWith("image/")) return false;
    const body = await response.body();
    if (body.length < 20_000) return false; // 20KB 미만은 썸네일/아이콘으로 간주
    fs.writeFileSync(dest, body);
    return true;
  } catch {
    return false;
  }
}

function extensionFor(url: string): string {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
}

/**
 * 초안의 image 블록마다 후보를 모으고, AI 가 실제로 이미지를 열어 보고 한 장을 고릅니다.
 * 통과한 이미지가 없으면 해당 블록은 file 없이 남고 발행 시 건너뜁니다.
 */
export async function attachImages(draft: Draft, candidatesPerSlot: number): Promise<Draft> {
  const slots = draft.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry): entry is { block: Extract<Block, { type: "image" }>; index: number } => entry.block.type === "image");

  if (slots.length === 0) {
    log.warn("초안에 이미지 자리가 없습니다.");
    return draft;
  }

  const dir = path.join(IMAGES_DIR, draft.id);
  fs.mkdirSync(dir, { recursive: true });

  let session: Session | null = null;
  try {
    session = await openBrowser({ headless: true });
    const { page } = session;
    const usedUrls = new Set<string>();

    for (const { block, index } of slots) {
      log.step(`이미지 ${index + 1}번 자리: "${block.query}" 검색`);
      const urls = (await searchImageUrls(page, block.query, candidatesPerSlot)).filter((u) => !usedUrls.has(u));

      const candidates: Candidate[] = [];
      for (const url of urls) {
        if (candidates.length >= candidatesPerSlot) break;
        const file = path.join(dir, `slot${index}-${candidates.length}${extensionFor(url)}`);
        if (await download(page, url, file)) candidates.push({ url, file });
      }

      if (candidates.length === 0) {
        log.warn(`"${block.query}" 후보 이미지를 하나도 받지 못했습니다. 이 자리는 비웁니다.`);
        continue;
      }

      log.info(`후보 ${candidates.length}장 다운로드 완료. AI 심사 시작`);
      const answer = await runClaude(imageJudgePrompt(block, draft.title, candidates.length), {
        images: candidates.map((c) => c.file),
        label: `image-judge:${block.query}`,
      });

      let verdict: { best: number | null; reason?: string };
      try {
        verdict = extractJson<{ best: number | null; reason?: string }>(answer);
      } catch (err) {
        log.warn(`심사 응답을 읽지 못했습니다: ${(err as Error).message}`);
        continue;
      }

      const chosen = typeof verdict.best === "number" ? candidates[verdict.best] : undefined;
      if (!chosen) {
        log.warn(`AI 가 전부 탈락시켰습니다 (${verdict.reason ?? "사유 없음"}). 이 자리는 비웁니다.`);
        block.verdict = verdict.reason ?? "적합한 이미지 없음";
        continue;
      }

      usedUrls.add(chosen.url);
      block.file = chosen.file;
      block.sourceUrl = chosen.url;
      block.verdict = verdict.reason ?? "";
      log.done(`선택: ${path.basename(chosen.file)} — ${verdict.reason ?? ""}`);

      // 고르지 않은 후보는 지웁니다.
      for (const candidate of candidates) {
        if (candidate.file !== chosen.file) fs.rmSync(candidate.file, { force: true });
      }
    }
  } finally {
    await closeBrowser(session);
  }

  const attached = slots.filter((s) => s.block.file).length;
  log.done(`이미지 ${attached}/${slots.length}장 확정`);
  draft.status = "images-ready";
  return draft;
}
