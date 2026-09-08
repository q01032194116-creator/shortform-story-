/** Scrape one keyword and report what each Naver source returned. */
import { closeScrapeContext } from "../collect/browser.js";
import { relatedKeywords, searchBlog, searchNews } from "../collect/search.js";

const keyword = process.argv[2] ?? "전기차 보조금";
console.log(`키워드: ${keyword}\n`);

try {
  const news = await searchNews(keyword);
  console.log(`[뉴스] ${news.note}`);
  for (const s of news.sources.slice(0, 5)) console.log(`  ${s.rank}. ${s.title}\n     ${s.url}`);

  const blog = await searchBlog(keyword);
  console.log(`\n[블로그] ${blog.note}`);
  for (const s of blog.sources.slice(0, 5)) console.log(`  ${s.rank}. ${s.title}\n     ${s.url}`);

  const related = await relatedKeywords(keyword);
  console.log(`\n[연관검색어] ${related.slice(0, 10).join(", ") || "없음"}`);

  if (news.sources.length === 0 && blog.sources.length === 0) {
    console.log("\n⚠ 결과가 없습니다. data/debug/ 의 HTML을 확인하세요.");
    process.exitCode = 1;
  }
} finally {
  await closeScrapeContext();
}
