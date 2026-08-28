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
  closePanel: string;
  commandPalette: string;
  copy: string;
  cut: string;
  delete: string;
  devTools: string;
  edit: string;
  file: string;
  find: string;
  findNext: string;
  findPrevious: string;
  focusDown: string;
  focusLeft: string;
  focusRight: string;
  focusUp: string;
  focusWaiting: string;
  forceReload: string;
  hide: (appName: string) => string;
  hideOthers: string;
  listAgents: string;
  minimize: string;
  newTerminal: string;
  newWindow: string;
  nextTab: string;
  paste: string;
  pasteAndMatchStyle: string;
  prevTab: string;
  quit: (appName: string) => string;
  redo: string;
  reload: string;
  resetZoom: string;
  searchInFiles: string;
  selectAll: string;
  services: string;
  settings: string;
  splitDown: string;
  splitRight: string;
  toggleFullscreen: string;
  toggleSideTree: string;
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
    closePanel: "Close Panel",
    commandPalette: "Command Palette",
    copy: "Copy",
    cut: "Cut",
    delete: "Delete",
    devTools: "Developer Tools",
    edit: "Edit",
    file: "File",
    find: "Find",
    findNext: "Find Next",
    findPrevious: "Find Previous",
    focusDown: "Focus Down",
    focusLeft: "Focus Left",
    focusRight: "Focus Right",
    focusUp: "Focus Up",
    focusWaiting: "Jump to Next Needing Attention",
    forceReload: "Force Reload",
    hide: (appName) => `Hide ${appName}`,
    hideOthers: "Hide Others",
    listAgents: "Agent List",
    minimize: "Minimize",
    newTerminal: "New Terminal",
    newWindow: "New Window",
    nextTab: "Next Tab",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    prevTab: "Previous Tab",
    quit: (appName) => `Quit ${appName}`,
    redo: "Redo",
    reload: "Reload",
    resetZoom: "Reset Zoom",
    searchInFiles: "Search in Files",
    selectAll: "Select All",
    services: "Services",
    settings: "Settings...",
    splitDown: "Split Down",
    splitRight: "Split Right",
    toggleFullscreen: "Toggle Full Screen",
    toggleSideTree: "Toggle File Tree",
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
    closePanel: "关闭面板",
    commandPalette: "命令面板",
    copy: "复制",
    cut: "剪切",
    delete: "删除",
    devTools: "开发者工具",
    edit: "编辑",
    file: "文件",
    find: "查找",
    findNext: "查找下一个",
    findPrevious: "查找上一个",
    focusDown: "聚焦下方",
    focusLeft: "聚焦左侧",
    focusRight: "聚焦右侧",
    focusUp: "聚焦上方",
    focusWaiting: "跳到下一个需要你处理",
    forceReload: "强制重新加载",
    hide: (appName) => `隐藏 ${appName}`,
    hideOthers: "隐藏其他",
    listAgents: "智能体列表",
    minimize: "最小化",
    newTerminal: "新建终端",
    newWindow: "新建窗口",
    nextTab: "下一个标签",
    paste: "粘贴",
    pasteAndMatchStyle: "粘贴并匹配样式",
    prevTab: "上一个标签",
    quit: (appName) => `退出 ${appName}`,
    redo: "重做",
    reload: "重新加载",
    resetZoom: "重置缩放",
    searchInFiles: "在文件中搜索",
    selectAll: "全选",
    services: "服务",
    settings: "设置...",
    splitDown: "向下分屏",
    splitRight: "向右分屏",
    toggleFullscreen: "切换全屏",
    toggleSideTree: "显示或隐藏文件树",
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
    closePanel: "パネルを閉じる",
    commandPalette: "コマンドパレット",
    copy: "コピー",
    cut: "カット",
    delete: "削除",
    devTools: "デベロッパーツール",
    edit: "編集",
    file: "ファイル",
    find: "検索",
    findNext: "次を検索",
    findPrevious: "前を検索",
    focusDown: "下のペインに移動",
    focusLeft: "左のペインに移動",
    focusRight: "右のペインに移動",
    focusUp: "上のペインに移動",
    focusWaiting: "次の対応が必要なエージェントへ",
    forceReload: "強制的に再読み込み",
    hide: (appName) => `${appName}を非表示`,
    hideOthers: "ほかを非表示",
    listAgents: "エージェント一覧",
    minimize: "最小化",
    newTerminal: "新規ターミナル",
    newWindow: "新規ウインドウ",
    nextTab: "次のタブ",
    paste: "ペースト",
    pasteAndMatchStyle: "ペーストしてスタイルを合わせる",
    prevTab: "前のタブ",
    quit: (appName) => `${appName}を終了`,
    redo: "やり直す",
    reload: "再読み込み",
    resetZoom: "拡大率をリセット",
    searchInFiles: "ファイル内を検索",
    selectAll: "すべてを選択",
    services: "サービス",
    settings: "設定...",
    splitDown: "下に分割",
    splitRight: "右に分割",
    toggleFullscreen: "フルスクリーンを切り替え",
    toggleSideTree: "ファイルツリーを切り替え",
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
    closePanel: "패널 닫기",
    commandPalette: "명령 팔레트",
    copy: "복사",
    cut: "잘라내기",
    delete: "삭제",
    devTools: "개발자 도구",
    edit: "편집",
    file: "파일",
    find: "찾기",
    findNext: "다음 찾기",
    findPrevious: "이전 찾기",
    focusDown: "아래로 포커스",
    focusLeft: "왼쪽으로 포커스",
    focusRight: "오른쪽으로 포커스",
    focusUp: "위로 포커스",
    focusWaiting: "처리가 필요한 다음으로",
    forceReload: "강제 새로고침",
    hide: (appName) => `${appName} 가리기`,
    hideOthers: "기타 가리기",
    listAgents: "에이전트 목록",
    minimize: "최소화",
    newTerminal: "새 터미널",
    newWindow: "새 윈도우",
    nextTab: "다음 탭",
    paste: "붙여넣기",
    pasteAndMatchStyle: "스타일 일치시켜 붙여넣기",
    prevTab: "이전 탭",
    quit: (appName) => `${appName} 종료`,
    redo: "실행 복원",
    reload: "새로고침",
    resetZoom: "확대/축소 재설정",
    searchInFiles: "파일에서 검색",
    selectAll: "모두 선택",
    services: "서비스",
    settings: "설정...",
    splitDown: "아래로 분할",
    splitRight: "오른쪽으로 분할",
    toggleFullscreen: "전체 화면 전환",
    toggleSideTree: "파일 트리 전환",
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
