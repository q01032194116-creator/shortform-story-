import { EventEmitter } from "node:events";

export type LogLevel = "info" | "step" | "warn" | "error" | "done";
export type LogEvent = { at: string; level: LogLevel; scope: string; message: string };

class JobLog extends EventEmitter {
  private buffer: LogEvent[] = [];
  private running = false;
  private currentLabel = "";

  emitLog(level: LogLevel, scope: string, message: string) {
    const event: LogEvent = { at: new Date().toISOString(), level, scope, message };
    this.buffer.push(event);
    if (this.buffer.length > 800) this.buffer.shift();
    const line = `[${scope}] ${message}`;
    if (level === "error") console.error(line);
    else console.log(line);
    this.emit("log", event);
  }

  recent() {
    return this.buffer;
  }

  get busy() {
    return this.running;
  }

  get label() {
    return this.currentLabel;
  }

  /** 동시에 두 개의 파이프라인이 같은 브라우저 세션을 건드리지 않도록 직렬화합니다. */
  async lock<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error(`이미 실행 중입니다: ${this.currentLabel}`);
    this.running = true;
    this.currentLabel = label;
    this.emit("state");
    try {
      return await fn();
    } finally {
      this.running = false;
      this.currentLabel = "";
      this.emit("state");
    }
  }
}

export const log = new JobLog();

export const logger = (scope: string) => ({
  info: (m: string) => log.emitLog("info", scope, m),
  step: (m: string) => log.emitLog("step", scope, m),
  warn: (m: string) => log.emitLog("warn", scope, m),
  error: (m: string) => log.emitLog("error", scope, m),
  done: (m: string) => log.emitLog("done", scope, m),
});
