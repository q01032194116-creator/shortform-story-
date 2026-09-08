import { existsSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { realpathSync } from "node:fs";

const IS_WINDOWS = process.platform === "win32";

export interface ClaudeBin {
  /** Executable to spawn. */
  command: string;
  /** Args to prepend before our own (set when we run `node cli.js`). */
  prefix: string[];
  /** True only for the `.cmd` fallback, which needs a shell (and arg quoting). */
  needsShell: boolean;
  how: string;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Walk up from a shim (e.g. `.../npm/claude.cmd`) looking for the package's cli.js. */
function cliJsNear(shimPath: string): string | null {
  let dir = resolve(shimPath, "..");
  for (let i = 0; i < 4; i += 1) {
    const candidate = join(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (isFile(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function searchPath(): string[] {
  const names = IS_WINDOWS ? ["claude.exe", "claude.cmd", "claude.bat", "claude"] : ["claude"];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extra = IS_WINDOWS
    ? [
        join(process.env.LOCALAPPDATA ?? "", "Programs", "claude"),
        join(process.env.USERPROFILE ?? "", ".local", "bin"),
        join(process.env.APPDATA ?? "", "npm"),
      ]
    : [join(process.env.HOME ?? "", ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin"];

  const found: string[] = [];
  for (const dir of [...dirs, ...extra]) {
    if (!dir) continue;
    for (const name of names) {
      const full = join(dir, name);
      if (isFile(full)) found.push(full);
    }
  }
  return found;
}

let cached: ClaudeBin | null = null;

/**
 * Locate the Claude Code CLI in a way that never needs a shell on the happy path.
 *
 * Spawning a `.cmd` on Windows requires `shell: true`, which would force us to
 * quote a JSON Schema argument for cmd.exe. So we prefer, in order: an explicit
 * CLAUDE_BIN, a native executable, `node cli.js`, and only then the `.cmd` shim.
 */
export function resolveClaude(): ClaudeBin {
  if (cached) return cached;

  const override = process.env.CLAUDE_BIN;
  if (override && isFile(override)) {
    cached = override.endsWith(".js")
      ? { command: process.execPath, prefix: [override], needsShell: false, how: `CLAUDE_BIN (node ${override})` }
      : {
          command: override,
          prefix: [],
          needsShell: /\.(cmd|bat)$/i.test(override),
          how: `CLAUDE_BIN (${override})`,
        };
    return cached;
  }

  const candidates = searchPath();

  // 1. Native executable — spawn directly.
  const native = candidates.find((p) => !/\.(cmd|bat|js)$/i.test(p));
  if (native) {
    let target = native;
    try {
      target = realpathSync(native);
    } catch {
      /* keep the original path */
    }
    if (target.endsWith(".js")) {
      cached = { command: process.execPath, prefix: [target], needsShell: false, how: `node ${target}` };
    } else {
      cached = { command: native, prefix: [], needsShell: false, how: native };
    }
    return cached;
  }

  // 2. npm shim -> run the package entrypoint with our own node.
  for (const shim of candidates) {
    const cli = cliJsNear(shim);
    if (cli) {
      cached = { command: process.execPath, prefix: [cli], needsShell: false, how: `node ${cli}` };
      return cached;
    }
  }

  // 3. Last resort: the shim itself, through a shell.
  const shim = candidates[0];
  if (shim) {
    cached = { command: shim, prefix: [], needsShell: /\.(cmd|bat)$/i.test(shim), how: `${shim} (shell)` };
    return cached;
  }

  throw new Error(
    "Claude Code CLI를 찾지 못했습니다. 터미널에서 `claude`가 실행되는지 확인하거나, " +
      "CLAUDE_BIN 환경변수에 실행 파일 경로를 지정해 주세요.",
  );
}

export function resetClaudeCache(): void {
  cached = null;
}

/** Exposed for the settings screen so the user can see what we found. */
export function describeClaude(): string {
  try {
    return resolveClaude().how;
  } catch (error) {
    return (error as Error).message;
  }
}

export { isFile as _isFile, cliJsNear as _cliJsNear };
