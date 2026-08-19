import {
  type LanguagePreference,
  resolveLanguagePreferenceFrom,
  resolveSystemLocaleFromTags,
  type SupportedLocale,
} from "./locales.ts";

export type AppMenuLanguage = SupportedLocale;

export interface AppMenuText {
  about: (appName: string) => string;
  bringAllToFront: string;
  commandPalette: string;
  copy: string;
  cut: string;
  delete: string;
  devTools: string;
  edit: string;
  file: string;
  find: string;
  forceReload: string;
  hide: (appName: string) => string;
  hideOthers: string;
  minimize: string;
  newTerminal: string;
  newWindow: string;
  paste: string;
  pasteAndMatchStyle: string;
  quit: (appName: string) => string;
  redo: string;
  reload: string;
  resetZoom: string;
  selectAll: string;
  services: string;
  settings: string;
  toggleFullscreen: string;
  undo: string;
  unhide: string;
  view: string;
  window: string;
  zoom: string;
  zoomIn: string;
  zoomOut: string;
}

export const APP_MENU_TEXT: Record<AppMenuLanguage, AppMenuText> = {
  en: {
    about: (appName) => `About ${appName}`,
    bringAllToFront: "Bring All to Front",
    commandPalette: "Command Palette",
    copy: "Copy",
    cut: "Cut",
    delete: "Delete",
    devTools: "Developer Tools",
    edit: "Edit",
    file: "File",
    find: "Find",
    forceReload: "Force Reload",
    hide: (appName) => `Hide ${appName}`,
    hideOthers: "Hide Others",
    minimize: "Minimize",
    newTerminal: "New Terminal",
    newWindow: "New Window",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    quit: (appName) => `Quit ${appName}`,
    redo: "Redo",
    reload: "Reload",
    resetZoom: "Reset Zoom",
    selectAll: "Select All",
    services: "Services",
    settings: "Settings...",
    toggleFullscreen: "Toggle Full Screen",
    undo: "Undo",
    unhide: "Show All",
    view: "View",
    window: "Window",
    zoom: "Zoom",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
  },
  "zh-CN": {
    about: (appName) => `关于 ${appName}`,
    bringAllToFront: "全部置于最前",
    commandPalette: "命令面板",
    copy: "复制",
    cut: "剪切",
    delete: "删除",
    devTools: "开发者工具",
    edit: "编辑",
    file: "文件",
    find: "查找",
    forceReload: "强制重新加载",
    hide: (appName) => `隐藏 ${appName}`,
    hideOthers: "隐藏其他",
    minimize: "最小化",
    newTerminal: "新建终端",
    newWindow: "新建窗口",
    paste: "粘贴",
    pasteAndMatchStyle: "粘贴并匹配样式",
    quit: (appName) => `退出 ${appName}`,
    redo: "重做",
    reload: "重新加载",
    resetZoom: "重置缩放",
    selectAll: "全选",
    services: "服务",
    settings: "设置...",
    toggleFullscreen: "切换全屏",
    undo: "撤销",
    unhide: "全部显示",
    view: "视图",
    window: "窗口",
    zoom: "缩放",
    zoomIn: "放大",
    zoomOut: "缩小",
  },
  ja: {
    about: (appName) => `${appName}について`,
    bringAllToFront: "すべてを手前に移動",
    commandPalette: "コマンドパレット",
    copy: "コピー",
    cut: "カット",
    delete: "削除",
    devTools: "デベロッパーツール",
    edit: "編集",
    file: "ファイル",
    find: "検索",
    forceReload: "強制的に再読み込み",
    hide: (appName) => `${appName}を非表示`,
    hideOthers: "ほかを非表示",
    minimize: "最小化",
    newTerminal: "新規ターミナル",
    newWindow: "新規ウインドウ",
    paste: "ペースト",
    pasteAndMatchStyle: "ペーストしてスタイルを合わせる",
    quit: (appName) => `${appName}を終了`,
    redo: "やり直す",
    reload: "再読み込み",
    resetZoom: "拡大率をリセット",
    selectAll: "すべてを選択",
    services: "サービス",
    settings: "設定...",
    toggleFullscreen: "フルスクリーンを切り替え",
    undo: "取り消す",
    unhide: "すべてを表示",
    view: "表示",
    window: "ウインドウ",
    zoom: "ズーム",
    zoomIn: "拡大",
    zoomOut: "縮小",
  },
  ko: {
    about: (appName) => `${appName} 정보`,
    bringAllToFront: "모두 앞으로 가져오기",
    commandPalette: "명령 팔레트",
    copy: "복사",
    cut: "잘라내기",
    delete: "삭제",
    devTools: "개발자 도구",
    edit: "편집",
    file: "파일",
    find: "찾기",
    forceReload: "강제 새로고침",
    hide: (appName) => `${appName} 가리기`,
    hideOthers: "기타 가리기",
    minimize: "최소화",
    newTerminal: "새 터미널",
    newWindow: "새 윈도우",
    paste: "붙여넣기",
    pasteAndMatchStyle: "스타일 일치시켜 붙여넣기",
    quit: (appName) => `${appName} 종료`,
    redo: "실행 복원",
    reload: "새로고침",
    resetZoom: "확대/축소 재설정",
    selectAll: "모두 선택",
    services: "서비스",
    settings: "설정...",
    toggleFullscreen: "전체 화면 전환",
    undo: "실행 취소",
    unhide: "모두 보기",
    view: "보기",
    window: "윈도우",
    zoom: "확대/축소",
    zoomIn: "확대",
    zoomOut: "축소",
  },
};

export function resolveAppMenuLanguage(
  language: LanguagePreference,
  getSystemLocale: () => string
): AppMenuLanguage {
  return resolveLanguagePreferenceFrom(
    language,
    resolveSystemLocaleFromTags([getSystemLocale()])
  );
}
