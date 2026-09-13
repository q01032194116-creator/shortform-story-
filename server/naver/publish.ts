import type { Frame, Page } from "playwright";
import { loadSettings } from "../config.js";
import type { Block, Draft } from "../store.js";
import { logger } from "../util/log.js";
import { closeBrowser, isLoggedIn, openBrowser, shot, sleep, startDebugRun, type Session } from "./browser.js";
import { loadSelectors, type SelectorSet } from "./selectors.js";

const log = logger("publish");

/** 후보 셀렉터를 순서대로 시도해 처음 보이는 것을 반환합니다. */
async function findFirst(frame: Frame, candidates: string[], timeoutMs = 4000) {
  for (const selector of candidates) {
    const locator = frame.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      return locator;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

async function clickFirst(frame: Frame, candidates: string[], label: string, required = true) {
  const locator = await findFirst(frame, candidates);
  if (!locator) {
    const message = `${label} 요소를 찾지 못했습니다. data/selectors.json 으로 셀렉터를 교정할 수 있습니다.`;
    if (required) throw new Error(message);
    log.warn(message);
    return false;
  }
  await locator.click({ timeout: 8000 });
  await sleep(300);
  return true;
}

/** 에디터가 들어 있는 프레임을 찾습니다. */
async function editorFrame(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const frames = [page.mainFrame(), ...page.frames()];
    for (const frame of frames) {
      const found = await frame
        .locator(".se-main-container, .se-documentTitle")
        .first()
        .count()
        .catch(() => 0);
      if (found) return frame;
    }
    await sleep(700);
  }
  throw new Error("스마트에디터 프레임을 찾지 못했습니다. 로그인이 풀렸거나 에디터가 열리지 않았습니다.");
}

/** 에디터 진입 직후 뜨는 팝업/도움말 레이어를 정리합니다. */
async function dismissOverlays(frame: Frame, selectors: SelectorSet) {
  await clickFirst(frame, selectors.draftPopupCancel, "이전 작성글 팝업", false);
  await clickFirst(frame, selectors.helpClose, "도움말 레이어", false);
}

/** 지금 커서가 있는 줄 전체를 선택합니다. */
async function selectCurrentLine(page: Page) {
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

async function typeParagraph(page: Page, text: string) {
  // 에디터가 줄바꿈 문자를 그대로 받지 못하므로 Enter 로 문단을 나눕니다.
  const lines = text.split(/\n+/).filter(Boolean);
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line, { delay: 8 + Math.random() * 12 });
  }
  await page.keyboard.press("Enter");
}

/** 소제목: 굵게 + 큰 글씨로 만들어 본문과 구분되게 합니다. */
async function typeHeading(page: Page, frame: Frame, selectors: SelectorSet, text: string) {
  await page.keyboard.press("Enter"); // 소제목 위 여백
  await page.keyboard.type(text, { delay: 10 });
  await selectCurrentLine(page);
  await clickFirst(frame, selectors.toolbarBold, "굵게 버튼", false);
  if (await clickFirst(frame, selectors.toolbarFontSize, "글자 크기 버튼", false)) {
    await clickFirst(frame, selectors.fontSizeHeading, "소제목 글자 크기", false);
  }
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  // 다음 문단이 소제목 서식을 물려받지 않도록 되돌립니다.
  await clickFirst(frame, selectors.toolbarBold, "굵게 해제", false);
}

