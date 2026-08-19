/** Settings → Terminal card for installing the packaged `pier` command. */
export const settingsCliCommand = {
  title: "pier コマンド",
  description:
    "インストールすると、ターミナルから pier を実行してこの Pier ウインドウを操作できます。",
  statusLabel: "状態:",
  status: {
    installed: "{{path}} にインストール済み",
    notInstalled: "未インストール",
    loading: "確認中…",
  },
  reason: {
    dev: "開発ビルドでは pier コマンドを追加しません。Pier のリポジトリで pnpm --silent cli:dev -- … を実行してください。",
    unsupported:
      "このシステムはまだ pier コマンドのインストールに対応していません。",
    missingSource: "この Pier ビルドには pier コマンドのファイルがありません。",
    conflict:
      "{{path}} に別の pier があります。削除してからもう一度お試しください。",
    needsAdmin:
      "macOS が {{path}} に pier を追加するためパスワードを求めます。",
  },
  install: "pier コマンドをインストール",
  installing: "インストール中…",
  uninstall: "pier コマンドを削除",
  uninstalling: "削除中…",
  installConfirmTitle: "pier コマンドをインストールしますか？",
  installConfirmBody:
    "macOS が {{path}} に pier を追加するためパスワードを求めます。",
  uninstallConfirmTitle: "pier コマンドを削除しますか？",
  uninstallConfirmBody:
    "{{path}} から pier を削除します。あとからまたインストールできます。",
  installFailed: "pier コマンドをインストールできませんでした",
  uninstallFailed: "pier コマンドを削除できませんでした",
  statusFailed: "pier コマンドの状態を読めませんでした。もう一度お試しください",
  toastInstalled: "pier コマンドをインストールしました",
  toastAlreadyInstalled: "pier コマンドはすでにインストールされています",
  toastRemoved: "pier コマンドを削除しました",
} as const;
