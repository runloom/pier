/** Skills section copy (design v9 §7); split from settings.ts (file-size cap). */
export const settingsSkills = {
  description:
    "このプロジェクトのエージェントスキルを管理します。この Mac 全体のスキルフォルダは変わりません。",
  emptyTitle: "プロジェクトのスキルはありません",
  detailEmptyTitle: "このプロジェクトにはまだスキルがありません",
  detailEmptyDescription:
    "フォルダを取り込むか、スキルを追加してください。詳細でオンにするとエージェントが使えます。ディスク上にすでにあるスキルは「プロジェクト内」に表示されます。",
  emptyDescription:
    "プロジェクトを選び、ローカルのスキルディレクトリを取り込んでください。",
  searchPlaceholder: "スキルを検索",
  filterAll: "すべて",
  filterGroupLabel: "出所でスキルを絞り込み",
  filterManaged: "自分が管理",
  filterProject: "プロジェクト内",
  filterUserGlobal: "この Mac",
  contentTitle: "SKILL.md の内容",
  contentSkillMdOnlyNotice:
    "ここでは SKILL.md だけ開きます。ほかのファイルはスキルフォルダに残ります。表示や編集はそのフォルダで行ってください。",
  metadataTitle: "詳細",
  metadataCompanionHint:
    "フォルダ内のほかのファイルも含みます。ここでは SKILL.md だけ開きます。",
  policyTitle: "方針",
  removeTitle: "削除",
  removeBody:
    "このスキルをプロジェクトから外します（元に戻せません）。一時停止するだけなら、詳細でインストール場所をオフにしてください。",
  removeLibraryBody:
    "この Mac の Pier ライブラリからこのスキルを削除します。元に戻せません。",

  matrixNotInstalled_one:
    "未インストールのエージェント {{count}} 件は非表示です。",
  matrixNotInstalled_other:
    "未インストールのエージェント {{count}} 件は非表示です。",
  matrixAllSameState_one: "インストール済みのエージェントは {{state}} です。",
  matrixAllSameState_other:
    "インストール済みのエージェント {{count}} 件はすべて {{state}} です。",
  matrixGroupState_one: "{{count}} 件のエージェント: {{state}}",
  matrixGroupState_other: "{{count}} 件のエージェント: {{state}}",
  contentUnavailable: "このスキルの内容を読めませんでした。",
  contentTruncated: "内容が 1 MB を超えているため、先頭だけ表示しています。",
  readOnlyNotice: "専用フォルダで管理されています。Pier は変更しません。",
  reload: "再読み込み",
  reloadRequired: "スキルが Pier の外で変わりました。",
  reloadRequiredHint:
    "再試行する前に、いまのファイルを再読み込みしてください。",
  repairFailed: "すべてのエージェントにスキルを渡せませんでした",
  repairFailedBody:
    "修復は完了しませんでした。もう一度お試しください。続くときはプロジェクトを再読み込みしてください。",
  importTitle: "スキルを追加",
  previewTemplateTitle: "新しいスキルをプレビュー",
  importCancel: "キャンセル",
  importFailed: "スキルを取り込めませんでした",
  importInvalid: "取り込み結果が正しくありません。もう一度お試しください。",
  launchBlockedTitle: "スキルの準備がまだできていません",
  launchBlockedBody:
    "準備できていないスキルがあります。スキル設定を開いて直してください。",
  launchOperationBusy:
    "別のスキル更新がまだ終わっていません。少し待ってからもう一度お試しください。",
  launchIssueProjection:
    "エージェントはまだ {{skill}} を使えません。スキル設定を開いて再試行してください。",
  launchIssueTargetModified:
    "{{target}} が Pier の外で変わりました。スキル設定を開いて解消してください。",
  launchIssueDuplicate:
    "同じスキルを複数のフォルダから見つけるエージェントがあります。スキル設定を開いて、一つの出所を選んでください。",
  launchOpenSettings: "スキル設定を開く",
  launchAnyway: "このまま起動",
  launchCancel: "キャンセル",
  backToList: "プロジェクト一覧に戻る",
  currentBadge: "現在",
  deleteSkill: "このスキルを削除",
  enableSkill: "スキルを有効にする",
  enableSkillLabel: "このスキルを有効にする",
  enableSkillHint:
    "オンにすると、インストール済みのエージェントがこのスキルを見つけて使えます。",
  enableSkillHintPending:
    "保存すると有効になります。オンにすると、インストール済みのエージェントがこのスキルを見つけて使えます。",
  deliveryClaude: "Claude Code でも使えるようにする",
  deliveryClaudeHint:
    "オンにしたスキルは普段のエージェントに渡ります。これをオンにすると Claude Code にも渡ります。",
  listTitle_one: "スキル（{{count}}）",
  listTitle_other: "スキル（{{count}}）",
  skillCount_one: "管理中のスキル {{count}} 件",
  skillCount_other: "管理中のスキル {{count}} 件",
  loadFailed: "スキルを読み込めませんでした",
  projectsTitle: "プロジェクト",
  addProject: "プロジェクトを追加",
  addProjectFailed: "プロジェクトを追加できませんでした",
  addProjectFailedBody:
    "プロジェクトフォルダを選び直して、もう一度お試しください。",
  projectsLoadFailed: "プロジェクトを読み込めませんでした",
  projectsLoadFailedBody:
    "もう一度試して、プロジェクト一覧を読み込んでください。",
  noResultsTitle: "一致するスキルはありません",
  noResultsDescription:
    "検索や絞り込みを変えて、ほかのスキルを表示してください。",
  clearFilters: "検索と絞り込みを消す",
  resultCount_one: "{{shown}} / {{total}} 件のスキル",
  resultCount_other: "{{shown}} / {{total}} 件のスキル",
  addSkill: "スキルを追加",
  addFromFolder: "フォルダから取り込む",
  addBlank: "新しいスキルを追加",
  blankIdTitle: "名前",
  blankIdBody: "小文字、数字、ハイフン（例: review-guide）。",
  blankIdInvalid:
    "小文字、数字、ハイフンだけを使い、先頭は文字または数字にしてください。",
  blankIdReserved:
    "「pier-」で始まる名前は Pier のシステムスキル用に予約されています。",
  blankIdTaken: "この名前のスキルはすでにあります。別の名前を選んでください。",
  confirmAdd: "追加",
  createFailed: "スキルを追加できませんでした",
  createFailedBody:
    "スキルの追加中に問題が起きました。もう一度お試しください。",
  createSkillMdInvalid:
    "SKILL.md の frontmatter を直してください。上の欄と同じ name と、description が必要です。",
  createContentSaveFailedBody:
    "スキルは追加しましたが、SKILL.md の内容を保存できませんでした。スキルを開いてもう一度編集してください。",
  open: "開く",
  unmanagedBadge: "プロジェクト内",
  userGlobalBadge: "この Mac",
  importAsManaged: "Pier で管理",
  systemBadge: "Pier システム",
  unmanagedConflictBadge: "パス使用中",
  unmanagedConflictHelpLabel: "パス使用中について",
  unmanagedConflictHint:
    "{{target}} にはすでに内容があります。Pier は上書きしません。Pier のコピーを使うには、先にそのパスを別の場所へ移してください。",
  pierLibraryBadge: "Pier",
  pierBoundBadge: "Pier",
  alwaysIncludeBadge: "常に含める",
  removeFromProject: "このプロジェクトから外す",
  removeFromProjectFailed: "このプロジェクトから Pier スキルを外せませんでした",
  bindFromLibrary: "Pier ライブラリから追加",
  bindFromLibraryTitle: "Pier ライブラリから追加",
  bindFromLibraryAdd: "プロジェクトに追加",
  bindFromLibraryFailed:
    "ライブラリのスキルをこのプロジェクトに追加できませんでした",
  bindFromLibraryEmptyTitle: "追加できるものはありません",
  bindFromLibraryEmptyBody:
    "先に Pier ホームでスキルを追加してください。すでに追加済みか、常に含める対象の可能性があります。",
  bindAlsoClaude: "Claude Code にも提供する",
  bindAlsoClaudeHint:
    "Claude Code にもインストールします。あとのライブラリ編集はプロジェクトのコピーにも反映されます。",
  managedSource: {
    localImport: "この Mac で追加",
    projectDiscoveryImport: "プロジェクトから取り込み",
    gitDeclared: "リポジトリで宣言",
    pierHome: "Pier ホームからインストール",
    pierSystem: "Pier 内蔵",
  },
  effectDiscoverable: "見つけられる",
  effectNotProjected: "未有効",
  effectShadowed: "この Mac の同名スキルに隠れています",
  effectOverridden: "別のコピーが優先されます",
  effectDuplicate: "複数の場所で見つかります",
  effectRootNotScanned: "このフォルダは探しません",
  effectNotInstalled: "未インストール",
  effectUnknownVersion: "バージョン確認が必要です",
  skillOn: "オン",
  skillOff: "オフ",
  leaveEditTitle: "保存していないスキルの編集を破棄しますか？",
  leaveEditBody: "スキル内容の未保存の変更は失われます。",
  confirmGitDeleteTitle:
    "{{target}} のエージェントスキルフォルダを削除しますか？",
  confirmGitDeleteBody:
    "このパスは Git が追跡しています。削除すると、リポジトリの変更に削除として出ます。",
  confirmContentDeleteTitle: "スキル {{skill}} を削除しますか？",
  confirmContentDeleteBody:
    "このプロジェクトからスキルを外します。スイッチをオフにするだけでは、エージェントから隠れるだけです。この操作は元に戻せません。",
  confirmUnmanagedReplaceTitle: "{{target}} の既存内容を置き換えますか？",
  confirmUnmanagedReplaceBody:
    "そのパスには Pier が管理していない内容があります。続けるとそれを削除し、Pier のスキルリンクを入れます。",
  confirmUnmanagedReplaceAction: "置き換えて続ける",
  confirmSkillsStateResetTitle:
    "このプロジェクトのスキル記録を再構築しますか？",
  confirmSkillsStateResetBody:
    "このプロジェクトのスキル記録が壊れています。続けると使える一覧を再構築し、復元できないデータは破棄します。",
  confirmSkillsStateResetAction: "再構築して続ける",
  issueUnmanagedConflict:
    "{{target}} にはすでに同名の内容があります。有効にすると、Pier の版で置き換える確認が出ます。",
  issueDuplicateDiscovery:
    "Claude Code への提供がオンだと、{{agent}} が複数のディレクトリで同名スキルを見つけます。Claude Code への提供をオフにすると解消できます。",
  issueIdentityChanged:
    "プロジェクトのディレクトリが移動または置き換えられました。プロジェクト一覧に戻り、もう一度開いてください。",
  issueMissingSource:
    "{{skill}} のライブラリ内容がありません（.pier/skills/library/{{skill}}）。スキルを削除するか、もう一度取り込んでください。",
  issueInvalidManifest:
    "このプロジェクトのスキル一覧が壊れています。スキルの設定を直してから再読み込みしてください。",
  issueLedgerCorrupt:
    "このプロジェクトの Pier のローカルスキル記録が壊れています。プロジェクトを再読み込みするか、壊れた記録を除いてからもう一度お試しください。",
  issueRecoveryBlocked:
    "前回のスキル変更がきれいに終わりませんでした。再試行するか、プロジェクトを再読み込みしてください。",
  issueGeneric:
    "エージェントは影響を受けたスキルをまだ使えません。表示されている問題を解消してから再試行してください。",
  missingBadge: "内容がありません",
  actionFailed: "この操作を完了できませんでした",
  actionFailedBody: "プロジェクトを再読み込みして、もう一度お試しください。",
  actionBlockedTitle: "この操作は完了できません",
  actionBlockedBody:
    "このスキルに出ている問題を解消してから、もう一度お試しください。",
  actionDangerConfirmTitle: "この変更を続けますか？",
  actionDangerConfirmBody:
    "Pier が管理するファイルが変わります。続ける前に、影響を受けるスキルを確認してください。",
  projectionIncomplete: "まだ準備できていないエージェントがあります",
  projectionIncompleteBody:
    "スキルは保存しましたが、一部のエージェントはまだ使えません。再試行してください。続くときはプロジェクトを再読み込みしてください。",
  retry: "再試行",
  operationNotApplied:
    "前回の操作は終わりませんでした。プロジェクトを再読み込みしてから、その操作をもう一度してください。",
  applyIndeterminate:
    "ディスクの状態を確認しています…完了するまで編集は一時停止します。",
  skillDetailBack: "スキル一覧に戻る",
  editSave: "変更を保存",
  editDiscard: "変更を破棄",
  editFailed: "スキルを保存できませんでした",
  matrixTitle: "使えるエージェント",
  discoveryChannelsHint: "保存すると変更が適用されます。",
  discoveryChannelsHintAdd:
    "チェックしたパスは、スキルを追加すると適用されます。",
  metadataFiles_one: "{{count}} 個のファイル · {{size}}",
  metadataFiles_other: "{{count}} 個のファイル · {{size}}",
  riskTitle: "リスクの注記",
  riskExecutables_one: "実行可能ファイル {{count}} 個",
  riskExecutables_other: "実行可能ファイル {{count}} 個",
  riskDynamic_one: "動的コマンドの痕跡 {{count}} 件",
  riskDynamic_other: "動的コマンドの痕跡 {{count}} 件",
  riskFrontmatter: "{{keys}} を宣言",
  riskDisclaimer:
    "Pier は構造だけを確認します。内容が安全であることは検証しません。",
  copyPath: "ライブラリのパスをコピー",
  copySuccess: "コピーしました",
  copyFailed: "コピーできませんでした",
  importSource: "出所: {{path}}",
  importReadOnlyCopy:
    "これは読み取り専用のコピーです。元のディレクトリは変更も削除もしません。",
  importExpired: "この取り込みは期限切れです。出所を選び直してください。",
  candidateExpiredBody:
    "戻って出所を選び直し、新しいプレビューを作ってください。",
  conflictExists:
    "id が {{id}} の管理スキルはすでにあります。上書きや名前の変更には対応していません。",
  conflictExistsBody:
    "スキル一覧に戻って既存のスキルを開くか、別の出所を選んでください。",
  conflictReloadBody:
    "この操作を開いているあいだにファイルが変わりました。スキル一覧を再読み込みしてから、操作を選び直してください。",
  identityChangedBody:
    "プロジェクト一覧に戻ってこのプロジェクトを開き直してから、もう一度お試しください。",
  reloadAndReturn: "再読み込みして戻る",
  addSkillCommit: "スキルを追加",
  leaveBlocked:
    "まだディスクの状態を確認しています。少ししてから再度離れてください。",
  confirmDeleteAction: "削除",
  launchCancelledPanel:
    "起動をキャンセルしました。このプロジェクトのスキルはまだ準備できていません。スキル設定を開いてから、新しいターミナルを開始してください。",
  sourceTemplate: "この Mac で追加",
  blankDefaultDescription:
    "エージェントがこのスキルを使うべき場面を書いてください。",
  discoveryChannelSummary_one: "{{count}} 件のエージェント · {{path}}",
  discoveryChannelSummary_other: "{{count}} 件のエージェント · {{path}}",
  discoveryChannelSummaryNoPath_one: "{{count}} 件のエージェント",
  discoveryChannelSummaryNoPath_other: "{{count}} 件のエージェント",
  effectSummaryNone: "エージェントは使えません",
  openProjectMissing: "プロジェクトのスキルを開けませんでした",
  importFailedBody: "スキルの出所を選び直して、もう一度お試しください。",
  loadFailedBody:
    "プロジェクトを再読み込みするか、プロジェクト一覧に戻ってください。",
} as const;