async function insertQuote(page: Page, frame: Frame, selectors: SelectorSet, text: string) {
  if (!(await clickFirst(frame, selectors.toolbarQuote, "인용구 버튼", false))) {
    // 인용구 버튼을 못 찾으면 일반 문단으로 대체합니다.
    await typeParagraph(page, `"${text}"`);
    return;
  }
  await sleep(400);
  await page.keyboard.type(text, { delay: 10 });
  // 인용구 블록 밖으로 빠져나옵니다.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

async function insertDivider(page: Page, frame: Frame, selectors: SelectorSet) {
  if (!(await clickFirst(frame, selectors.toolbarDivider, "구분선 버튼", false))) return;
  await sleep(400);
  await clickFirst(frame, selectors.dividerStyle, "구분선 스타일", false);
  await sleep(400);
  await page.keyboard.press("End");
}

async function insertList(page: Page, items: string[]) {
  // 목록 툴바는 버전차가 커서, 가독성이 확실한 불릿 문자를 직접 씁니다.
  for (const item of items) {
    await page.keyboard.type(`· ${item}`, { delay: 8 });
    await page.keyboard.press("Enter");
  }
  await page.keyboard.press("Enter");
}

async function insertImage(
  page: Page,
  frame: Frame,
  selectors: SelectorSet,
  block: Extract<Block, { type: "image" }>,
) {
  if (!block.file) return;

  // .catch 를 즉시 붙여 둡니다. 사진 버튼을 못 찾아 아래에서 return 해 버리면
  // 이 Promise 를 아무도 기다리지 않게 되고, 15초 뒤 거부되면서
  // 처리되지 않은 Promise 거부로 서버 프로세스 전체가 죽습니다.
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 15_000 }).catch(() => null);

  const clicked = await clickFirst(frame, selectors.toolbarImage, "사진 버튼", false);
  if (!clicked) {
    log.warn("사진 버튼을 찾지 못해 이미지를 건너뜁니다.");
    return;
  }

  const chooser = await chooserPromise;
  if (!chooser) {
    log.warn("파일 선택 창이 뜨지 않아 이미지를 건너뜁니다.");
    return;
  }
  await chooser.setFiles(block.file);

  // 업로드가 끝나 이미지 컴포넌트가 붙을 때까지 기다립니다.
  await frame
    .locator(".se-component.se-image")
    .last()
    .waitFor({ state: "visible", timeout: 60_000 })
    .catch(() => log.warn("이미지 업로드 완료를 확인하지 못했습니다."));
  await sleep(1500);

  if (block.caption) {
    // 이미지 삽입 직후 캡션 입력란에 포커스가 가 있는 버전이 많습니다.
    await page.keyboard.type(block.caption, { delay: 10 });
    await sleep(300);
  }
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

async function writeBody(page: Page, frame: Frame, selectors: SelectorSet, draft: Draft) {
  const body = await findFirst(frame, selectors.bodyField, 10_000);
  if (!body) throw new Error("본문 입력 영역을 찾지 못했습니다.");
  await body.click();
  await sleep(500);

  for (const [index, block] of draft.blocks.entries()) {
    log.info(`본문 ${index + 1}/${draft.blocks.length} — ${block.type}`);
    switch (block.type) {
      case "heading":
        await typeHeading(page, frame, selectors, block.text);
        break;
      case "paragraph":
        await typeParagraph(page, block.text);
        break;
      case "quote":
        await insertQuote(page, frame, selectors, block.text);
        break;
      case "list":
        await insertList(page, block.items);
        break;
      case "divider":
        await insertDivider(page, frame, selectors);
        break;
      case "image":
        await insertImage(page, frame, selectors, block);
        break;
    }
    await sleep(250);
  }
}

