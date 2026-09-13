/**
 * Playwright 용 Chromium 이 없으면 설치합니다.
 * 이미 있으면 건너뛰고, 설치에 실패해도 npm install 자체는 실패시키지 않습니다
 * (오프라인/프록시 환경에서 나중에 수동 설치할 수 있도록 안내만 남깁니다).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const label = "[setup]";

async function chromiumPath() {
  try {
    const { chromium } = await import("playwright");
    return chromium.executablePath();
  } catch {
    return null;
  }
}

const path = await chromiumPath();
if (path && existsSync(path)) {
  console.log(`${label} Chromium 이 이미 설치되어 있습니다: ${path}`);
  process.exit(0);
}

console.log(`${label} Chromium 을 설치합니다. 처음 한 번만 몇 분 걸립니다...`);
try {
  // Windows 에서 npx 는 npx.cmd 셔임이므로 shell 을 거쳐야 실행됩니다.
  execFileSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log(`${label} Chromium 설치 완료.`);
} catch {
  console.warn(
    `${label} Chromium 자동 설치에 실패했습니다(네트워크 문제일 수 있습니다).\n` +
      `${label} 네트워크가 되는 곳에서 아래 명령을 직접 실행해 주세요:\n` +
      `${label}   npx playwright install chromium`,
  );
}
