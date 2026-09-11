import type { Locale } from "./copy.ts";

export type UpdatePhase = "none" | "available" | "downloading" | "downloaded";

const zhCN = {
  tools: "应用工具",
  settings: "设置",
  notifications: "通知",
  emptyTitle: "暂时没有通知",
  emptyDescription: "应用消息会出现在这里。",
  availableTitle: "有可用更新",
  availableBody: "示例状态；实际版本以应用检测结果为准。",
  downloadDemo: "演示下载",
  progressTitle: "正在下载 42% · 示例",
  progressBody: "42% 为演示数值，没有文件正在下载。",
  progressValue: "42%",
  finishDemo: "预览下载完成",
  downloadedTitle: "重启并安装 · 示例",
  downloadedBody: "正式应用在下载完成后提供重启安装。本设计稿仅预览该状态。",
  resetDemo: "重置更新演示",
} as const;

type FooterCopy = { [Key in keyof typeof zhCN]: string };

export const FOOTER_COPY: Record<Locale, FooterCopy> = {
  "zh-CN": zhCN,
  en: {
    tools: "App tools",
    settings: "Settings",
    notifications: "Notifications",
    emptyTitle: "No notifications yet",
    emptyDescription: "App messages will appear here.",
    availableTitle: "Update available",
    availableBody:
      "Sample state. The app’s update check determines the actual version.",
    downloadDemo: "Preview download",
    progressTitle: "Downloading 42% · Sample",
    progressBody: "42% is a sample value. No files are being downloaded.",
    progressValue: "42%",
    finishDemo: "Preview completion",
    downloadedTitle: "Restart and install · Sample",
    downloadedBody:
      "The app offers restart and install after a download finishes. This design only previews that state.",
    resetDemo: "Reset update preview",
  },
  ja: {
    tools: "アプリのツール",
    settings: "設定",
    notifications: "通知",
    emptyTitle: "通知はまだありません",
    emptyDescription: "アプリのメッセージはここに表示されます。",
    availableTitle: "利用可能な更新があります",
    availableBody:
      "サンプルの状態です。実際のバージョンはアプリの更新確認で決まります。",
    downloadDemo: "ダウンロードをプレビュー",
    progressTitle: "ダウンロード中 42% · サンプル",
    progressBody:
      "42% はサンプル値です。ファイルのダウンロードは行っていません。",
    progressValue: "42%",
    finishDemo: "完了状態をプレビュー",
    downloadedTitle: "再起動してインストール · サンプル",
    downloadedBody:
      "実際のアプリでは、ダウンロード完了後に再起動してインストールできます。ここではその状態のみを表示します。",
    resetDemo: "更新プレビューをリセット",
  },
  ko: {
    tools: "앱 도구",
    settings: "설정",
    notifications: "알림",
    emptyTitle: "아직 알림이 없습니다",
    emptyDescription: "앱 메시지가 여기에 표시됩니다.",
    availableTitle: "업데이트가 있습니다",
    availableBody:
      "예시 상태입니다. 실제 버전은 앱의 업데이트 확인 결과에 따릅니다.",
    downloadDemo: "다운로드 미리보기",
    progressTitle: "다운로드 중 42% · 예시",
    progressBody: "42%는 예시 값입니다. 파일을 다운로드하고 있지 않습니다.",
    progressValue: "42%",
    finishDemo: "완료 상태 미리보기",
    downloadedTitle: "다시 시작하여 설치 · 예시",
    downloadedBody:
      "실제 앱에서는 다운로드가 끝나면 다시 시작하여 설치할 수 있습니다. 여기서는 해당 상태만 미리 봅니다.",
    resetDemo: "업데이트 미리보기 초기화",
  },
};
