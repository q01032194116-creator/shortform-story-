import { spawn } from "node:child_process";
import { DATA_DIR, loadSettings, ROOT } from "../config.js";
import { logger } from "../util/log.js";

const log = logger("claude");

export type ClaudeOptions = {
  /** 첨부할 이미지 파일의 절대경로. Read 도구로 모델이 직접 열어 봅니다. */
  images?: string[];
  timeoutSec?: number;
  /** 사람이 읽을 수 있는 호출 이름 (로그용) */
  label?: string;
};

/**
 * Claude Code CLI 를 비대화형(-p)으로 호출합니다.
 * API 키 종량제가 아니라 CLI 에 로그인된 구독 계정을 그대로 사용합니다.
 */
export async function runClaude(prompt: string, options: ClaudeOptions = {}): Promise<string> {
  const settings = loadSettings();
  const timeoutSec = options.timeoutSec ?? settings.claudeTimeoutSec;
  const label = options.label ?? "prompt";

  const args = ["-p", "--output-format", "json"];
  if (settings.claudeModel.trim()) args.push("--model", settings.claudeModel.trim());

  if (options.images?.length) {
    // 이미지를 직접 열어 보려면 Read 도구가 필요합니다. 그 외 도구는 주지 않습니다.
    // --allowedTools 만으로 자동 승인되므로 위험한 bypassPermissions 는 쓰지 않습니다.
    args.push("--allowedTools", "Read", "--add-dir", DATA_DIR);
  }
  // 텍스트 생성 호출은 도구가 전혀 필요 없으므로 아무 권한도 주지 않습니다.

  const fullPrompt = options.images?.length
    ? `${prompt}\n\n다음 이미지 파일들을 Read 도구로 직접 열어서 눈으로 확인한 뒤 판단하세요:\n${options.images
        .map((p, i) => `${i}: ${p}`)
        .join("\n")}`
    : prompt;

  log.info(`호출 시작 (${label}, ${fullPrompt.length}자${options.images?.length ? `, 이미지 ${options.images.length}장` : ""})`);
  const startedAt = Date.now();

  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude 호출이 ${timeoutSec}초를 넘겨 중단되었습니다 (${label})`));
    }, timeoutSec * 1000);

    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `claude 실행에 실패했습니다. Claude Code CLI 가 설치되어 있고 로그인돼 있는지 확인하세요 (원인: ${err.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude 종료코드 ${code}: ${stderr.trim() || stdout.trim()}`));
      else resolve(stdout);
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });

  log.info(`호출 완료 (${label}, ${((Date.now() - startedAt) / 1000).toFixed(1)}초)`);
  return unwrapResult(raw);
}

/** `--output-format json` 응답에서 실제 답변 텍스트만 꺼냅니다. */
function unwrapResult(raw: string): string {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { result?: string; is_error?: boolean; subtype?: string };
    if (parsed.is_error) throw new Error(`claude 가 오류를 반환했습니다: ${parsed.result ?? parsed.subtype}`);
    if (typeof parsed.result === "string") return parsed.result;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("claude 가 오류를")) throw err;
  }
  // --output-format json 이 아닌 형태로 돌아온 경우 원문을 그대로 씁니다.
  return trimmed;
}

/**
 * 모델 답변에서 JSON 블록을 꺼내 파싱합니다.
 * 코드펜스, 앞뒤 설명문이 섞여 있어도 견디도록 만들었습니다.
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], sliceBalanced(text, "{", "}"), sliceBalanced(text, "[", "]"), text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim()) as T;
    } catch {
      /* 다음 후보 시도 */
    }
  }
  throw new Error(`모델 응답에서 JSON 을 찾지 못했습니다: ${text.slice(0, 400)}`);
}

/** 첫 여는 괄호부터 짝이 맞는 닫는 괄호까지 잘라냅니다(문자열 리터럴 인식). */
function sliceBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
