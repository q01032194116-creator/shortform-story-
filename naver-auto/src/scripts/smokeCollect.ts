/** Scrape + let the AI propose topics, without writing or publishing anything. */
import { closeScrapeContext, collect } from "../collect/index.js";
import { loadSettings } from "../settings.js";
import { proposeTopics } from "../write/compose.js";

const keyword = process.argv[2] ?? "전기차 보조금";

try {
  const collection = await collect(keyword, (m) => console.log(`  ${m}`));
  await closeScrapeContext();
  console.log(`\n수집 노트: ${collection.notes.join(" / ")}`);

  const topics = await proposeTopics(keyword, collection.sources, loadSettings());
  console.log(`\n=== 글감 ${topics.length}개 ===`);
  for (const t of topics) {
    console.log(`\n[${t.score}점] ${t.title}`);
    console.log(`  각도: ${t.angle}`);
    console.log(`  지금인 이유: ${t.whyNow}`);
    console.log(`  검색어: ${t.targetKeyword}`);
    console.log(`  경쟁: ${t.competitionNote}`);
  }
} finally {
  await closeScrapeContext();
}
