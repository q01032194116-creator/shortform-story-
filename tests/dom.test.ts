/**
 * 네이버 DOM 을 흉내 낸 모의 페이지로 수집·추출 로직을 검증합니다.
 * 실제 네이버에 접속하지 않으므로 네트워크 없이 돌릴 수 있고,
 * 셀렉터가 깨졌을 때 폴백이 살아 있는지를 확인하는 것이 목적입니다.
 *
 * 실행: npm test   (Chromium 이 설치돼 있어야 합니다)
 */
import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import { closeBrowser, openBrowser, type Session } from "../server/naver/browser.js";
import { scrapeSearch } from "../server/naver/collect.js";
import { extractImageUrls } from "../server/naver/images.js";
import { extractBlogId } from "../server/naver/login.js";

const enc = encodeURIComponent;
const PORT = 4599;
const base = `http://localhost:${PORT}`;

const PAGES: Record<string, string> = {
  // 현재 알려진 셀렉터가 살아 있는 경우
  "/news-known": `<!doctype html><meta charset="utf-8"><div id="main_pack"><ul class="list_news">
    <li><div class="news_wrap"><a class="news_tit" href="https://n.news.naver.com/mnews/article/001/0011" title="전세사기 특별법 연장, 무엇이 달라지나">전세사기 특별법 연장, 무엇이 달라지나</a>
      <div class="news_info"><a class="info press">연합뉴스</a><span class="dsc">국토부는 적용 기한을 연장한다고 밝혔다.</span></div></div></li>
    <li><div class="news_wrap"><a class="news_tit" href="https://n.news.naver.com/mnews/article/002/0022" title="서울 아파트 거래량 3개월째 증가">서울 아파트 거래량 3개월째 증가</a>
      <div class="news_info"><a class="info press">한국경제</a></div></div></li></ul></div>`,

  // 클래스명이 전부 바뀐 경우 — 링크 기준 범용 폴백이 동작해야 함
  "/news-renamed": `<!doctype html><meta charset="utf-8"><div id="main_pack"><div class="sds-comps-vertical-layout">
    <div class="card-8f3a"><a href="https://n.news.naver.com/mnews/article/003/0033" target="_blank">청약 제도 개편안 국무회의 통과</a></div>
    <div class="card-8f3a"><a href="https://www.hankyung.com/article/2026091311" target="_blank">오피스텔 공급 물량 역대 최저</a></div>
    <div class="card-8f3a"><a href="https://search.naver.com/related?q=x">연관검색어</a></div>
    <div class="card-8f3a"><a href="https://n.news.naver.com/mnews/article/004/0044">짧음</a></div></div></div>`,

  "/blogs": `<!doctype html><meta charset="utf-8"><div id="main_pack">
    <div class="view_wrap"><a class="title_link" href="https://blog.naver.com/homeowner/223001">청약 당첨 후기와 준비 과정 정리</a></div>
    <div class="view_wrap"><a class="title_link" href="https://blog.naver.com/realtor7/223002">부동산 중개 수수료 계산법 총정리</a></div>
    <div class="view_wrap"><a href="https://cafe.naver.com/xyz/1">카페 글은 제외되어야 합니다</a></div></div>`,

  "/images": `<!doctype html><meta charset="utf-8">
    <img width="240" height="180" src="https://search.pstatic.net/common/?src=${enc("https://cdn.example.com/apartment.jpg")}&type=b400">
    <img width="240" height="180" data-lazy-src="https://search.pstatic.net/common/?src=${enc("https://img.example.kr/officetel.png")}">
    <img width="240" height="180" src="https://search.pstatic.net/common/?src=${enc("https://cdn.example.com/animated.gif")}">
    <img width="240" height="180" src="https://search.pstatic.net/common/?src=${enc("https://cdn.example.com/icon.svg")}">
    <img width="40" height="40" src="https://search.pstatic.net/common/?src=${enc("https://cdn.example.com/tiny-logo.jpg")}">
    <img width="240" height="180" src="data:image/png;base64,iVBORw0KGgo=">
    <img width="240" height="180" src="https://search.pstatic.net/common/?src=${enc("https://cdn.example.com/apartment.jpg")}&type=f200">
    <img width="300" height="200" src="https://cdn.example.com/direct-no-proxy.jpg">`,
};

