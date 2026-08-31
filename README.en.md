<!-- source: README.md (zh-CN). Keep the same section order; do not add or drop headings. -->

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <strong>English</strong>
  ·
  <a href="README.ja.md">日本語</a>
  ·
  <a href="README.ko.md">한국어</a>
</p>

<h1 align="center">Pier</h1>

<p align="center">
  <strong>Several AI terminals running. See at a glance who is waiting on you.</strong><br />
  Claude Code and Codex stay in their own terminals. Edit files and review git right beside them.
</p>

<p align="center">
  <a href="https://pier.codes">Website</a> ·
  <a href="https://github.com/runloom/pier/releases">Download</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href=".pier/canvases/pier-cli-user-manual/README.en.md">CLI manual</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

> The desktop app currently supports **macOS** only (Apple Silicon / Intel).

## Why Pier

**Still the original terminal.** Not another chat window. Accounts and subscriptions stay put. Claude Code, Codex, and OpenCode keep running in their own terminals.

**See who is waiting on you.** Running sessions, sessions that need attention, and sessions in error are visible in one place. No tab hunting — click to return to that terminal.

**Edit files and git without opening another window.** Open files, stage by file or hunk, commit, and push. For a one-line change or everyday git, you don't have to switch to another editor.

## Core workflow

1. Open Claude Code, Codex, or another CLI in the project or a git worktree.
2. When several sessions run at once, see who is running, who needs attention, and who hit an error.
3. Click that row to go back to the original terminal, confirm, or keep writing.
4. The terminal keeps running. Open files, review the diff, then commit.

## Core capabilities

- **Native terminal** — Run a shell and command-line coding agents in the project or a worktree. Terminals that are already running stay usable after the UI reloads.
- **Session status** — See running sessions, sessions that need attention, and errors in one place. Click to return to that terminal.
- **Separate directories for separate tasks** — Give each task its own project directory (a git worktree) so file changes don't collide.
- **Files, editing, and git** — Open and edit project files; review diffs; stage by file or hunk; commit, push, branch, and stash from the command palette.
- **Canvas** — Project-saved pages are already available. Using terminals and status to assemble boards and run graphs is still in progress.
- **Saved layouts** — Organize terminals, editors, and changes with tabs, splits, and floating panels. Layouts save automatically.

## Other capabilities

- **Project preview** — Preview Markdown, images, and other supported project files
- **Local CLI** — Use `pier` to open a project, locate windows and panels, open a terminal and send text or keypresses, and query agents and worktrees. It only talks to Pier running on this machine
- **Plugins** — Built-in plugins and official signed, verified, versioned plugins work today. More sources will come later; current install scope is in [`docs/plugins.md`](docs/plugins.md)

## Product boundary

The app itself does not ship a task ledger or auto-scheduler. Boards and run graphs are assembled from terminals and status on Canvas, and that work is still in progress.

Not a chat window. After you leave, the original CLIs, accounts, and repositories keep working as they did.

## Install

### Use a release

Download the current macOS build for Apple Silicon or Intel from [GitHub Releases](https://github.com/runloom/pier/releases). Open Pier, choose a project folder, and you can run agents in the terminal, browse files, and review changes.

After a release launch, Pier installs `pier` on your `PATH` when the directory is writable. You can also install it in Settings → Terminal, run `/Applications/Pier.app/Contents/Resources/bin/pier` directly, or add that directory to the current terminal `PATH` using the [CLI manual](.pier/canvases/pier-cli-user-manual/README.en.md).

### Run from source

Requires Node.js `^24.15.0`, pnpm `>=11.12.0`, Xcode Command Line Tools, Homebrew, and `zig@0.15`. The repo pins pnpm `11.18.0` via `packageManager`.

```bash
git clone https://github.com/runloom/pier.git
cd pier
pnpm bootstrap
pnpm dev
```

The first time you enter an existing git worktree, run `pnpm setup:worktree`. Dependency checks, common issues, and build steps are in [`docs/development.md`](docs/development.md).

## Local CLI

The `pier` binary in a release starts the app when it is not already running. The CLI controls local Pier. It is not a remote API.

```bash
pier status --json
pier . --json
pier panels list --json
```

Common commands, the dev invocation, and status semantics are in the [CLI user manual](.pier/canvases/pier-cli-user-manual/README.en.md).

## Docs

- [Development guide](docs/development.md) — environment, worktrees, checks, and builds
- [CLI user manual](.pier/canvases/pier-cli-user-manual/README.en.md) — control a running local Pier
- [Official plugins](docs/plugins.md) — scope, development, and verification
- [Release guide](docs/release.md) — maintainer release flow
- [Changelog](CHANGELOG.md) — released and unreleased changes
- [Full docs index](docs/README.md) — find material by user, contributor, or maintainer

## Contributing

Issues and pull requests are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Except for small documentation fixes, contributions need a contributor license before merge.

Before you submit:

```bash
pnpm check
```

## Security and licensing

Report security issues privately using [`SECURITY.md`](SECURITY.md). Do not file a public Issue.

- Source is released under [`AGPL-3.0-only`](LICENSE)
- Closed-source distribution, white-label, enterprise support, or rights beyond AGPLv3 need a separate commercial agreement
- Trademarks and third-party assets: [`TRADEMARKS.md`](TRADEMARKS.md), [`NOTICE`](NOTICE), and [`docs/legal/licensing.md`](docs/legal/licensing.md)
