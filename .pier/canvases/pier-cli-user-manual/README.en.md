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

# Pier local CLI user manual

`pier` controls Pier on this machine: open a project, locate windows and panels, drive a terminal, inspect agent status, and manage git worktrees. It is not a remote API, and it does not replace the native CLIs of Claude Code, Codex, OpenCode, or similar tools.

> This page is the GitHub-readable entry. The in-app searchable manual is [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) and [`data.json`](./data.json) (currently Simplified Chinese). Sample responses here are for reading; scripts should check `ok`, `data`, or `error` in the current `--json` response.

## 60-second start

The `pier` binary in a release starts the app when it is not already running. A release does not rewrite your shell `PATH`. If Pier is in the default `/Applications`, run this in the current terminal first:

```bash
export PATH="/Applications/Pier.app/Contents/Resources/bin:$PATH"
```

If the app lives in `~/Applications`, change that path to `$HOME/Applications/Pier.app/Contents/Resources/bin`. Then run:

```bash
# 1. Confirm you are connected to local Pier
pier status --json

# 2. Open the current project in Pier (focus an existing regular terminal with the same working directory)
pier . --json

# 3. List windows and panels
pier windows list --json
pier panels list --json

# 4. List known products and running agents
pier agents catalog --json
pier agents list --json
```

You can skip changing `PATH` and run `/Applications/Pier.app/Contents/Resources/bin/pier <command…>` directly. From a source checkout:

```bash
pnpm --silent cli:dev -- status --json
```

Or run `node ./bin/pier.mjs <command…>` directly.

## Common options

| Option | Meaning |
| --- | --- |
| `--json` | Print stable JSON; scripts should always pass this |
| `--print-envelope` | Print the request that would be sent, without running it |
| `--no-focus` | Avoid bringing a Pier window to the front |
| `--window <id>` | Target a window; query with `pier windows list --json` first |

A success response has `ok: true` and `data`. A failure response has `ok: false`, an error code, and a human-readable message.

## Open a project and arrange panels

```bash
# Open the current directory; focus an existing regular terminal with the same working directory, otherwise create one
pier . --json

# Open a given directory; optionally split another pane to the right of the current layout
pier open /path/to/repo --json
pier open . --split right --json

# Open a file (reuse the tab if it is already open; optional :line[:column])
pier src/app.ts:12 --json

# Find and focus a panel
pier panels list --json
pier panels focus <panelId> --json

# Open a new terminal (always creates; never reuses)
pier terminal open --cwd . --json
pier terminal open --cwd . --json -- claude
```

Terminal locate commands do not return the full terminal contents:

```bash
pier terminal list --json
pier terminal get --panel <panelId> --json
```

For a regular shell terminal, you can send text or keypresses:

```bash
pier terminal send --panel <panelId> --text "pnpm test" --json
pier terminal key --panel <panelId> --key enter --json
```

For an agent panel, use `agents turn`, `agents interrupt`, and `agents terminate` in the next section. Do not drive agent runtime through ordinary terminal commands.

## Run and inspect agents

List the agents Pier knows, then start a persistent session:

```bash
pier agents catalog --json
pier agents start --agent codex --cwd . --json
```

`agents start` returns `bootId`, `runtimeId`, `generation`, and `panelId`. Later commands use that run reference:

```bash
pier agents turn \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --text "Check the current changes and run tests" \
  --json

pier agents wait \
  --boot <bootId> \
  --runtime <runtimeId> \
  --generation <generation> \
  --until attention \
  --json
```

Common queries and controls follow. `<run-ref>` in the table means the same `--boot <bootId> --runtime <runtimeId> --generation <generation>` group:

| Command | Use |
| --- | --- |
| `pier agents list --json` | List running agent panels |
| `pier agents get --panel <panelId> --json` | Inspect one running instance |
| `pier agents screen <run-ref> --json` | Read the visible terminal region, not the full conversation |
| `pier agents watch <run-ref> --json` | Stream runtime status changes |
| `pier agents focus <run-ref> --json` | Return to that panel |
| `pier agents interrupt <run-ref> --json` | Interrupt the current run |
| `pier agents terminate <run-ref> --json` | End that running instance |

`accepted: true` only means the input was delivered, not that the work is done. `agents wait` waits for `ready`, `waiting`, `exited`, or `attention`. `agents watch` observes status changes. The final result is still the agent's own output.

## git worktrees

```bash
# List worktrees in the repository
pier worktrees list --path /path/to/repo --json

# Create and open a separate worktree
pier worktrees create \
  --path /path/to/repo \
  --name retry-policy \
  --branch feature/retry-policy \
  --base main \
  --json
pier worktrees open /path/to/retry-policy --json

# Check or inspect a worktree
pier worktrees check --path /path/to/retry-policy --json
pier worktrees get --path /path/to/retry-policy --json
```

Before removing a Pier-managed worktree, Pier checks for active runs and uncommitted changes:

```bash
pier worktrees remove --path /path/to/retry-policy --json
```

## Shell tasks

These tasks are project-configured shell runs such as build and test. They are not a task ledger or an auto-scheduler:

```bash
pier tasks list --path . --json
pier tasks run <taskId> --path . --json
pier tasks status <runId> --json
pier tasks output <runId> --json
pier tasks stop <runId> --json
pier tasks cancel <runId> --json
```

## Notifications, preferences, and plugins

```bash
# Notification center
pier notifications list --unread --json
pier notifications get --id <id> --json
pier notifications focus --id <id> --json
pier notifications mark-read --id <id> --json

# Read-only preferences and plugin info
pier preferences read --json
pier plugins list --json
pier plugins inspect <pluginId> --json
```

Enable or disable plugins in Pier under Settings → Plugins. The local CLI does not expose that write permission.

## Troubleshooting connections

- Confirm the Pier app is running, not only that the `pier` command is installed.
- In development, use `pnpm --silent cli:dev -- <command…>` so you do not hit a release install by mistake.
- With multiple windows, run `pier windows list --json` first, then pass `--window <id>`.
- Scripts should read `ok` and `error.code`. Do not depend on human-readable output text.
- An `agents wait` timeout is not the same as the agent having failed. Keep querying with `agents get` or `agents watch`.

Fuller command groups and status semantics are in [`data.json`](./data.json). You can also open [`pier-cli-user-manual.canvas.tsx`](./pier-cli-user-manual.canvas.tsx) in Pier's Files panel for the searchable in-app manual.
