# 네이버 블로그 자동화 (naver-auto)

키워드 하나로 **수집 → 글감 선정 → 본문 작성 → 이미지 검증 → 에디터 입력 → 발행**까지
진행하는 로컬 대시보드입니다.

- AI는 전부 `claude -p`로 호출합니다. **Claude 구독 요금제로 동작하며 API 키가 필요 없습니다.**
- 웹 접근은 전부 Playwright입니다. 네이버 검색 API를 쓰지 않습니다.
- 이미지는 무료 스톡에서 받은 뒤 **AI가 사진을 직접 열어보고** 적합도를 판정합니다.
- 네이버 아이디·비밀번호는 이 앱이 **받지도, 저장하지도, 입력하지도 않습니다.**

> ⚠️ 네이버 약관상 자동 발행은 회색지대이며 계정 제재 가능성이 있습니다. 하루 발행 상한과
> 발행 간 최소 간격이 기본으로 걸려 있습니다(설정에서 조정 가능). 감수할 위험은 사용자
> 본인의 판단입니다.

## 이 앱은 로컬 전용입니다

이 저장소의 나머지(`app/`, `worker/`, `public/site/`)는 Cloudflare Workers에 배포되는
별개의 사이트입니다. 이 도구는 거기서 돌 수 없습니다 — 실제 브라우저 창, 자식 프로세스,
로컬 디스크가 필요하기 때문입니다. 반드시 본인 PC에서 실행하세요.

## 설치

사전 준비: **Node.js 22.13 이상**, 그리고 터미널에서 `claude`가 실행되고 로그인되어 있을 것.

```bash
cd naver-auto
npm install          # Playwright Chromium까지 자동 설치됩니다
npm run dev          # http://localhost:5174
```

`npm run dev`는 API 서버(5175)와 대시보드(5174)를 함께 띄웁니다. 브라우저에서
**http://localhost:5174** 를 여세요.

## 첫 실행 순서

1. **설정** 탭 → Pexels / Unsplash 키 입력
   (무료: https://www.pexels.com/api/ , https://unsplash.com/developers — 하나만 넣어도 동작)
2. **설정** 탭 → 발행 방식을 우선 **“임시저장만”** 으로 두세요.
   전자동을 켜기 전에 서식이 의도대로 들어가는지 한 번은 눈으로 확인해야 합니다.
3. **실행** 탭 → **네이버 로그인** → 열린 창에서 직접 로그인
   (이 창은 진짜 네이버 페이지입니다. 세션만 `data/`에 저장됩니다.)
4. **실행** 탭 → 키워드 입력 → 실행 → 아래 로그로 진행 확인
5. 네이버 블로그 관리에서 임시저장된 글의 서식·이미지·태그 확인
6. 문제 없으면 설정에서 **완전 자동 발행**으로 전환

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 서버 + 대시보드 (개발) |
| `npm start` | 빌드 후 단일 서버로 실행 (http://localhost:5175) |
| `npm run check` | 타입 검사 |
| `npm test` | 단위 테스트 |
| `npm run smoke:ai` | `claude -p` 연결과 구조화 출력 확인 |
| `npm run smoke:scrape -- "키워드"` | 네이버 수집이 되는지 소스별로 확인 |
| `npm run smoke:collect -- "키워드"` | 수집 + AI 글감 추천까지만 실행 |
| `npm run doctor` | **에디터 셀렉터 진단** (아래 참고) |

## 문제가 생겼을 때

### 글이 안 써지거나 발행이 실패할 때 → `npm run doctor`

네이버는 에디터의 CSS 클래스명을 예고 없이 바꿉니다. 그래서 이 앱은 한글 버튼 라벨
(`발행`, `사진`, `인용구`…)을 1순위 셀렉터로 쓰지만, 그래도 깨질 수 있습니다.

```bash
npm run doctor
```

로그인된 세션으로 에디터를 열어 셀렉터 후보를 하나씩 점검하고, `✓`/`✗`로 보여줍니다.
동시에 `data/debug/`에 에디터 스크린샷과 HTML을 저장합니다. `✗`가 뜬 항목은 그 HTML에서
실제 셀렉터를 찾아 `src/naver/selectors.ts`의 해당 배열 **맨 앞에** 추가하면 됩니다.

### 수집이 0건일 때

`npm run smoke:scrape -- "키워드"` 로 뉴스/블로그 중 어느 쪽이 비었는지 확인하세요.
검색 결과는 URL 패턴(`blog.naver.com/<id>/<글번호>` 등)으로 인식하므로 클래스명 변경에는
강하지만, 네이버가 차단했거나 결과 구조를 크게 바꾸면 `data/debug/`에 HTML이 남습니다.

### `claude` 를 못 찾을 때

`CLAUDE_BIN` 환경변수에 실행 파일 경로를 직접 지정하세요.
Windows 예: `set CLAUDE_BIN=%LOCALAPPDATA%\Programs\claude\claude.exe`

## 저장되는 것

전부 `data/` 아래이며 git에 올라가지 않습니다.

```
data/
  settings.json      설정 (이미지 API 키 포함)
  db.json            글·발행 기록
  naver-profile/     네이버 로그인 브라우저 프로필
  session/           storageState 백업
  images/<글id>/     다운로드한 이미지 후보
  logs/              AI 호출 기록
  debug/             셀렉터 실패 시 스크린샷·HTML
```

로그아웃하면 `naver-profile/`과 `session/`이 삭제됩니다.

## 구조

```
src/
  ai/         claude -p 래퍼, JSON Schema, 프롬프트
  collect/    네이버 검색 스크래핑, 본문 추출, URL 기반 파싱
  write/      글감 선정 → 구성 → 본문 작성
  images/     스톡 검색, 다운로드, AI 적합도 판정
  naver/      로그인·세션, 스마트에디터 자동화, 발행
  server/     Express API, SSE 진행 로그, 작업 큐
  pipeline.ts 전체를 잇는 오케스트레이터
dashboard/    React 대시보드
```

핵심 계약은 `PostBlock[]` 배열입니다. AI가 이 배열을 만들고, 대시보드 미리보기와
네이버 에디터 입력이 **같은 배열**을 읽습니다.
