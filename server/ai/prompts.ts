import type { Block, Source } from "../store.js";

const SOURCE_LIMIT = 1800;

function renderSources(sources: Source[]): string {
  return sources
    .map((s, i) => {
      const body = (s.body ?? s.snippet ?? "").replace(/\s+/g, " ").slice(0, SOURCE_LIMIT);
      return `[${i + 1}] (${s.kind === "news" ? "뉴스" : "블로그"}${s.press ? `/${s.press}` : ""}) ${s.title}\nURL: ${s.url}\n내용: ${body}`;
    })
    .join("\n\n");
}

export function topicPrompt(keyword: string, sources: Source[], usedTitles: string[]): string {
  return `너는 네이버 블로그 콘텐츠 기획자다. 아래는 "${keyword}" 분야에서 지금 네이버 뉴스와 인기 블로그에 올라온 글들을 수집한 것이다.

${renderSources(sources)}

${usedTitles.length ? `이미 우리가 다룬 주제들(중복 금지):\n${usedTitles.slice(0, 40).map((t) => `- ${t}`).join("\n")}\n` : ""}
이 자료를 근거로, 지금 쓰면 검색 유입이 잘 나올 블로그 글감 5개를 골라라.

기준:
- 수집된 자료에 실제로 근거가 있는 주제만. 자료에 없는 사실을 지어내지 마라.
- 단순 뉴스 요약이 아니라, 개인 블로그가 쓸 수 있는 각도(경험·정리·비교·꿀팁)로 비틀어라.
- 제목은 네이버 검색 결과에서 눌리는 형태로. 32자 이내, 낚시성 과장은 금지.
- 이미 다룬 주제와 겹치지 마라.

JSON 배열만 출력하라. 다른 말은 쓰지 마라.
[
  {
    "title": "글 제목",
    "angle": "어떤 각도로 쓸지 한 문장",
    "why": "지금 이 글감이 좋은 이유 한 문장",
    "outline": ["소제목1", "소제목2", "소제목3", "소제목4"],
    "searchTerms": ["본문 이미지 검색에 쓸 한국어 키워드", "..."],
    "sourceIndexes": [1, 3]
  }
]`;
}

export function writePrompt(
  topic: { title: string; angle: string; outline: string[] },
  sources: Source[],
  options: { minChars: number; imagesPerPost: number },
): string {
  return `너는 한국어 블로그를 오래 운영해 온 사람이다. 아래 주제로 네이버 블로그 글 한 편을 써라.

제목 후보: ${topic.title}
각도: ${topic.angle}
목차 초안:
${topic.outline.map((o) => `- ${o}`).join("\n")}

참고 자료 (여기 있는 사실만 사용하라):
${renderSources(sources)}

작성 규칙 — 반드시 지켜라:
1. 참고 자료의 문장을 그대로 옮기지 마라. 사실과 논점만 가져와서 완전히 새 문장으로 다시 써라. 표절은 네이버 유사문서 필터에 걸린다.
2. 자료에 없는 수치·날짜·인용을 지어내지 마라. 확실하지 않으면 단정하지 말고 "~로 알려져 있다"처럼 써라.
3. 사람이 쓴 것처럼 자연스럽게. 딱딱한 개조식이나 AI 말투("~에 대해 알아보겠습니다", "결론적으로", "여러분") 남발 금지. 존댓말 블로그 톤(~해요/~합니다)으로 일관되게.
4. 공백 제외 ${options.minChars}자 이상.
5. 한 문단은 2~4문장. 문단마다 줄바꿈. 모바일에서 읽기 좋게 짧게 끊어라.
6. 소제목(heading)은 3~5개. 목차 초안을 참고하되 더 나은 게 있으면 바꿔도 된다.
7. 핵심 요약이나 인상적인 한 줄은 quote 블록으로, 항목 나열은 list 블록으로, 흐름이 크게 바뀌는 곳엔 divider 를 써라.
8. image 블록을 정확히 ${options.imagesPerPost}개 넣어라. 글 맨 위에 대표 이미지 1개를 두고 나머지는 본문 중간에 배치하라.
   - query: 네이버 이미지 검색에 넣을 한국어 검색어 (구체적인 사물/장면으로. 추상어 금지)
   - need: 이 자리에 어떤 사진이 와야 하는지 설명. 나중에 AI 가 이 설명을 기준으로 사진을 심사한다.
   - caption: 사진 아래에 넣을 짧은 설명
9. 마지막 문단은 독자에게 말을 거는 마무리로. 태그는 5~8개, # 없이 단어만.

JSON 객체만 출력하라. 다른 말은 쓰지 마라.
{
  "title": "최종 제목(32자 이내)",
  "tags": ["태그", "..."],
  "blocks": [
    {"type": "image", "query": "...", "need": "...", "caption": "..."},
    {"type": "paragraph", "text": "..."},
    {"type": "heading", "text": "..."},
    {"type": "quote", "text": "..."},
    {"type": "list", "items": ["...", "..."]},
    {"type": "divider"}
  ]
}`;
}

export function imageJudgePrompt(
  block: Extract<Block, { type: "image" }>,
  articleTitle: string,
  candidateCount: number,
): string {
  return `너는 블로그 편집자다. 아래 글의 특정 자리에 넣을 사진을 고른다.

글 제목: ${articleTitle}
이 자리에 필요한 사진: ${block.need}
검색어: ${block.query}
캡션: ${block.caption}

후보 이미지 ${candidateCount}장을 직접 열어서 보고 판단하라.

탈락 기준 — 하나라도 해당하면 절대 고르지 마라:
- 워터마크, 로고, 스톡사진 업체 표식이 크게 박혀 있다
- 글자/자막/표가 화면을 덮고 있다 (인포그래픽, 카드뉴스, 썸네일)
- 화질이 뭉개졌거나 심하게 작다
- 캡처 화면, 광고 배너, 상품 상세페이지
- 사람 얼굴이 크게 나온 인물 사진 (초상권)
- 내용이 "${block.need}" 와 동떨어진다

여러 장이 조건을 만족하면 가장 깔끔하고 글 분위기에 맞는 것을 골라라.
조건을 만족하는 사진이 하나도 없으면 best 를 null 로 두어라. 억지로 고르지 마라.

JSON 객체만 출력하라.
{"best": 0, "reason": "고른(또는 전부 탈락시킨) 이유 한 문장"}`;
}
