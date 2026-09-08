import { useEffect, useRef } from "react";
import type { LogLine } from "../useEvents";

const CLASS: Record<string, string> = { stage: "stage", error: "err", done: "done" };

export function LogPanel({ lines }: { lines: LogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="logs">
      {lines.length === 0 && <div className="l">작업 로그가 여기에 표시됩니다.</div>}
      {lines.map((line) => (
        <div key={line.key} className={`l ${CLASS[line.type] ?? ""}`}>
          <span className="t">{new Date(line.at).toLocaleTimeString("ko-KR")}</span>
          {line.message}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
