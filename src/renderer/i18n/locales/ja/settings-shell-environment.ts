/** Shell environment Terminal settings card (split from settings.ts for file-size). */
export const settingsShellEnvironment = {
  title: "シェル環境",
  description:
    "Pier はログインシェルを読み込み、タスクとエージェントがターミナルと同じツールを見つけられるようにします。",
  windowsNote:
    "Windows ではログインシェルの読み込みをスキップします。コマンドはプロセス環境から来ます。",
  statusLabel: "状態:",
  status: {
    resolved: "ターミナルと一致",
    failed: "基本環境を使用中",
    skipped: "スキップ",
    unknown: "まだ利用できません",
  },
  skipReason: {
    cli: "ターミナルから起動したため、現在の環境を使っています",
    disabled: "ログインシェルの読み込みはオフです",
    "no-shell": "使えるシェルが見つかりません",
    windows: "Windows ではログインシェルを解決しません",
  },
  refresh: "再読み込み",
  refreshing: "再読み込み中…",
  disabled: "ログインシェル環境を読み込まない",
  disabledDesc:
    "オンにすると Pier はログインシェルをスキップします。タスクが Node などのツールを見つけられないことがあります。",
  timeout: "読み込みタイムアウト",
  timeoutDesc: "ログインシェルの完了を待つ秒数。範囲 1–120。",
  statusFailed: "状態を読めませんでした。もう一度お試しください",
  refreshFailed: "再読み込みが完了せず、現在の環境のままです",
  updateFailed: "設定を更新できませんでした。もう一度お試しください",
} as const;
