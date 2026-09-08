import assert from "node:assert/strict";
import test from "node:test";
import { anchorsToHits, canonicalUrl, isBlogPostUrl, isNewsUrl } from "../src/collect/parse.js";

test("recognises Naver blog post URLs", () => {
  assert.ok(isBlogPostUrl("https://blog.naver.com/someone/223456789012"));
  assert.ok(isBlogPostUrl("https://m.blog.naver.com/someone/223456789012"));
  assert.ok(!isBlogPostUrl("https://blog.naver.com/someone"));
  assert.ok(!isBlogPostUrl("https://search.naver.com/search.naver?query=x"));
});

test("recognises news URLs and rejects Naver chrome", () => {
  assert.ok(isNewsUrl("https://n.news.naver.com/mnews/article/001/0014567890"));
  assert.ok(isNewsUrl("https://www.yna.co.kr/view/AKR20250101"));
  assert.ok(!isNewsUrl("https://search.naver.com/search.naver?query=x"));
  assert.ok(!isNewsUrl("https://blog.naver.com/x/223456789012"));
});

test("canonicalises mobile and desktop blog URLs together", () => {
  const a = canonicalUrl("https://m.blog.naver.com/me/223456789012?from=search");
  const b = canonicalUrl("https://blog.naver.com/me/223456789012");
  assert.equal(a, b);
});

test("strips tracking params from publisher URLs", () => {
  const url = canonicalUrl("https://www.yna.co.kr/view/AKR1?utm_source=naver&sid=100");
  assert.ok(!url.includes("utm_source"));
  assert.ok(!url.includes("sid="));
});

test("ranks anchors by DOM order and drops chrome links", () => {
  const hits = anchorsToHits(
    [
      { href: "https://search.naver.com/search.naver?query=x", text: "검색", containerText: "", order: 0 },
      {
        href: "https://blog.naver.com/alpha/223000000001",
        text: "가을 등산 준비물 총정리",
        containerText: "가을 등산 준비물 총정리 초보자를 위한 체크리스트입니다 3일 전",
        order: 5,
      },
      { href: "https://blog.naver.com/beta/223000000002", text: "더보기", containerText: "더보기", order: 6 },
      {
        href: "https://m.blog.naver.com/alpha/223000000001",
        text: "가을 등산 준비물 총정리",
        containerText: "중복",
        order: 9,
      },
      {
        href: "https://blog.naver.com/gamma/223000000003",
        text: "등산화 고르는 기준 정리했습니다",
        containerText: "등산화 고르는 기준 정리했습니다 발볼 넓은 분들 참고 2025.09.01.",
        order: 12,
      },
    ],
    "blog",
  );

  assert.equal(hits.length, 2, "dedupes mobile/desktop and drops nav links");
  assert.equal(hits[0]!.title, "가을 등산 준비물 총정리");
  assert.equal(hits[0]!.publisher, "alpha");
  assert.equal(hits[0]!.postedAt, "3일 전");
  assert.equal(hits[1]!.postedAt, "2025.09.01.");
  assert.ok(hits[0]!.snippet.includes("초보자를 위한"));
});

test("news hits carry the publisher host", () => {
  const hits = anchorsToHits(
    [
      {
        href: "https://www.hankyung.com/article/2025090112345",
        text: "전기차 보조금 개편안 발표",
        containerText: "전기차 보조금 개편안 발표 한국경제 1시간 전",
        order: 3,
      },
    ],
    "news",
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.publisher, "hankyung.com");
  assert.equal(hits[0]!.postedAt, "1시간 전");
});
