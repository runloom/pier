/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "言語サービス（ホスト）",
  lspHostSectionDesc:
    "Pier が言語サーバーを起動するかどうかです。言語認識とハイライトは内蔵です。無いサーバーは下の一覧に出ます。対応するファイルを開くと、エディタの状態チップにもインストールコマンドが出ます。「エディタの言語機能」はファイルエディタがこれらのサービスを使うかどうかだけを制御します。",
  lspEnabled: "言語サーバーを実行",
  lspEnabledDesc:
    "オフにすると、どのプロジェクトでも補完や診断のプロセスは始まりません。",
  lspIdleReleaseMinutes: "アイドル解放",
  lspIdleReleaseMinutesDesc:
    "この分数だけアイドルならサーバーを解放します。範囲 1–1440",
  lspMaxLocalWorkspaces: "ローカルプロジェクト上限",
  lspMaxLocalWorkspacesDesc:
    "同時に言語サーバーを動かせるローカルプロジェクトの最大数",
  lspMaxRemoteWorkspaces: "リモートプロジェクト上限",
  lspMaxRemoteWorkspacesDesc:
    "同時に言語サーバーを動かせるリモートプロジェクトの最大数",
  lspMemoryBudgetMb: "メモリ予算",
  lspMemoryBudgetMbDesc:
    "言語サーバー全体のメモリ上限です。超えると、いちばん長く使っていないプロジェクトを停止し、必要になったら再起動します。0 は上限なしです",
  lspUpdateFailed:
    "言語サービスの設定を更新できませんでした。もう一度お試しください",
  lspWorktreesEnabled: "作業ツリーでも実行",
  lspWorktreesEnabledDesc:
    "エージェントの作業ツリーでも言語サーバーを起動します。作業ツリーが増えると負荷も増えます。",
  lspAdvancedTitle: "リソースと上限",
  lspAdvancedDesc: "多くの環境では初期値のままで問題ありません。",
  lspToolsTitle: "このパソコンの言語サーバー",
  lspToolsDesc:
    "補完、定義へ移動、診断は、このパソコンにある言語サーバーを使います。無いものは自分でインストールしてください。Pier は代行してダウンロードしません。",
  lspToolsLoading: "言語サーバーを確認中…",
  lspToolsEmpty: "言語サーバーを確認できませんでした",
  lspToolsEmptyDesc:
    "少し待ってもう一度試すか、Pier を再起動してこのページを開き直してください。",
  lspToolsNone: "一覧にする言語サーバーがありません",
  lspToolsNoneDesc: "いま確認できる言語サーバーはありません。",
  lspToolsStatusBundled: "内蔵",
  lspToolsStatusAvailable: "インストール済み",
  lspToolsStatusMissing: "未インストール",
  lspToolsInstallLabel: "インストール",
  lspToolsCopyInstall: "{{name}} のインストールコマンドをコピー",
  lspToolsCopied: "コピーしました",
  lspToolsCopyFailed: "インストールコマンドをコピーできませんでした",
} as const;
