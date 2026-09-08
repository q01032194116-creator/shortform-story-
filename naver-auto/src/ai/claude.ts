import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS, ensureDirs } from "../paths.js";
import { resolveClaude } from "./resolveClaude.js";

export interface AskOptions<T> {
  prompt: string;
  /** JSON Schema passed to `--json-schema`; the CLI then guarantees the shape. */
  schema: Record<string, unknown>;
  model?: string;
  /** Absolute image paths the model should open with the Read tool (vision). */
  images?: string[];
  timeoutMs?: number;
  retries?: number;
  label?: string;
  /** Narrows the returned value; the schema is the real guarantee. */
  validate?: (value: unknown) => value is T;
}

interface CliResult {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  permission_denials?: unknown[];
}

export class ClaudeError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

/** At most two CLI processes at a time: each one is a full model call. */
const MAX_CONCURRENT = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active -= 1;
    waiting.shift()?.();
  };
}

function logCall(entry: Record<string, unknown>): void {
  try {
    ensureDirs();
    const file = join(PATHS.logs, `ai-${new Date().toISOString().slice(0, 10)}.jsonl`);
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {
    // Logging must never break a run.
  }
}

function runCli(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  const bin = resolveClaude();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin.command, [...bin.prefix, ...args], {
      shell: bin.needsShell,
      windowsHide: true,
      env: { ...process.env, CLAUDE_CODE_NONINTERACTIVE: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new ClaudeError(`Claude 호출이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ClaudeError(`Claude CLI 실행 실패 (${bin.how}): ${error.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new ClaudeError(`Claude CLI가 코드 ${code}로 종료했습니다.`, stderr.slice(-2000) || stdout.slice(-2000)));
        return;
      }
      resolvePromise(stdout);
    });

    child.stdin.on("error", () => {
      /* the child may exit before we finish writing */
    });
    child.stdin.end(stdin, "utf8");
  });
}

function parseCliOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new ClaudeError("Claude가 빈 응답을 반환했습니다.");

  let envelope: CliResult;
  try {
    envelope = JSON.parse(trimmed) as CliResult;
  } catch {
    // Some CLI versions emit a stray line before the JSON envelope.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new ClaudeError("Claude 응답을 JSON으로 파싱하지 못했습니다.", trimmed.slice(0, 800));
    envelope = JSON.parse(trimmed.slice(start, end + 1)) as CliResult;
  }

  if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
    throw new ClaudeError(`Claude가 오류를 반환했습니다 (${envelope.subtype ?? "unknown"}).`, envelope.result?.slice(0, 800));
  }

  // Preferred: the CLI already parsed the schema-conformant object for us.
  if (envelope.structured_output !== undefined && envelope.structured_output !== null) {
    return envelope.structured_output;
  }
  if (typeof envelope.result === "string") {
    try {
      return JSON.parse(envelope.result);
    } catch {
      throw new ClaudeError("Claude 응답 본문이 JSON이 아닙니다.", envelope.result.slice(0, 800));
    }
  }
  throw new ClaudeError("Claude 응답에 결과가 없습니다.");
}

/**
 * Single entry point for every AI call in this app.
 *
 * Runs `claude -p` so the work bills to the user's Claude subscription rather
 * than an API key. The prompt goes over stdin, never argv, which sidesteps the
 * Windows 8191-character command-line limit and all quoting problems.
 */
export async function ask<T>(options: AskOptions<T>): Promise<T> {
  const {
    prompt,
    schema,
    model = "sonnet",
    images = [],
    timeoutMs = 300_000,
    retries = 2,
    label = "ask",
    validate,
  } = options;

  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--model", model];

  if (images.length > 0) {
    // Vision: let the model open the files, and nothing else.
    args.push("--allowedTools", "Read", "--max-turns", "6");
    for (const dir of new Set(images.map((p) => join(p, "..")))) args.push("--add-dir", dir);
  } else {
    // Pure reasoning over text we already supplied: no tools, no web access.
    args.push("--restricted", "--disallowedTools", "WebSearch WebFetch", "--max-turns", "1");
  }

  const release = await acquire();
  const started = Date.now();
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const stdout = await runCli(args, prompt, timeoutMs);
        const value = parseCliOutput(stdout);
        if (validate && !validate(value)) {
          throw new ClaudeError("Claude 응답이 예상한 형태가 아닙니다.", JSON.stringify(value).slice(0, 800));
        }
        logCall({ label, model, attempt, ms: Date.now() - started, ok: true, promptChars: prompt.length });
        return value as T;
      } catch (error) {
        lastError = error;
        logCall({ label, model, attempt, ms: Date.now() - started, ok: false, error: (error as Error).message });
        if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new ClaudeError(String(lastError));
  } finally {
    release();
  }
}

/** Startup probe so the dashboard can tell the user to run `claude` and log in. */
export async function healthCheck(): Promise<{ ok: boolean; how: string; message: string }> {
  let how = "unknown";
  try {
    how = resolveClaude().how;
    await ask<{ ok: boolean }>({
      prompt: 'Reply with {"ok": true}. Nothing else.',
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      model: "sonnet",
      timeoutMs: 120_000,
      retries: 0,
      label: "healthCheck",
    });
    return { ok: true, how, message: "Claude CLI 정상" };
  } catch (error) {
    return {
      ok: false,
      how,
      message: `${(error as Error).message} — 터미널에서 \`claude\`를 실행해 로그인 상태를 확인해 주세요.`,
    };
  }
}
