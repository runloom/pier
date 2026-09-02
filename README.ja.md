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

<h1 align="center">Pier</h1>

<p align="center">
  <strong>いくつもの AI ターミナルが開いていても、対応が必要な相手が一目でわかる。</strong><br />
  Claude Code と Codex は元のターミナルのまま。ファイルの編集と git の確認はすぐ横で。
</p>

<p align="center">
  <a href="https://pier.codes">サイト</a> ·
  <a href="https://github.com/runloom/pier/releases">ダウンロード</a> ·
  <a href="docs/README.md">ドキュメント</a> ·
  <a href=".pier/canvases/pier-cli-user-manual/README.ja.md">CLI マニュアル</a> ·
  <a href="CONTRIBUTING.md">貢献</a> ·
  <a href="CHANGELOG.md">変更履歴</a>
</p>

> デスクトップ版が現在対応しているのは **macOS** のみです（Apple Silicon / Intel）。

## なぜ Pier なのか

**元のターミナルのまま。** 別のチャット窓ではありません。アカウントとサブスクリプションはそのままです。Claude Code、Codex、OpenCode は、それぞれのターミナルで動き続けます。

**対応が必要な相手が見える。** 実行中、対応が必要、エラーのセッションを一箇所で見られます。タブを探し回らず、クリックして元のターミナルに戻ります。

**ファイルと git のために別窓を開かない。** ファイルを開いて直し、ファイル単位または断片単位でステージしてコミット、プッシュ。一行の修正や日常の git なら、別のエディタに切り替えなくてよいです。

## 中核の流れ

1. プロジェクトまたは git の作業ツリーで、Claude Code、Codex、その他のコマンドラインを開きます。
2. 複数のセッションが同時に動いているとき、誰が実行中か、誰が対応が必要か、誰がエラーかを見ます。
3. その行をクリックして、元のターミナルに戻り、確認するか書き続けます。
4. ターミナルは動き続けます。ファイルを開いて直し、diff を見てからコミットします。

## 中核の能力

- **ネイティブターミナル** — プロジェクトまたは作業ツリーで Shell とコマンドラインのプログラミングエージェントを実行します。画面を再読み込みしたあとも、実行中のターミナルはそのまま使えます
- **セッション状態** — 実行中、対応が必要、エラーのセッションを一箇所で見て、クリックで対応するターミナルに戻ります
- **タスクごとに別ディレクトリ** — タスクごとに独立したプロジェクトディレクトリ（git の作業ツリー）を用意し、ファイル変更がぶつからないようにします
- **ファイル、編集、git** — プロジェクトファイルを開いて編集します。diff を審査し、ファイル単位または断片単位でステージします。コミット、プッシュ、ブランチ、スタッシュはコマンドパレットから行えます
- **Canvas** — プロジェクトに保存するページはすでに使えます。ターミナルと状態でかんばんや実行図を組む作業は、まだ進めています
- **保存される配置** — タブ、分割、フローティングパネルでターミナル、エディタ、変更を整理します。配置は自動保存されます

## その他の能力

- **プロジェクト内容のプレビュー** — Markdown、画像、その他対応しているプロジェクトファイルをプレビューします
- **本機 CLI** — `pier` でプロジェクトを開き、ウインドウとパネルを探し、ターミナルを開いてテキストやキーを送り、エージェントと作業ツリーを問い合わせます。接続先は本機で動いている Pier だけです
- **プラグイン** — 内蔵プラグインと、公式が署名・検証・版管理するプラグインが使えます。今後さらにソースを足します。いまのインストール範囲は [`docs/plugins.md`](docs/plugins.md) を見てください

## 製品の境界

アプリ自体にタスク台帳や自動スケジューラはありません。かんばんや実行図は、ターミナルと状態を Canvas で組む想定で、その作業はまだ進めています。

チャット窓にはしません。離れたあとも、元のコマンドライン、アカウント、リポジトリはそのまま動きます。

## インストール

### リリース版を使う

[GitHub Releases](https://github.com/runloom/pier/releases) から、Apple Silicon または Intel 向けの現行 macOS 版をダウンロードします。Pier を開いてプロジェクトフォルダを選べば、ターミナルでエージェントを動かし、ファイルを見て、変更を審査できます。

リリース版の起動後、ディレクトリが書き込み可能なら `pier` を `PATH` に入れようとします。設定 → ターミナルからインストールするか、`/Applications/Pier.app/Contents/Resources/bin/pier` を直接実行するか、[CLI マニュアル](.pier/canvases/pier-cli-user-manual/README.ja.md) に従ってそのディレクトリを現在のターミナルの `PATH` に足すこともできます。

### ソースから実行

Node.js `^24.15.0`、pnpm `>=11.12.0`、Xcode Command Line Tools、Homebrew、`zig@0.15` が必要です。リポジトリは `packageManager` で pnpm `11.18.0` を固定しています。

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap
pnpm dev
```

既存の git 作業ツリーに初めて入るときは、先に `pnpm setup:worktree` を実行します。依存関係の確認、よくある問題、構築手順は [`docs/development.md`](docs/development.md) を見てください。

## 本機 CLI

正式インストールパッケージの `pier` は、アプリが動いていなければ先に起動します。CLI は本機の Pier を操作します。リモート API ではありません。

```bash
pier status --json
pier . --json
pier panels list --json
```

よく使うコマンド、開発時の呼び出し方、状態の意味は [CLI ユーザーマニュアル](.pier/canvases/pier-cli-user-manual/README.ja.md) を見てください。

## ドキュメント

- [開発ガイド](docs/development.md) — 環境、作業ツリー、検査と構築
- [CLI ユーザーマニュアル](.pier/canvases/pier-cli-user-manual/README.ja.md) — 起動済みの本機 Pier を操作する
- [公式プラグイン](docs/plugins.md) — 範囲、開発、検証
- [リリースガイド](docs/release.md) — メンテナ向けの公開手順
- [変更履歴](CHANGELOG.md) — 公開済みと未公開の変化
- [ドキュメント索引](docs/README.md) — 利用者、貢献者、メンテナ別に資料を探す

## 貢献

Issue と Pull Request を歓迎します。始める前に [`CONTRIBUTING.md`](CONTRIBUTING.md) を読んでください。小さなドキュメント修正を除き、マージ前に貢献者の許諾が必要です。

提出前に実行します：

```bash
pnpm check
```

## セキュリティとライセンス

セキュリティの問題は [`SECURITY.md`](SECURITY.md) に従って非公開で報告してください。公開 Issue にしないでください。

- ソースは [`AGPL-3.0-only`](LICENSE) で公開しています
- クローズドソース配布、ホワイトラベル、企業向けサポート、または AGPLv3 以外の権利には、別途の商業契約が必要です
- 商標と第三者資産は [`TRADEMARKS.md`](TRADEMARKS.md)、[`NOTICE`](NOTICE)、[`docs/legal/licensing.md`](docs/legal/licensing.md) を見てください
