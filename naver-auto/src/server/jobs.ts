import { emit, log } from "./events.js";

export interface JobState {
  id: string | null;
  name: string | null;
  running: boolean;
  startedAt: string | null;
  error: string | null;
}

let state: JobState = { id: null, name: null, running: false, startedAt: null, error: null };

export function jobState(): JobState {
  return state;
}

export class JobBusyError extends Error {
  constructor(name: string) {
    super(`이미 실행 중인 작업이 있습니다: ${name}`);
    this.name = "JobBusyError";
  }
}

/**
 * One job at a time.
 *
 * The whole pipeline drives a single browser and a rate-limited AI CLI, so
 * running two at once would interleave editor keystrokes into the wrong post.
 */
export async function runJob<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (state.running) throw new JobBusyError(state.name ?? "unknown");

  const id = `${Date.now().toString(36)}`;
  state = { id, name, running: true, startedAt: new Date().toISOString(), error: null };
  emit({ type: "state", payload: state });
  log(`▶ ${name} 시작`);

  try {
    const result = await fn();
    state = { ...state, running: false };
    emit({ type: "state", payload: state });
    emit({ type: "done", message: `${name} 완료` });
    return result;
  } catch (error) {
    const message = (error as Error).message;
    state = { ...state, running: false, error: message };
    emit({ type: "state", payload: state });
    emit({ type: "error", message });
    throw error;
  }
}
