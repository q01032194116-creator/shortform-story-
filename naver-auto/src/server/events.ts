import type { Response } from "express";

export interface JobEvent {
  type: "log" | "stage" | "done" | "error" | "state";
  message?: string;
  stage?: string;
  payload?: unknown;
  at: string;
}

const clients = new Set<Response>();
const history: JobEvent[] = [];
const HISTORY_LIMIT = 300;

export function addClient(res: Response): void {
  clients.add(res);
  // Replay recent events so a dashboard opened mid-run is not blank.
  for (const event of history.slice(-80)) send(res, event);
  res.on("close", () => clients.delete(res));
}

function send(res: Response, event: JobEvent): void {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    clients.delete(res);
  }
}

export function emit(event: Omit<JobEvent, "at">): void {
  const full: JobEvent = { ...event, at: new Date().toISOString() };
  history.push(full);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  for (const client of clients) send(client, full);
}

export const log = (message: string): void => emit({ type: "log", message });
export const stage = (name: string, message?: string): void => emit({ type: "stage", stage: name, message });
