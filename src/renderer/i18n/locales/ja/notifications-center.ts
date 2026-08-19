export const notificationsCenter = {
  action: {
    goToAgent: "今すぐ対応",
    openAgent: "会話を開く",
    viewAgentOutput: "出力を見る",
  },
  attention: {
    error: "エージェントでエラーが発生しました",
    ready: "ターンが完了しました",
    waiting: "対応が必要",
  },
  actionFailed: "通知を更新できませんでした。もう一度お試しください",
  bell: {
    aria: "通知、未読 {{count}} 件",
    ariaEmpty: "通知",
  },
  dnd: {
    off: "集中モードをオフ",
    on: "集中モード",
  },
  empty: "通知はありません",
  emptyDetail: "システムのメッセージがここに表示されます",
  header: {
    markAllRead: "すべて既読にする",
    title: "通知",
    unread: "未読 {{count}} 件",
  },
  loadMore: "スクロールして続きを読み込む…",
  repeat: "×{{count}}",
  shellEnv: {
    failedBody:
      "ツールのパスがターミナルと違う可能性があります。設定 → ターミナルを開き、再読み込みしてください。",
    failedTitle: "タスク環境がターミナルと異なる可能性があります",
    openSettings: "ターミナル設定を開く",
  },
  source: {
    pluginDetail: "プラグイン {{source}}",
    agent: "エージェント",
    plugin: "プラグイン",
    system: "システム",
    task: "タスク",
  },
} as const;
