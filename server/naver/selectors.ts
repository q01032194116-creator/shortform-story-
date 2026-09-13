import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config.js";

/**
 * 네이버 스마트에디터 ONE 의 클래스명은 해시가 섞여 있고 수시로 바뀝니다.
 * 그래서 (1) 텍스트 기반 셀렉터를 먼저 쓰고 (2) 후보를 배열로 두어 순차 시도하며
 * (3) data/selectors.json 으로 코드 수정 없이 덮어쓸 수 있게 했습니다.
 */
export type SelectorSet = {
  /** 에디터 진입 시 뜨는 "작성 중인 글" 팝업의 취소 버튼 */
  draftPopupCancel: string[];
  /** 에디터 도움말 레이어 닫기 */
  helpClose: string[];
  titleField: string[];
  bodyField: string[];
  toolbarImage: string[];
  toolbarQuote: string[];
  toolbarDivider: string[];
  toolbarBold: string[];
  toolbarFontSize: string[];
  /** 글자 크기 드롭다운에서 소제목용 크기 */
  fontSizeHeading: string[];
  /** 구분선 스타일 선택 레이어의 첫 번째 항목 */
  dividerStyle: string[];
  /** 상단 발행 버튼 (발행 설정 패널을 엶) */
  publishOpen: string[];
  /** 발행 설정 패널 안의 최종 발행 버튼 */
  publishConfirm: string[];
  categoryOpen: string[];
  tagInput: string[];
  visibilityPublic: string[];
  visibilityPrivate: string[];
};

export const DEFAULT_SELECTORS: SelectorSet = {
  draftPopupCancel: [
    "button.se-popup-button-cancel",
    ".se-popup-button-cancel",
    'button:has-text("취소")',
  ],
  helpClose: [
    "button.se-help-panel-close-button",
    ".se-help-panel-close-button",
    'article[class*="help"] button[class*="close"]',
  ],
  titleField: [
    ".se-documentTitle .se-text-paragraph",
    ".se-section-documentTitle .se-text-paragraph",
    ".se-placeholder.__se_placeholder",
    'span[class*="documentTitle"]',
  ],
  bodyField: [
    ".se-main-container .se-component.se-text .se-text-paragraph",
    ".se-main-container .se-text-paragraph",
    ".se-main-container",
  ],
  toolbarImage: [
    'button[data-name="image"]',
    "button.se-image-toolbar-button",
    '.se-toolbar-item-image button',
    'button[title*="사진"]',
  ],
  toolbarQuote: [
    'button[data-name="quotation"]',
    "button.se-quotation-toolbar-button",
    '.se-toolbar-item-quotation button',
    'button[title*="인용구"]',
  ],
  toolbarDivider: [
    'button[data-name="horizontalLine"]',
    "button.se-horizontalLine-toolbar-button",
    '.se-toolbar-item-horizontal-line button',
    'button[title*="구분선"]',
  ],
  toolbarBold: [
    'button[data-name="bold"]',
    "button.se-bold-toolbar-button",
    'button[title*="굵게"]',
  ],
  toolbarFontSize: [
    "button.se-font-size-code-toolbar-button",
    'button[data-name="font-size-code"]',
    'button[title*="글자 크기"]',
  ],
  fontSizeHeading: [
    'button[data-value="fs19"]',
    'li[data-value="fs19"] button',
    '.se-toolbar-option-font-size-code-list button:has-text("19")',
  ],
  dividerStyle: [
    ".se-horizontal-line-type-list button",
    'button[data-value="hr1"]',
    ".se-toolbar-option-horizontal-line-list button",
  ],
  publishOpen: [
    'button.publish_btn__m9KHH',
    '.header .btn_area button:has-text("발행")',
    'button:has-text("발행")',
  ],
  publishConfirm: [
    'button.confirm_btn__WEaBq',
    '.layer_bottom button:has-text("발행")',
    'button[data-testid="seOnePublishBtn"]',
    'div[class*="publish"] button:has-text("발행")',
  ],
  categoryOpen: [
    "button.selectbox_button__jb1Dt",
    'div[class*="category"] button[class*="selectbox"]',
    'button:has-text("카테고리")',
  ],
  tagInput: [
    "input#tag-input",
    'input[class*="tag_input"]',
    'input[placeholder*="태그"]',
  ],
  visibilityPublic: ['input#all', 'label:has-text("전체공개") input', 'label:has-text("전체공개")'],
  visibilityPrivate: ['input#private', 'label:has-text("비공개") input', 'label:has-text("비공개")'],
};

const OVERRIDE_FILE = path.join(DATA_DIR, "selectors.json");

export function loadSelectors(): SelectorSet {
  try {
    const override = JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf8")) as Partial<SelectorSet>;
    const merged = { ...DEFAULT_SELECTORS };
    for (const [key, value] of Object.entries(override)) {
      // 덮어쓴 후보를 앞에 두고 기본값은 폴백으로 남깁니다.
      if (Array.isArray(value) && value.length) {
        merged[key as keyof SelectorSet] = [...value, ...DEFAULT_SELECTORS[key as keyof SelectorSet]];
      }
    }
    return merged;
  } catch {
    return DEFAULT_SELECTORS;
  }
}
