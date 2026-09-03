import { settingsAgents } from "./settings-agents.ts";
import { settingsAppUpdate } from "./settings-app-update.ts";
import { settingsCliCommand } from "./settings-cli-command.ts";
import { settingsLspRow } from "./settings-lsp-row.ts";
import { settingsMaterials } from "./settings-materials.ts";
import { settingsMcp } from "./settings-mcp.ts";
import { settingsNotifications } from "./settings-notifications.ts";
import { settingsPlugins } from "./settings-plugins.ts";
import { settingsRemoteAccess } from "./settings-remote-access.ts";
import { settingsShellEnvironment } from "./settings-shell-environment.ts";
import { settingsSkills } from "./settings-skills.ts";

export const settings = {
  title: "設定",
  description: "アプリの設定を管理します",
  nav: {
    appearance: "外観",
    projects: "プロジェクト",
    skills: "スキル",
    environment: "環境",
    keybindings: "キーボード",
    plugins: "プラグイン",
    terminal: "ターミナル",
    updates: "更新",
    workspace: "ワークスペース",
    agents: "エージェント",
    notifications: "通知",
    remoteAccess: "リモートアクセス",
    pluginGroup: "プラグイン設定",
  },
  section: {
    appearance: "外観",
    projects: "プロジェクト",
    skills: "スキル",
    environment: "環境",
    font: "フォント",
    keybindings: "キーボードショートカット",
    plugins: "プラグイン",
    terminal: "ターミナル",
    updates: "更新",
    workspace: "ワークスペース",
    agents: "エージェント",
    notifications: "通知",
    remoteAccess: "リモートアクセス",
  },
  projects: {
    addProject: "プロジェクトを追加",
    back: "プロジェクト一覧に戻る",
    description:
      "プロジェクトごとに環境、スキル、MCP を設定します。プロジェクトをまたぐスキルと MCP は Pier ホームにあります。",
    emptyDescription:
      "プロジェクトを追加すると、環境、スキル、MCP を管理できます。Pier ホームは常に使えます。",
    emptyTitle: "まだプロジェクトはありません",
    pierHomeTitle: "Pier ホーム",
    pierHomeBadge: "ホーム",
    pierHomePathHint:
      "プロジェクトをまたぐスキルと MCP を置きます。特定のリポジトリには結びつきません",
    pierHomeLibraryAdd: "スキルを追加",
    pierHomeSkillsListTitle: "スキル",
    pierHomeSkillsListDescription:
      "システムスキル、Pier ライブラリのスキル、エージェントのグローバルスキルを一つの一覧にまとめます。種類はバッジで示します。システムとエージェントグローバルのスキルは読み取り専用で開きます。",
    pierHomeSkillsListEmptyTitle: "まだスキルはありません",
    pierHomeSkillsListEmptyDescription:
      "Pier ライブラリのスキルを追加するか、アプリのシステムスキルと、各エージェントのホームフォルダにあるグローバルスキルが表示されるのを待ってください。",
    pierHomeSystemBadge: "システム",
    /** Display label for provider id `pier.app` (never show raw id). */
    pierHomeSystemProviderApp: "Pier",
    pierHomeSystemProvider: "{{provider}} · {{version}}",
    pierHomeSkillsLoadFailed: "ホームのスキルを読み込めませんでした",
    pierHomeSkillsCreateFailed: "ライブラリのスキルを追加できませんでした",
    pierHomeSkillsDeleteTitle: "ライブラリからスキルを削除しますか？",
    pierHomeSkillsDeleteBody:
      "Pier ライブラリから「{{skill}}」を削除し、使っているプロジェクトからも外します。エージェントのグローバルスキルは変わりません。",
    pierHomeSkillsDeleteConfirm: "ライブラリから削除",
    pierHomeSkillsDeleteFailed: "ライブラリのスキルを削除できませんでした",
    pierHomeSkillsOpenFailed: "スキルファイルを開けませんでした",
    pierHomeSkillsSaveFailed: "ライブラリのスキルを保存できませんでした",
    pierHomeSkillsConvergeFailed:
      "Pier ホームには保存しましたが、一部のプロジェクトでインストール済みのコピーを更新できませんでした",
    pierHomeSkillsConvergeNoProjects:
      "Pier ホームには保存しましたが、同期できるプロジェクトがありません。プロジェクトを追加または開いてから、もう一度保存してください。",
    pierHomeSkillsRevealFailed: "Finder でスキルを表示できませんでした",
    pierHomeSkillsAlwaysIncludeFailed: "「常に含める」を更新できませんでした",
    pierHomeAlwaysIncludeLabel: "プロジェクトに常に含める",
    pierHomeAlwaysIncludeHint:
      "このスキルをすべてのプロジェクトに追加します。一つのプロジェクトだけから外すことはできません。",
    pierHomeDiscoveryChannelsHint:
      "チェックしたパスは、保存するとすべてのプロジェクトに適用されます。",
    pierHomeEnvEmptyTitle: "Pier ホームに環境スクリプトはありません",
    pierHomeEnvEmptyDescription:
      "環境スクリプトはリポジトリのプロジェクトにだけ適用されます。プロジェクトを追加または開いてください。",
    pierHomeReveal: "Finder で表示",
    pierHomeRevealFailed: "Pier ホームを表示できませんでした",
    general: {
      dangerDescription:
        "Pier からプロジェクトを外すだけです。ディスク上のファイルは残り、あとからまた追加できます。",
      dangerTitle: "Pier から外す",
      deleteHint: "あとからプロジェクトをまた追加できます。",
      deleteProject: "プロジェクトを外す",
      deleteConfirmBody:
        "「{{name}}」を Pier から外しますか？関連する作業ツリーでは環境スクリプトが止まります。",
      deleteConfirmBoundBody:
        "「{{name}}」を Pier から外しますか？作業ツリー {{count}} 個が結びついており、クリーンアップスクリプトは止まります。",
      deleteConfirmTitle: "このプロジェクトを Pier から外しますか？",
      deliveryDescription:
        "有効なスキルのインストール場所を選びます。どれも選ばないと、エージェントは見つけられません。",
      deliveryTitle: "インストール場所",
      deliveryAgents: "プロジェクト共有パス（.agents/skills）",
      deliveryAgentsHint:
        "Codex、Cursor など、このフォルダを探すエージェントが使います。",
      deliveryClaude: "Claude Code（.claude/skills）",
      deliveryClaudeHint:
        "Claude Code はここだけを見ます。Claude Code にも見せるときだけオンにしてください。",
      gitIgnoreTitle: "推奨する git 無視",
      gitIgnoreDescription:
        "スキルのインストールリンクは、通常コミットしない方がよいです。",
      gitIgnoreCopy: "コピー",
      gitIgnoreCopied: "コピーしました",
      canvasRootsTitle: "キャンバスのプレビューフォルダ",
      canvasRootsDescription:
        "*.canvas.* をプレビューできるプロジェクト相対フォルダです。変更するまでは .pier/canvases と docs です。",
      canvasRootsPathLabel: "フォルダ",
      canvasRootsAdd: "追加",
      canvasRootsRemove: "削除",
      canvasRootsResetDefaults: "既定に戻す",
      canvasRootsSave: "保存",
      canvasRootsSaved: "保存しました",
      canvasRootsLoading: "読み込み中…",
      canvasRootsLoadFailed: "プレビューフォルダを読み込めませんでした",
      canvasRootsSaveFailed: "プレビューフォルダを保存できませんでした",
      canvasRootsNeedOne: "フォルダは少なくとも 1 つ残してください。",
      canvasRootsInvalidPath:
        "プロジェクトからの相対フォルダを指定してください（.. や絶対パスは使えません）。",
      canvasRootsMaxFolders: "追加できるフォルダは最大 {{max}} 個です。",
      canvasRootsConflict:
        "ファイルがほかで変更されました。このページを開き直してから保存してください。",
      canvasTrustTitle: "キャンバスの信頼",
      canvasTrustDescription:
        "このプロジェクトのキャンバスを初めてプレビューする際に確認します。決定はこのマシンにのみ保存され、プロジェクトのファイルには書き込まれません。",
      canvasTrustLoading: "読み込み中…",
      canvasTrustLoadFailed: "信頼状態を読み込めませんでした",
      canvasTrustedBadge: "信頼済み",
      canvasTrustNotTrusted:
        "未信頼。このプロジェクトのキャンバスを初めてプレビューする際に確認します。",
      canvasTrustRevoke: "信頼を取り消す",
      canvasTrustRevokeTitle:
        "このプロジェクトのキャンバスの信頼を取り消しますか？",
      canvasTrustRevokeBody:
        "取り消すと、次にこのプロジェクトのキャンバスをプレビューする際に再度確認します。",
      canvasTrustRevokeFailed: "信頼を取り消せませんでした",
    },
    tabEnvironment: "環境",
    tabRules: "ルール",
    tabGeneral: "一般",
    tabSkills: "スキル",
    tabMcp: "MCP",
    rulesHint:
      "ルールは新しいエージェントセッションに適用されます。その場で使う手順はスキルに書いてください。",
    rulesLoading: "ルールを読み込み中…",
    rulesLoadFailed: "ルールを読み込めませんでした。もう一度お試しください",
    rulesSave: "保存",
    rulesSaveFailed: "ルールを保存できませんでした。もう一度お試しください",
    rulesDiscardTitle: "保存していない変更を破棄しますか？",
    rulesDiscardBody: "「{{name}}」の未保存の変更は失われます。",
    rulesEnsureTitle: "このルールファイルを作成しますか？",
    rulesEnsureBody: "「{{name}}」を作成しますか？",
    rulesEnsureFailed:
      "ルールファイルを作成できませんでした。もう一度お試しください",
    rulesOpenFailed: "ルールファイルを開けませんでした。もう一度お試しください",
    rulesRevealFailed: "Finder に表示できませんでした。もう一度お試しください",
    rulesFileListLabel: "ルールファイル",
    rulesFamilyAgents: "一般 / Codex",
    rulesFamilyClaude: "Claude Code",
    rulesFamilyGemini: "Gemini CLI",
    rulesFamilyCursor: "Cursor ルール",
    rulesTruncatedTitle: "ファイルが大きすぎてここでは編集できません",
    rulesTruncatedBody:
      "512 KiB 超のため読み取り専用プレビューです。外部エディタで編集してください。",
    rulesOpenInPier: "Pier で開く",
    rulesOpenExternal: "外部エディタで開く",
    rulesStateFile: "編集可能",
    rulesStateTruncated: "大きすぎます（読み取り専用）",
    rulesStateDirectory: "フォルダ（読み取り専用）",
    rulesStateMissing: "ありません",
    rulesStateOther: "利用できません",
    rulesMissingTitle: "{{name}} がありません",
    rulesMissingBody: "開始用のファイルを作成してから、ここで編集できます。",
    rulesCursorMissingBody:
      "Cursor または Finder で .cursor/rules を作成してから、ここに戻ってください。",
    rulesCreate: "{{name}} を作成",
    rulesDirectoryTitle: "このパスはフォルダです",
    rulesDirectoryBody:
      "Finder で開けますが、フォルダ型のルールはここでは編集できません。",
    rulesOtherBody: "{{name}} は通常の編集可能なファイルではありません。",
    rulesOtherTitle: "{{name}} はここでは編集できません",
    rulesEditorLabel: "{{name}} の内容",
    ...settingsMcp,
  },
  skills: settingsSkills,
  materials: settingsMaterials,
  environment: {
    addEnvironment: "環境設定を追加",
    addFailed: "追加できませんでした。もう一度お試しください",
    back: "戻る",
    cleanupCommand: "クリーンアップコマンド",
    cleanupHint: "作業ツリーを削除するときに実行します。",
    copyPatterns: {
      addPattern: "パターンを追加",
      hint: "メインプロジェクトで git に無視されているファイルに一致させ、新しい作業ツリーへコピーします。",
      patternLabel: "ファイルパターン",
      placeholder: ".env*",
      remove: "削除",
      title: "作成時にコピー",
    },
    deleteConfirmBody: "「{{name}}」の環境設定を削除しますか？",
    deleteConfirmBoundBody:
      "「{{name}}」を削除しますか？その {{count}} 個の作業ツリーではクリーンアップスクリプトが止まります。",
    deleteConfirmTitle: "環境設定を削除しますか？",
    deleteProject: "この環境設定を削除",
    deleteFailed: "削除できませんでした。もう一度お試しください",
    discardBody: "「{{name}}」への変更は失われます。",
    discardTitle: "保存していない変更を破棄しますか？",
    emptyDescription:
      "作業ツリーの作成や削除時にスクリプトを実行し、ターミナルへ環境変数を入れます。",
    saveFailed: "保存できませんでした。もう一度お試しください",
    saveSuccess: "保存しました",
    emptyTitle: "環境設定はありません",
    envVars: {
      addVariable: "変数を追加",
      keyLabel: "変数名",
      remove: "削除",
      title: "変数",
      valueLabel: "変数の値",
    },
    save: "保存",
    setupCommand: "セットアップコマンド",
    setupHint: "作業ツリーを作成するときに実行します。",
  },
  appUpdate: settingsAppUpdate,
  remoteAccess: settingsRemoteAccess,
  statusBar: {
    title: "ステータスバー",
    description:
      "ターミナル状態項目の表示、非表示、並び替え。上から下がバーの左から右に対応し、上へ動かすと左へ寄ります。",
    leftGroup: "左",
    rightGroup: "右",
    moveUp: "上へ（より左へ）",
    moveDown: "下へ（より右へ）",
    moveToLeft: "左グループへ",
    moveToRight: "右グループへ",
    visible: "表示",
    reset: "既定に戻す",
    modified: "変更あり",
    updateFailed:
      "ステータスバーを更新できませんでした。もう一度お試しください",
  },
  row: {
    theme: "テーマ",
    themeDesc: "インターフェースの色モード",
    stylePreset: "スタイル",
    stylePresetDesc: "配色",
    language: "言語",
    languageDesc: "表示言語",
    uiFontFamily: "UI フォント",
    uiFontFamilyDesc: "インターフェースのフォント",
    uiFontFamilyPlaceholder: "system-ui",
    monoFontFamily: "等幅フォント",
    monoFontFamilyDesc: "ターミナルとコードエディタのフォント",
    monoFontFamilyPlaceholder: "JetBrainsMono Nerd Font Mono",
    docFontMode: "ドキュメントフォント",
    docFontModeDesc:
      "Markdown プレビューとドキュメントキャンバスの本文フォント。コードブロックは等幅のままです。",
    docFontModeUi: "インターフェースに合わせる",
    docFontModeCustom: "カスタム",
    docFontFamily: "カスタムドキュメントフォント",
    docFontFamilyDesc:
      "ドキュメントフォントがカスタムのときの主フォント。空欄なら内蔵のドキュメント用セリフに戻します。システムのフォントだけ使えます。",
    docFontFamilyPlaceholder: "Noto Serif SC",
    monoFontSize: "ターミナルのフォントサイズ",
    monoFontSizeDesc: "範囲 8–32",
    monoFontSizePlaceholder: "13",
    codeFontSize: "コードのフォントサイズ",
    codeFontSizeDesc: "エディタと git 差分。範囲 8–32",
    codeFontSizePlaceholder: "13",
    fontUpdateFailed: "フォント設定を更新できませんでした",
    terminalCursorStyle: "カーソルの形",
    terminalCursorStyleDesc: "ターミナルカーソルの形",
    terminalCursorBlink: "カーソル点滅",
    terminalCursorBlinkDesc: "ターミナルカーソルを点滅させます",
    terminalScrollbackMb: "スクロールバック上限",
    terminalScrollbackMbDesc: "ターミナル履歴バッファのサイズ。範囲 10–512",
    terminalScrollbackRuntimeNote: "新しく開くターミナルにだけ適用されます。",
    terminalPasteProtection: "貼り付け保護",
    terminalPasteProtectionDesc:
      "すぐに実行される可能性のある内容を貼り付ける前に確認します",
    terminalNewCwdPolicy: "新しいターミナルのディレクトリ",
    terminalNewCwdPolicyDesc: "新規または分割ターミナルの作業ディレクトリ",
    quitConfirmation: "終了の確認",
    quitConfirmationDesc: "Cmd+Q で終了する前に、いつ確認するか",
    worktreeRootPath: "作業ツリーのディレクトリ",
    worktreeRootPathDesc:
      "空欄のままにすると、メインプロジェクトの隣の {project}.worktree を使います。",
    worktreeRootPathPlaceholder: "~/Projects/pier.worktree",
    panelCloseFocusPolicy: "タブを閉じたあと",
    panelCloseFocusPolicyDesc:
      "アクティブなタブを閉じたあと、隣のタブか最近使ったタブに移動します。",
    ...settingsLspRow,
    defaultAgent: "デフォルトのエージェント",
    defaultAgentDesc: "「デフォルトのエージェントを起動」で使うプログラム",
    agentPermissionMode: "権限モード",
    agentPermissionModeDesc:
      "新しいエージェントが権限確認をスキップするかどうかの既定",
  },
  terminal: {
    cursorStyle: {
      block: "ブロック",
      bar: "バー",
      underline: "下線",
    },
    newCwdPolicy: {
      activeTerminal: "アクティブなターミナルを継承",
      shellDefault: "シェルの既定を使う",
    },
  },
  shellEnvironment: settingsShellEnvironment,
  cliCommand: settingsCliCommand,
  /** Numeric InputRow trailing units (shadcn InputGroupAddon). */
  unit: {
    px: "px",
    mb: "MB",
    seconds: "秒",
    minutes: "分",
  },
  quitConfirmation: {
    hasActivity: "作業の実行中",
    always: "常に",
    never: "しない",
  },
  panelCloseFocusPolicy: {
    adjacent: "隣のタブ",
    recent: "最近使ったタブ",
  },
  keybindings: {
    change: "ショートカットを変更",
    clear: "消去",
    alsoBound: "ほかに {{chords}} も使えます。",
    descriptionDefault: "{{category}} のコマンド。",
    description: {
      agent: {
        new: "デフォルトのエージェントを起動します。リッチ入力にフォーカスがあるときは、同じショートカットでファイルを追加します。",
      },
      agents: {
        focusWaiting: "次の対応が必要なエージェントへ移動します。",
        list: "エージェント一覧を開きます。",
      },
      commandPalette: {
        clearRecent: "コマンドパレットの履歴を消します。",
        toggle: "コマンドパレットを開くか閉じます。",
      },
      config: {
        locale: "表示言語を選びます。",
        stylePreset: "インターフェースの配色スタイルを選びます。",
        theme: "インターフェースの色モードを選びます。",
      },
      files: {
        copyPath: "現在のファイルの絶対パスをコピーします。",
        copyRelativePath:
          "現在のファイルのプロジェクト相対パスをコピーします。",
        copyPathWithRange: "現在のファイルパスと選択中の行番号をコピーします。",
        editor: {
          addCursorAbove: "上の行にカーソルを追加します。",
          addCursorBelow: "下の行にカーソルを追加します。",
          goToLine: "現在のファイルの指定行へ移動します。",
          selectAllOccurrences: "現在の語の出現箇所をすべて選びます。",
          selectNextOccurrence: "現在の語の次の出現箇所を選びます。",
          showHover: "カーソル位置の記号の説明を表示します。",
        },
        search: {
          copyPath: "検索結果の現在のファイルの絶対パスをコピーします。",
          copyRelativePath:
            "検索結果の現在のファイルのプロジェクト相対パスをコピーします。",
        },
      },
      git: {
        review: {
          copyPath: "選んだ変更の絶対パスをコピーします。",
          copyRelativePath: "選んだ変更のリポジトリ相対パスをコピーします。",
          copyPathWithRange: "選んだ変更のパスと選択中の行番号をコピーします。",
        },
      },
      find: "現在のターミナル、ファイル、または変更一覧で検索します。",
      findNext: "現在のパネルで次の一致を検索します。",
      findPrev: "現在のパネルで前の一致を検索します。",
      panel: {
        copyRelativePath:
          "現在のファイルのプロジェクト相対パスをコピーします。",
        close: "現在のパネルを閉じます。",
        closeActive: "アクティブなパネルを閉じます。",
        closeAll: "すべてのパネルを閉じます。",
        closeOthers: "現在のパネル以外をすべて閉じます。",
        focusDown: "下のパネルグループへ移動します。",
        focusLeft: "左のパネルグループへ移動します。",
        focusNextTab: "現在のグループの次のタブへ切り替えます。",
        focusPrevTab: "現在のグループの前のタブへ切り替えます。",
        focusRight: "右のパネルグループへ移動します。",
        focusUp: "上のパネルグループへ移動します。",
        newTab: "新しいパネルタブを作ります。",
        newTerminal: "新しいターミナルパネルを作ります。",
        openCreateMenu: "アクティブなパネルグループの作成メニューを開きます。",
        splitDown: "現在のパネルを下へ分割します。",
        splitLeft: "現在のパネルを左へ分割します。",
        splitRight: "現在のパネルを右へ分割します。",
        splitUp: "現在のパネルを上へ分割します。",
        toggleMaximized: "アクティブなパネルの最大化を切り替えます。",
      },
      run: {
        task: "タスク実行の入口を開きます。",
        terminalList: "ターミナル一覧を開きます。",
      },
      settings: {
        open: "設定を開きます。",
      },
      terminal: {
        close: "現在のターミナルパネルを閉じます。",
        composerAttach:
          "リッチ入力にファイルを追加します。リッチ入力にフォーカスがないときは、同じショートカットでデフォルトのエージェントを起動します。",
        openAgentComposer: "現在のターミナルのリッチ入力を開くか閉じます。",
        openDebugWindow: "ターミナルのデバッグウインドウを開きます。",
      },
      view: {
        resetZoom: "インターフェースの拡大率を既定に戻します。",
        toggleSideTree: "ファイルツリーを表示または隠します。",
        zoomIn: "Pier の画面を拡大します。",
        zoomOut: "Pier の画面を縮小します。",
      },
      window: {
        newWindow: "新しい Pier ウインドウを開きます。",
      },
      workspace: {
        resetLayout: "配置を消して、既定のワークスペース配置に戻します。",
      },
    },
    errorConflict: "すでに「{{command}}」が使用しています",
    errorNeedsModifier: "修飾キーを加えてください",
    errorUnknown: "ショートカットを保存できませんでした",
    noResultsDescription:
      "別のキーワードを試すか、検索を消してすべてのショートカットを表示してください。",
    noResultsTitle: "一致するショートカットはありません",
    record: "記録",
    recording: "キーを押してください…",
    reset: "リセット",
    resetAll: "すべてリセット",
    searchLabel: "キーボードショートカットを検索",
    searchPlaceholder: "名前またはショートカットを検索",
    unassigned: "未割り当て",
  },
  plugins: settingsPlugins,
  pluginConfiguration: {
    modified: "変更あり",
    resetToDefault: "既定に戻す",
    writeFailed: "設定を更新できませんでした",
  },
  theme: {
    light: "ライト",
    dark: "ダーク",
    system: "システム",
  },
  locale: {
    system: "システムに従う",
    "zh-CN": "简体中文",
    en: "English",
    ja: "日本語",
    ko: "한국어",
  },
  agents: settingsAgents,
  notifications: settingsNotifications,
} as const;
