export const settingsAgents = {
  permissionMode: {
    yolo: "確認をスキップ",
    manual: "手動",
    mixed: "混在",
  },
  defaultPick: {
    auto: "自動",
    blank: "空のターミナル",
  },
  list: {
    title: "エージェント CLI",
    description: "インストール済みおよび検出されたエージェント",
    refresh: "更新",
    refreshSuccess: "一覧を更新しました",
    refreshFailed: "一覧を更新できませんでした",
    checkUpdates: "更新を確認",
    checkUpdatesSuccess: "更新の確認が終わりました",
    checkUpdatesFailed: "更新を確認できませんでした",
    updateAll: "すべて更新",
    updateAllDone: "エージェントの更新が終わりました",
    updateAllPartial: "一部のエージェントを更新できませんでした",
  },
  status: {
    detected: "検出済み",
    missing: "未インストール",
    disabled: "無効",
    updateAvailable: "更新あり",
    broken: "インストール済みですが起動しません",
    conflict: "複数のインストール",
  },
  action: {
    enable: "有効にする",
    disable: "無効にする",
    setDefault: "デフォルトに設定",
    isDefault: "デフォルト",
    expand: "詳細",
    website: "ウェブサイト",
    websiteOpenBusy: "別のリンクを開いている最中です",
    websiteOpenFailedDescription:
      "エージェントのウェブサイトを開けませんでした。",
    websiteOpenFailedTitle: "ウェブサイトを開けません",
    install: "インストール",
    update: "更新",
    reinstall: "再インストール",
    uninstall: "アンインストール",
    cancel: "キャンセル",
    copyInstallCommand: "インストールコマンドをコピー",
    copyInstallCommandSuccess: "インストールコマンドをコピーしました",
    copyInstallCommandFailed: "インストールコマンドをコピーできませんでした",
    installFailed: "エージェントをインストールできませんでした",
    updateFailed: "エージェントを更新できませんでした",
    reinstallFailed: "エージェントを再インストールできませんでした",
    uninstallFailed: "エージェントをアンインストールできませんでした",
    installBusy: "インストール中",
    updateBusy: "更新中",
    reinstallBusy: "再インストール中",
    uninstallBusy: "アンインストール中",
    queueBusy: "待機中",
    busyStep: "{{current}}/{{total}}",
    busyPercent: "{{percent}}%",
    rowInstallFailed: "インストールに失敗",
    rowInstallFailedWithStep: "インストールに失敗（{{step}}）",
    rowUpdateFailed: "更新に失敗",
    rowUpdateFailedWithStep: "更新に失敗（{{step}}）",
    rowReinstallFailed: "再インストールに失敗",
    rowUninstallFailed: "アンインストールに失敗",
    rowUninstallPartial:
      "デフォルトのインストールは削除しました。ほかはまだ検出されています",
    alreadyInstalled: "すでにインストール済み",
    conflictConfirmTitle: "複数のインストールが見つかりました",
    conflictConfirmBody:
      "いまデフォルトで使っているインストールだけ更新します。ほかの場所はそのままです。",
    conflictConfirmContinue: "デフォルトを更新",
    reinstallConfirmTitle: "このエージェントを再インストールしますか？",
    reinstallConfirmBody:
      "公式インストーラで「{{name}}」を入れ直します。会話とローカル設定は残ります。",
    reinstallConfirmConflictNote:
      "いまデフォルトで使っているインストールだけ更新します。ほかの場所はそのままです。",
    reinstallConfirmContinue: "再インストール",
    uninstallConfirmTitle: "このエージェントをアンインストールしますか？",
    uninstallConfirmBody:
      "この Mac から「{{name}}」を削除します（{{source}}: {{path}}）。会話とローカル設定は残ります。実行中のターミナルは止まることがあります。",
    uninstallConfirmBodyNameOnly:
      "この Mac から「{{name}}」を削除します。会話とローカル設定は残ります。実行中のターミナルは止まることがあります。",
    uninstallConfirmConflictNote:
      "いまデフォルトで使っているインストールだけ削除します。ほかの場所はそのままです。",
    uninstallConfirmContinue: "アンインストール",
    uninstallSuccess: "{{name}} をアンインストールしました",
    uninstallSkipped: "インストールされていません",
    uninstallUnsupported:
      "この入れ方は自動ではアンインストールできません。下にカスタムコマンドを追加するか、ウェブサイトを開いてください。",
  },
  lifecycle: {
    version: "バージョン",
    latest: "最新",
    installGuide: "インストールコマンド",
    installs: "インストール場所",
    reinstallHint: "再インストールで現在の導入を更新できます。",
    errors: {
      unsupported:
        "このエージェントは自動インストールできません。案内を使うか、ウェブサイトを開いてください。",
      unavailable:
        "インストールサービスをいま使えません。あとでもう一度お試しください。",
      no_command:
        "このシステム向けのインストールコマンドが設定されていません。",
      command_failed:
        "インストール、更新、またはアンインストールのコマンドが失敗しました。詳細は下を見てください。",
      version_unchanged:
        "バージョンは変わりませんでした。別のインストールがまだ使われている可能性があります。",
      not_runnable:
        "インストール済みですが起動できませんでした。ターミナルでそのコマンドを実行して原因を確認してください。",
      not_found_after_install:
        "インストールは終わりましたが、コマンドがまだ見つかりません。一覧を更新するか、新しいターミナルを開いてください。",
      already_installed: "このエージェントはすでにインストールされています。",
      busy: "このエージェントのインストール、更新、またはアンインストールがすでに実行中です。",
      cancelled:
        "インストール、更新、またはアンインストールをキャンセルしました。",
      timeout:
        "インストール、更新、またはアンインストールがタイムアウトしました。回線が安定してからもう一度お試しください。",
      env_unavailable:
        "シェル環境を用意できませんでした。更新してもう一度お試しください。",
      package_manager_missing:
        "必要なパッケージマネージャ（npm、Homebrew、pipx、uv）が見つかりません。入れてからもう一度お試しください。",
      still_detected:
        "アンインストールは終わりましたが、エージェントはまだ検出されています。",
    },
  },
  row: {
    launchCmd: "起動コマンド",
    detectCmd: "検出コマンド",
    expectedProcess: "プロセス",
    commandOverride: "コマンドの上書き",
    commandOverrideDesc: "このエージェント用の実行ファイルパス",
    args: "起動引数",
    argsDesc: "起動コマンドのあとに付ける引数",
    installCommand: "インストールコマンド",
    installCommandDesc:
      "ワンクリックインストール用のシェルコマンド。空なら Pier の既定手順です。",
    installCommandPlaceholder: "空にすると Pier の既定インストール手順",
    updateCommand: "更新コマンド",
    updateCommandDesc:
      "ワンクリック更新用のシェルコマンド。空なら Pier の既定手順です。",
    updateCommandPlaceholder: "空にすると Pier の既定更新手順",
    uninstallCommand: "アンインストールコマンド",
    uninstallCommandDesc:
      "ワンクリックアンインストール用のシェルコマンド。空なら Pier の既定手順です。",
    uninstallCommandPlaceholder: "空にすると Pier の既定アンインストール手順",
    env: "追加の環境変数",
    envDesc: "このエージェント起動時に足す変数",
  },
  sessionTitleRefine: {
    label: "セッション名を自動で付ける",
    description:
      "最初の返信のあと、タブ名を作業内容に合わせます。オフのときは最初のメッセージを名前にします。",
    failed: "セッション名の付け方を更新できませんでした",
  },
  statusHooks: {
    label: "エージェント状態の通知",
    description:
      "実行／待ち状態をパネルに出し、対応が必要なときに知らせます。オフにすると両方とも止まります。",
    failed: "エージェント状態の通知を更新できませんでした",
  },
} as const;
