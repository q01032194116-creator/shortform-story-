import type { FormattingProfile, Source, Topic } from "../types.js";

/** Trim source bodies so a full collection still fits comfortably in one call. */
function clip(text: string | null, max: number): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function renderSources(sources: Source[], bodyChars: number): string {
  return sources
    .map((s) =>
      [
        `### ${s.id} [${s.kind === "news" ? "뉴스" : "블로그"} / 노출순위 ${s.rank}]`,
        `제목: ${s.title}`,
        s.publisher ? `출처: ${s.publisher}` : null,
        s.postedAt ? `작성: ${s.postedAt}` : null,
        `URL: ${s.url}`,
        s.body ? `본문: ${clip(s.body, bodyChars)}` : `요약: ${clip(s.snippet, 400)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function topicsPrompt(keyword: string, sources: Source[]): string {
  return `당신은 네이버 블로그 상위노출에 능한 한국인 콘텐츠 기획자입니다.

아래는 "${keyword}" 키워드로 네이버 뉴스 탭과 블로그 탭에서 방금 수집한 자료입니다.
노출순위(rank)가 낮을수록 네이버가 상위에 띄운 글, 즉 지금 잘 먹히는 글입니다.

${renderSources(sources, 1200)}

이 자료를 근거로 지금 쓰면 유입이 나올 블로그 글감을 3~5개 제안하세요.

판단 기준:
- 지금 이슈가 되고 있는가 (뉴스의 최신성, 블로그 상위노출 글의 공통 관심사)
- 검색 수요가 있는 구체적 키워드인가 (너무 넓은 주제 금지)
- 이미 상위 블로그들이 다 다룬 내용이면, 빠진 각도를 찾아 차별화할 것
- 개인 블로그가 경험·정리·비교로 이길 수 있는 주제인가

각 항목:
- title: 블로그 글 제목안 (32자 내외, 낚시성 금지, 검색 키워드 포함)
- angle: 다른 글과 어떻게 다르게 쓸 것인지 구체적으로
- whyNow: 지금 이 글감이 유효한 이유 (수집 자료의 근거를 들 것)
- targetKeyword: 노리는 검색어 하나
- sourceIds: 근거가 된 자료 id 배열 (위 ### 뒤의 id를 그대로)
- score: 0~10 추천도
- competitionNote: 현재 상위노출 경쟁 상황 한 줄 평

한국어로 작성하세요.`;
}

export function outlinePrompt(topic: Topic, sources: Source[], profile: FormattingProfile): string {
  return `당신은 네이버 블로그를 오래 운영해 온 한국인 블로거입니다.

이번에 쓸 글:
- 제목안: ${topic.title}
- 차별화 각도: ${topic.angle}
- 노리는 검색어: ${topic.targetKeyword}
- 지금 쓰는 이유: ${topic.whyNow}

참고 자료(그대로 베끼면 안 되고, 사실 확인과 소재로만 쓸 것):

${renderSources(sources, 2000)}

이 글의 뼈대를 잡으세요.
- titleCandidates: 제목 후보 3개 (각 32자 내외, 검색어를 앞쪽에 자연스럽게)
- hook: 첫 문단에 쓸 도입부 한두 문장 (독자의 상황을 짚어주는 방식)
- sections: 소제목 ${Math.max(3, Math.min(5, profile.imagesPerPost + 1))}개 내외.
  각각 heading(소제목), points(그 안에서 다룰 논점 2~4개), imageHint(그 섹션에 어울리는
  사진을 한국어로 묘사 — 인물/사물/분위기가 드러나게 구체적으로)
- tags: 네이버 태그 ${profile.tagCount}개 (# 없이, 검색어 조합)

한국어로 작성하세요.`;
}

export function writePrompt(
  topic: Topic,
  outline: { titleCandidates: string[]; hook: string; sections: Array<{ heading: string; points: string[]; imageHint: string }>; tags: string[] },
  sources: Source[],
  profile: FormattingProfile,
): string {
  return `당신은 네이버 블로그를 운영하는 한국인입니다. 아래 뼈대로 본문을 완성하세요.

제목 후보: ${outline.titleCandidates.join(" / ")}
도입부 방향: ${outline.hook}
구성:
${outline.sections.map((s, i) => `${i + 1}. ${s.heading}\n   - ${s.points.join("\n   - ")}\n   (이미지: ${s.imageHint})`).join("\n")}

참고 자료:

${renderSources(sources, 2500)}

## 반드시 지킬 것

1. **표현을 그대로 쓰지 마세요.** 참고 자료의 문장·구절을 복사하면 네이버 유사문서 필터에
   걸립니다. 사실과 숫자만 가져오고 문장은 100% 새로 쓰세요.
2. **사람이 쓴 것처럼.** "~입니다"체 기본, 1인칭 경험과 감상을 섞고, AI 특유의
   "결론적으로", "~할 수 있습니다", "중요한 역할을 합니다" 같은 상투구를 피하세요.
3. **문단은 2~3줄.** 모바일에서 읽히는 글입니다. 긴 문단 금지.
4. **검색어 "${topic.targetKeyword}"** 를 제목·첫 문단·소제목에 자연스럽게 넣되,
   억지로 반복하지 마세요 (본문 전체에서 5~8회면 충분).
5. **단정적 표현 주의.** 의학·법률·투자 주제라면 "개인 경험", "전문가 상담 권장"을 명시하고
   효능·수익을 단정하지 마세요.
6. 마지막에 참고한 출처를 자연스럽게 언급하는 문단을 하나 넣으세요.

## blocks 작성 규칙

blocks 배열로 본문을 구성합니다. 각 원소의 type과 필드:
- {"type":"paragraph","text":"..."} 일반 문단
- {"type":"heading","text":"..."} 소제목
- {"type":"quote","text":"..."} 강조하고 싶은 핵심 한 줄
- {"type":"list","items":["...","..."]} 목록
- {"type":"divider"} 섹션 구분선
- {"type":"image","hint":"사진 묘사"} 이미지가 들어갈 자리

- 이미지 블록은 정확히 ${profile.imagesPerPost}개, 소제목 아래에 하나씩 배치하세요.
- 소제목마다 문단 2~4개를 두세요.
- 전체 분량 1500~2500자.
- title은 제목 후보 중 가장 나은 것을 고르거나 다듬어서 넣으세요.
- tags는 ${profile.tagCount}개.

한국어로 작성하세요.`;
}

export function imageQueryPrompt(postTitle: string, sectionHint: string): string {
  return `블로그 글 "${postTitle}"의 한 섹션에 넣을 사진을 무료 스톡 사이트(Pexels, Unsplash)에서
찾으려 합니다. 그 섹션에 필요한 사진은 이렇습니다: "${sectionHint}"

스톡 사이트 검색에 넣을 **영어** 검색어를 2~3개 만들어 주세요.
- 스톡 사진에 실제로 존재할 법한 보편적인 장면으로 (한국 고유명사·브랜드·특정 인물 금지)
- 각 검색어는 2~4단어
- 서로 다른 각도로 (예: 인물 중심 / 사물 클로즈업 / 분위기)`;
}

export function imageVerdictPrompt(imagePath: string, postTitle: string, sectionHint: string): string {
  return `다음 이미지 파일을 Read 도구로 실제로 열어서 보고 판단하세요:
${imagePath}

이 사진은 블로그 글 "${postTitle}"의 한 섹션에 넣을 후보입니다.
그 섹션이 필요로 하는 사진: "${sectionHint}"

실제로 보이는 내용을 근거로 평가하세요:
- score: 0~10 적합도
- fits: 본문에 써도 되는지 (7점 이상이고 아래 결격 사유가 없을 때만 true)
- reason: 사진에 무엇이 보이는지와 왜 그 점수인지 (한국어, 구체적으로)
- altText: 대체 텍스트 (한국어, 한 문장)
- caption: 사진 아래 넣을 짧은 캡션 (한국어, 15자 내외)

결격 사유 (하나라도 있으면 fits=false):
- 주제와 무관하거나 억지스러움
- 워터마크, 로고, 특정 상호·전화번호 등 광고성 요소
- 읽을 수 없는 외국어 텍스트가 화면을 덮음
- 화질이 뭉개졌거나 구도가 어색함
- 사람 얼굴이 크게 나와 초상권이 걱정되는 경우`;
}
