export const canvas = {
  file: {
    conflict:
      "{{name}} がディスク上で変更されました。保存する前に再読み込みしてください。",
    invalidName: "キャンバスは同じフォルダ内のファイルだけ使えます。",
    readFailed: "{{name}} を読めませんでした。テキストファイルではありません。",
    unavailable:
      "このキャンバスはファイルから開いていないため、保存できません。",
    writeFailed: "{{name}} を保存できませんでした。",
  },
  command: {
    cancelLabel: "キャンセル",
    confirmBody: "このキャンバスは次を実行します:\n\n{{command}}",
    confirmLabel: "実行",
    confirmTitle: "このコマンドを実行しますか？",
    failed: "コマンドを実行できませんでした。",
    unavailable:
      "このキャンバスはファイルから開いていないため、コマンドを実行できません。",
  },
  blocks: {
    activityEmpty: "このウインドウに作業はありません",
    activityEmptyHint:
      "エージェントを起動するか、ターミナルでコマンドを実行してください。",
    activityNeedsYou: "対応が必要です",
    activityRunning: "実行中",
    activityInProgress: "進行中",
    resourcesEmpty: "リソースデータはまだありません",
    resourcesEmptyHint:
      "このキャンバスを開いている間、Pier がこの Mac を計測します。",
    resourcesError: "リソースを読めませんでした",
    resourcesCpu: "関連 CPU",
    resourcesMemory: "関連メモリ",
    resourcesTerminals: "ターミナル",
    costEmpty: "コストデータはまだありません",
    costEmptyHint: "対応する AI CLI を使うと合計が表示されます。",
    costError: "コストを読めませんでした",
    costPeriod: "コスト · 直近 {{count}} 日",
    costTokens: "トークン · 直近 {{count}} 日",
  },
  workflow: {
    invalidTitle: "このフロー図は描けません",
    invalidHint: "{{message}} 次：{{fix}}",
    legend: "凡例",
  },
  screenFlow: {
    invalidTitle: "この画面経路は描けません",
    invalidHint: "{{message}} 次：{{fix}}",
    tight: "この2つの画面が近すぎます。間隔を広げてください。",
    overlap: "画面が重なっています。どちらかをずらしてください。",
    missing: "経路上の画面がボードにありません。",
    cross: "線が別の画面を横切っています。どちらかをずらしてください。",
    labelPark: "操作名が重なっています。どちらかの画面をずらしてください。",
    legend: "凡例",
    legendMain: "本筋",
    legendBranch: "分岐",
    legendReturn: "戻り",
    legendError: "失敗",
  },
} as const;
