export const workspace = {
  closeFailure: {
    starting: "ワークスペースの起動中のため、配置をまだ保存できませんでした。",
    title: "ウインドウを閉じられません",
    unavailable: "ワークスペースを使えず、配置を安全に保存できませんでした。",
  },
  pluginPanel: {
    loadingDescription:
      "プラグインを読み込み中です。準備でき次第表示されます。",
    loadingTitle: "プラグインパネルを読み込み中",
    missingRendererDescription:
      "このプラグインには表示できる画面がありません。",
    unavailableTitle: "プラグインパネルを使えません",
    crashTitle: "プラグインパネルがクラッシュしました",
    crashDescription:
      "プラグイン UI でエラーが発生しました。他のパネルには影響ありません。無効化または再読み込みで復旧できます。",
  },
  startupError: {
    description: "再読み込みしてもう一度お試しください。",
    retry: "再読み込み",
    title: "Pier の起動に失敗しました",
  },
  runtimeError: {
    description:
      "ターミナルセッションは残っています。再読み込みして続けてください。",
    retry: "再読み込み",
    title: "画面エラー",
  },
  tab: {
    activeTask: "タスク実行中",
    close: "タブを閉じる",
    create: "新規",
    hiddenTabs: "非表示のタブ",
    maximize: "最大化",
    restore: "元に戻す",
    unsaved: "未保存の変更",
  },
  addPanelMenu: {
    actionFailed: "操作を完了できませんでした。もう一度お試しください",
    detectAgentsFailed:
      "エージェントを検出できませんでした。もう一度お試しください",
    noMatches: "一致する項目はありません",
    searchPlaceholder: "パネルの種類やエージェントを検索…",
    title: "このパネルグループに作成",
    startAgentFailed:
      "エージェントを起動できませんでした。もう一度お試しください",
    startAgentInjectFailed:
      "ターミナルは開きましたが、起動コマンドを入力できませんでした。ターミナルに入力するか、もう一度起動してください。",
  },
  panelTransfer: {
    dropFailedTitle: "タブを移動できませんでした",
    dropFailedBody:
      "そのウインドウへ移動できませんでした。元のタブは開いたままです。",
    dropFailedUnknownComponentBody:
      "別のウインドウへ移動できませんでした。元のタブは開いたままです。",
    copyToNewWindowFailed:
      "新しいウインドウへコピーできませんでした。もう一度お試しください",
    copyToWindowFailed:
      "そのウインドウへコピーできませんでした。もう一度お試しください",
    moveToNewWindowFailed:
      "新しいウインドウで開けませんでした。もう一度お試しください",
    moveToWindowFailed:
      "そのウインドウへ移動できませんでした。もう一度お試しください",
    emptyWindowDescription: "空のウインドウ",
    noOtherWindowsTitle: "ほかのウインドウがありません",
    noOtherWindows: "先に別のウインドウを開いてから、もう一度お試しください。",
    pickWindowFailed:
      "ウインドウ一覧を取得できませんでした。もう一度お試しください",
    sameNameIndex: " · {{n}}",
    windowLabel: "ウインドウ {{n}}",
    unsupportedTitle: "このタブは別のウインドウへ移せません",
    unsupportedBody:
      "この種類のタブはウインドウ間を移動できません。こちらでは開いたままです。",
    unavailableSourceTitle: "こちらではタブを使えなくなりました",
    unavailableSourceBody:
      "別の場所へ移しましたが、元を閉じられませんでした。必要なら手動で閉じてください。",
    unavailableTargetTitle: "タブを復元できませんでした",
    unavailableTargetBody:
      "このウインドウへ移しましたが、元の内容をここでは使えません。関連する拡張機能を有効にして再読み込みしてください。",
  },
} as const;
