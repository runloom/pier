/** 设置 · 应用更新分区文案（从 settings.ts 拆出，规避单文件行数上限）。 */
export const settingsAppUpdate = {
  title: "アプリの更新",
  description: "Pier の更新を確認、ダウンロード、インストールします。",
  available: "バージョン {{version}} が利用できます。",
  progress: "ダウンロード {{percent}}%",
  state: {
    disabled: "開発モードではアプリの更新を確認しません。",
    idle: "まだ更新確認を実行していません。",
    checking: "更新を確認中…",
    available: "更新があります。",
    "not-available": "Pier は最新です。",
    downloading: "更新をダウンロード中…",
    downloaded: "更新をダウンロードしました。再起動してインストールします。",
  },
  errorOpenSettings: "更新設定を開く",
  errorHint: {
    offline: "ネットワーク接続を確認して、もう一度お試しください。",
    "no-artifact":
      "新しいパッケージはまだ公開されていません。後でもう一度お試しください。",
    "rate-limited": "後でもう一度お試しください。",
    server: "後でもう一度お試しください。",
    unknown: "後でもう一度お試しください。",
  },
  errorKind: {
    offline: "ネットワーク接続に失敗しました",
    "no-artifact": "利用可能な更新パッケージがありません",
    "rate-limited": "更新リクエストが多すぎます",
    server: "更新サービスが一時的に利用できません",
    unknown: "更新に失敗しました",
  },
  action: {
    check: "更新を確認",
    download: "ダウンロード",
    restart: "再起動してインストール",
  },
  receiveCandidates: "候補バージョンを受け取る",
  receiveCandidatesDesc:
    "正式リリース前に候補バージョンを受け取ります。不安定な場合があり、次の正式バージョンへ自動更新されます。",
  toast: {
    prefFailed: "更新設定を保存できませんでした。もう一度お試しください",
    statusFailed: "更新状態を読めませんでした。もう一度お試しください",
    checkFailed: "更新を確認できませんでした。もう一度お試しください",
    downloadFailed:
      "更新をダウンロードできませんでした。もう一度お試しください",
    installFailed: "更新をインストールできませんでした。もう一度お試しください",
    failed: "アプリの更新に失敗しました",
    ready: "更新の準備ができました",
    readyDetail: "Pier {{version}} · 再起動してインストール",
  },
  titleBar: {
    update: "更新",
    updateAvailable: "v{{version}}",
    availableAria: "Pier {{version}} が利用できます",
    downloadingAria: "更新をダウンロード中 {{percent}} パーセント",
    restartAria: "再起動して Pier {{version}} をインストール",
  },
} as const;