async function fillPublishPanel(page: Page, frame: Frame, selectors: SelectorSet, draft: Draft) {
  const settings = loadSettings();

  // 발행 설정 패널은 에디터 프레임 밖(최상위 문서)에 뜨는 경우도 있어 둘 다 봅니다.
  const scopes = [frame, page.mainFrame(), ...page.frames()];
  const findScope = async (candidates: string[]) => {
    for (const scope of scopes) {
      const locator = await findFirst(scope, candidates, 1500);
      if (locator) return { scope, locator };
    }
    return null;
  };

  if (settings.category.trim()) {
    const opener = await findScope(selectors.categoryOpen);
    if (opener) {
      await opener.locator.click();
      await sleep(500);
      const option = opener.scope.locator(`label:has-text("${settings.category}"), li:has-text("${settings.category}")`).first();
      if (await option.count()) {
        await option.click();
        log.info(`카테고리: ${settings.category}`);
      } else {
        log.warn(`카테고리 "${settings.category}" 를 찾지 못해 기본값으로 둡니다.`);
      }
    } else {
      log.warn("카테고리 선택 UI 를 찾지 못했습니다. 기본 카테고리로 발행합니다.");
    }
  }

  const visibility = settings.visibility === "public" ? selectors.visibilityPublic : selectors.visibilityPrivate;
  const visibilityTarget = await findScope(visibility);
  if (visibilityTarget) await visibilityTarget.locator.click({ force: true }).catch(() => {});

  const tags = [...new Set([...draft.tags, ...settings.fixedTags])].filter(Boolean).slice(0, 10);
  if (tags.length) {
    const tagField = await findScope(selectors.tagInput);
    if (tagField) {
      await tagField.locator.click();
      for (const tag of tags) {
        await page.keyboard.type(tag, { delay: 20 });
        await page.keyboard.press("Enter");
        await sleep(200);
      }
      log.info(`태그 ${tags.length}개 입력`);
    } else {
      log.warn("태그 입력란을 찾지 못했습니다.");
    }
  }

  const confirm = await findScope(selectors.publishConfirm);
  if (!confirm) throw new Error("최종 발행 버튼을 찾지 못했습니다. data/selectors.json 으로 교정해 주세요.");
  await confirm.locator.click();
}

/** 초안을 실제 네이버 블로그에 발행합니다. 성공 시 글 URL 을 반환합니다. */
export async function publishDraft(draft: Draft): Promise<string> {
  const settings = loadSettings();
  if (!settings.blogId.trim()) throw new Error("블로그 아이디가 비어 있습니다. 설정에서 입력해 주세요.");

  const selectors = loadSelectors();
  startDebugRun(`publish-${draft.id}`);

  let session: Session | null = null;
  try {
    session = await openBrowser({ useSession: true });
    const { page, context } = session;

    if (!(await isLoggedIn(context))) {
      throw new Error("네이버 로그인 세션이 만료되었습니다. 대시보드에서 다시 로그인해 주세요.");
    }

    log.step("스마트에디터를 엽니다.");
    await page.goto(`https://blog.naver.com/${settings.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded" });
    const frame = await editorFrame(page);
    await sleep(1500);
    await shot(page, "editor-opened");

    await dismissOverlays(frame, selectors);
    await shot(page, "overlays-dismissed");

    log.step(`제목 입력: ${draft.title}`);
    const title = await findFirst(frame, selectors.titleField, 10_000);
    if (!title) throw new Error("제목 입력란을 찾지 못했습니다.");
    await title.click();
    await sleep(300);
    await page.keyboard.type(draft.title, { delay: 20 });
    await shot(page, "title-typed");

    log.step("본문 작성 중...");
    await writeBody(page, frame, selectors, draft);
    await shot(page, "body-written");

    log.step("발행 설정 패널을 엽니다.");
    await clickFirst(frame, selectors.publishOpen, "발행 버튼");
    await sleep(1500);
    await shot(page, "publish-panel");

    await fillPublishPanel(page, frame, selectors, draft);

    log.step("발행 처리 대기 중...");
    await page
      .waitForURL((url) => /blog\.naver\.com\/[^/]+\/\d+/.test(url.toString()), { timeout: 60_000 })
      .catch(() => log.warn("발행 후 이동한 URL 을 확인하지 못했습니다."));
    await sleep(2000);
    await shot(page, "published");

    const postUrl = page.url();
    log.done(`발행 완료: ${postUrl}`);
    return postUrl;
  } finally {
    await closeBrowser(session);
  }
}
