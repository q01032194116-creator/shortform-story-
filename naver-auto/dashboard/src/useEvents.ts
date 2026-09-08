import { useEffect, useRef, useState } from "react";

export interface LogLine {
  type: "log" | "stage" | "done" | "error" | "state";
  message?: string;
  at: string;
  key: number;
}

/** Subscribe to the server's job event stream. */
export function useEvents(onState: () => void): LogLine[] {
  const [lines, setLines] = useState<LogLine[]>([]);
  const counter = useRef(0);
  const stateCallback = useRef(onState);
  stateCallback.current = onState;

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as Omit<LogLine, "key">;
      if (data.type === "state") {
        stateCallback.current();
        return;
      }
      if (data.type === "done" || data.type === "error") stateCallback.current();
      counter.current += 1;
      setLines((prev) => [...prev.slice(-400), { ...data, key: counter.current }]);
    };
    return () => source.close();
  }, []);

  return lines;
}
