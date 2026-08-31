<!-- source: README.md (zh-CN). Keep the same section order; do not add or drop headings. -->

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <a href="README.en.md">English</a>
  ·
  <strong>日本語</strong>
  ·
  <a href="README.ko.md">한국어</a>
</p>

# Pier 本機 CLI ユーザーマニュアル

`pier` は本機の Pier を操作します。プロジェクトを開く、ウインドウとパネルを探す、ターミナルを動かす、エージェントの状態を見る、git 作業ツリーを管理する、が対象です。リモート API ではなく、Claude Code、Codex、OpenCode など各ツール本体のコマンドラインの代わりにもなりません。

> 本ページは GitHub で読める入口です。アプリ内の検索できるマニュアルは [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) と [`data.json`](./data.json) です（現在は簡体字中国語）。ここにある戻り値は読むための例です。スクリプトは現行の `--json` 応答の `ok`、`data`、`error` を見てください。

## 60 秒で始める

正式インストールパッケージの `pier` は、アプリが動いていなければ先に起動してから実行します。リリース版は Shell の `PATH` を書き換えません。Pier が標準の `/Applications` にある場合は、先に現在のターミナルで次を実行します。

```bash
export PATH="/Applications/Pier.app/Contents/Resources/bin:$PATH"
```

アプリが `~/Applications` にある場合は、パスを `$HOME/Applications/Pier.app/Contents/Resources/bin` に変えます。そのあと実行します。

```bash
# 1. 本機の Pier に接続できているか確認
pier status --json

# 2. 現在のプロジェクトを Pier で開く（同じ作業ディレクトリの通常ターミナルがあればフォーカス）
pier . --json

# 3. ウインドウとパネルを見る
pier windows list --json
pier panels list --json

# 4. Pier が知る製品と、実行中のエージェントを見る
pier agents catalog --json
pier agents list --json
```

`PATH` を変えず、`/Applications/Pier.app/Contents/Resources/bin/pier <コマンド…>` を直接実行しても構いません。ソースから開発しているときは：

```bash
pnpm --silent cli:dev -- status --json
```

`node ./bin/pier.mjs <コマンド…>` を直接実行することもできます。

## よく使うオプション

| オプション | 意味 |
| --- | --- |
| `--json` | 安定した JSON を出す。スクリプトは常に付ける |
| `--print-envelope` | 送る予定のリクエストだけ印刷し、実行しない |
| `--no-focus` | Pier のウインドウを前面に出さないようにする |
| `--window <id>` | ウインドウを指定する。先に `pier windows list --json` で調べる |

成功応答は `ok: true` と `data` を含みます。失敗応答は `ok: false`、エラーコード、人が読めるメッセージを含みます。

## プロジェクトを開いてパネルを整える

```bash
# 現在のディレクトリを開く。同じ作業ディレクトリの通常ターミナルがあればフォーカス、なければ新規
pier . --json

# 指定ディレクトリを開く。現在の配置の右側に分割して足すこともできる
pier open /path/to/repo --json
pier open . --split right --json

# ファイルを開く（既に開いていればタブを再利用。:行[:列] を付けられる）
pier src/app.ts:12 --json

# パネルを探してフォーカス
pier panels list --json
pier panels focus <panelId> --json

# ターミナルを新規に開く（常に新規。再利用しない）
pier terminal open --cwd . --json
pier terminal open --cwd . --json -- claude
```

ターミナルを探すコマンドは、ターミナルの全内容を返しません。

```bash
pier terminal list --json
pier terminal get --panel <panelId> --json
```

通常の Shell ターミナルには、テキストやキーを送れます。

```bash
pier terminal send --panel <panelId> --text "pnpm test" --json
pier terminal key --panel <panelId> --key enter --json
```

エージェントパネルでは、次節の `agents turn`、`agents interrupt`、`agents terminate` を使います。通常のターミナルコマンドで実行状態を迂回しないでください。

