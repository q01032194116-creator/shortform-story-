import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../paths.js";

const MAX_BYTES = 12 * 1024 * 1024;

/** Download a candidate into `data/images/<postId>/` and return its absolute path. */
export async function downloadImage(postId: string, candidateId: string, url: string): Promise<string> {
  const dir = join(PATHS.images, postId);
  mkdirSync(dir, { recursive: true });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`이미지 다운로드 실패: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error("이미지가 너무 큽니다.");

    const type = response.headers.get("content-type") ?? "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const file = join(dir, `${candidateId}.${ext}`);
    writeFileSync(file, buffer);
    return file;
  } finally {
    clearTimeout(timer);
  }
}
