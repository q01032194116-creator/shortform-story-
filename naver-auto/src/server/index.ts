import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PATHS, ROOT, ensureDirs } from "../paths.js";
import { healthCheck } from "../ai/claude.js";
import { describeClaude } from "../ai/resolveClaude.js";
import { api } from "./routes.js";
import { addClient } from "./events.js";

const PORT = Number(process.env.PORT ?? 5175);

ensureDirs();

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  addClient(res);
});

app.use("/api", api);

// Downloaded image candidates, so the dashboard can show what the AI judged.
app.use("/images", express.static(PATHS.images));

// In production the dashboard is a built static bundle; in dev Vite serves it.
const dist = resolve(ROOT, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`\n  네이버 블로그 자동화 서버: http://localhost:${PORT}`);
  console.log(`  Claude CLI: ${describeClaude()}\n`);
  void healthCheck().then((result) => {
    console.log(result.ok ? "  ✓ Claude CLI 확인 완료" : `  ✗ ${result.message}`);
  });
});