## エージェントを実行して見る

先に Pier が知るエージェント一覧を見てから、継続して動くセッションを開始します。

```bash
pier agents catalog --json
pier agents start --agent codex --cwd . --json
```

`agents start` は `bootId`、`runtimeId`、`generation`、`panelId` を返します。以降のコマンドはこの実行参照を使います。

```bash
pier agents turn \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --text "現在の変更を確認してテストを実行" \
  --json

pier agents wait \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --until attention \
  --json
```

よく使う照会と操作は次のとおりです。表の `<実行参照>` は、同じ `--boot <bootId> --runtime <runtimeId> --generation <generation>` の組です。

| コマンド | 用途 |
| --- | --- |
| `pier agents list --json` | 実行中のエージェントパネルを一覧 |
| `pier agents get --panel <panelId> --json` | 実行中のインスタンスを照会 |
| `pier agents screen <実行参照> --json` | いま見えているターミナル領域を読む。会話全体ではない |
| `pier agents watch <実行参照> --json` | 実行状態の変化を受け取り続ける |
| `pier agents focus <実行参照> --json` | 対応するパネルに戻る |
| `pier agents interrupt <実行参照> --json` | 現在の実行を中断 |
| `pier agents terminate <実行参照> --json` | その実行インスタンスを終了 |

`accepted: true` は入力が届いたことだけを表し、作業が終わったことではありません。`agents wait` は `ready`、`waiting`、`exited`、`attention` を待ちます。`agents watch` は状態変化を観察します。最終結果はエージェント自身の出力です。

## git 作業ツリー

```bash
# リポジトリ内の作業ツリーを照会
pier worktrees list --path /path/to/repo --json

# 独立した作業ツリーを作って開く
pier worktrees create \
  --path /path/to/repo \
  --name retry-policy \
  --branch feature/retry-policy \
  --base main \
  --json
pier worktrees open /path/to/retry-policy --json

# 作業ツリーを検査または照会
pier worktrees check --path /path/to/retry-policy --json
pier worktrees get --path /path/to/retry-policy --json
```

Pier が管理する作業ツリーを削除する前に、Pier は活発な実行と未コミットの変更を確認します。

```bash
pier worktrees remove --path /path/to/retry-policy --json
```

## Shell タスク

ここでのタスクは、プロジェクトに設定した build、test などの Shell 実行です。タスク台帳や自動スケジューラではありません。

```bash
pier tasks list --path . --json
pier tasks run <taskId> --path . --json
pier tasks status <runId> --json
pier tasks output <runId> --json
pier tasks stop <runId> --json
pier tasks cancel <runId> --json
```

## 通知、設定、プラグイン

```bash
# 通知
pier notifications list --unread --json
pier notifications get --id <id> --json
pier notifications focus --id <id> --json
pier notifications mark-read --id <id> --json

# 読み取り専用の設定とプラグイン情報
pier preferences read --json
pier plugins list --json
pier plugins inspect <pluginId> --json
```

プラグインの有効化と無効化は Pier の「設定 → プラグイン」で行います。本機 CLI にこの書き込み権限はありません。

## 接続のトラブルシュート

- Pier アプリが起動していることを確認してください。`pier` コマンドが入っているだけでは不十分です。
- 開発時は `pnpm --silent cli:dev -- <コマンド…>` を使い、インストール版へ誤接続しないでください。
- ウインドウが複数あるときは、先に `pier windows list --json` を実行してから `--window <id>` を渡します。
- スクリプトは `ok` と `error.code` を見てください。人向けの出力テキストに依存しないでください。
- `agents wait` のタイムアウトは、エージェントが失敗したことと同じではありません。`agents get` または `agents watch` で状態を照会し続けられます。

コマンドのより詳しいグループ分けと状態は [`data.json`](./data.json) を見てください。Pier の Files パネルで [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) を開くと、検索できるアプリ内マニュアルも使えます。