let server: http.Server;
let session: Session;

before(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGES[req.url ?? ""] ?? "<!doctype html><h1>404</h1>");
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  session = await openBrowser({ headless: true, useSession: false });
});

after(async () => {
  await closeBrowser(session);
  server.close();
});

test("뉴스 수집 — 알려진 셀렉터로 제목과 언론사를 뽑는다", async () => {
  const hits = await scrapeSearch(session.page, `${base}/news-known`, "news", 5);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.title, "전세사기 특별법 연장, 무엇이 달라지나");
  assert.equal(hits[0]?.press, "연합뉴스");
});

test("뉴스 수집 — 클래스명이 바뀌어도 범용 폴백으로 건진다", async () => {
  const hits = await scrapeSearch(session.page, `${base}/news-renamed`, "news", 5);
  assert.equal(hits.length, 2, "기사 링크 2건만 남아야 합니다");
  assert.ok(!hits.some((h) => h.url.includes("search.naver")), "연관검색어는 제외");
  assert.ok(!hits.some((h) => h.title === "짧음"), "8자 미만 제목은 제외");
});

test("블로그 수집 — 카페 링크를 섞지 않는다", async () => {
  const hits = await scrapeSearch(session.page, `${base}/blogs`, "blog", 5);
  assert.equal(hits.length, 2);
  assert.ok(!hits.some((h) => h.url.includes("cafe.naver")));
});

test("이미지 추출 — 썸네일 프록시에서 원본 URL 을 복원한다", async () => {
  await session.page.goto(`${base}/images`);
  const urls = await extractImageUrls(session.page);

  assert.ok(urls.includes("https://cdn.example.com/apartment.jpg"), "프록시 썸네일 복원");
  assert.ok(urls.includes("https://img.example.kr/officetel.png"), "data-lazy-src 처리");
  assert.ok(urls.includes("https://cdn.example.com/direct-no-proxy.jpg"), "직접 링크도 수집");
  assert.ok(!urls.some((u) => u.endsWith(".gif")), "gif 제외");
  assert.ok(!urls.some((u) => u.endsWith(".svg")), "svg 제외");
  assert.ok(!urls.some((u) => u.includes("tiny-logo")), "작은 아이콘 제외");
  assert.ok(!urls.some((u) => u.startsWith("data:")), "data: URI 제외");
  assert.equal(urls.filter((u) => u.includes("apartment")).length, 1, "중복 제거");
});

test("page.evaluate 안의 내부 함수가 __name 오류 없이 실행된다", async () => {
  // tsx(esbuild) 의 keepNames 가 함수를 __name(...) 으로 감싸는데,
  // 그 헬퍼는 Node 쪽에만 있어서 브라우저에 심어 주지 않으면 ReferenceError 가 납니다.
  await session.page.goto(`${base}/blogs`);
  const result = await session.page.evaluate(() => {
    const helper = (value: string) => value.toUpperCase();
    return helper("ok");
  });
  assert.equal(result, "OK");
});

test("블로그 아이디 추출 — 네이버 내부 페이지를 아이디로 오인하지 않는다", () => {
  assert.equal(extractBlogId("https://blog.naver.com/AssetPlaza"), "AssetPlaza");
  assert.equal(extractBlogId("https://blog.naver.com/AssetPlaza/"), "AssetPlaza");

  // 예전에 "BlogHome" 을 아이디로 저장하던 회귀 사례
  assert.equal(extractBlogId("https://section.blog.naver.com/BlogHome.naver"), "");
  assert.equal(extractBlogId("https://blog.naver.com/BlogHome.naver"), "");
  assert.equal(extractBlogId("https://blog.naver.com/PostList.naver?blogId=x"), "");
  assert.equal(extractBlogId("https://blog.naver.com/"), "");
  assert.equal(extractBlogId("https://blog.naver.com/AssetPlaza/223456789"), "", "글 주소는 아이디가 아님");
  assert.equal(extractBlogId("https://m.blog.naver.com/AssetPlaza"), "", "하위 도메인 제외");
  assert.equal(extractBlogId("https://cafe.naver.com/AssetPlaza"), "");
});
