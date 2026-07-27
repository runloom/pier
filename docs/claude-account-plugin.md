# Claude account plugin (`pier.claude`)

Official managed plugin for Claude account management in Pier, at feature
parity with `pier.codex` / `pier.grok` within Claude Code's platform limits.

## Capabilities

- **Add** accounts via browser OAuth (PKCE against `claude.ai/oauth/authorize`,
  paste-code exchange) or by importing the current Claude CLI login
- **Switch** by restoring a saved credential into the active store
  (macOS Keychain or `~/.claude/.credentials.json`) and rewriting
  `~/.claude.json` `oauthAccount`; running Claude sessions must be restarted
- **Usage monitoring** via the OAuth usage endpoint Claude Code's `/usage`
  command uses (5-hour session + weekly windows), lease-gated polling,
  refresh-token rotation persisted to the managed store and mirrored to the
  active store
- **Remove** any account, including the active one (clears the selection; the
  CLI's live login is never touched — while it stays signed in, drift adoption
  may re-import it)
- **API-key mode signal**: when the device is configured with
  `ANTHROPIC_API_KEY` (login-shell env) or `primaryApiKey`, the snapshot
  carries `apiKeyModeDetected` and the settings page shows a notice — Claude
  sessions may not use the managed account. Identity detection requires a
  usable claude.ai OAuth envelope, so a stale `oauthAccount` cache alone never
  surfaces a wrong account.

## Cross-tool peer sync

On account switch (opt-in checkboxes) or via **Sync to other tools**, Pier can
mirror the managed Claude OAuth tokens into:

- OpenCode → `~/.local/share/opencode/auth.json` key `anthropic`
- Pi → `~/.pi/agent/auth.json` key `anthropic`
- OMP → `~/.omp/agent/agent.db` provider `anthropic` / `oauth`

Tokens use the same Claude Code OAuth client id as community tools. Already-
running peer sessions may need a restart. Shared refresh tokens can be rotated
by whichever tool refreshes first.

## Intentional omissions

- No API-key account kind (the plugin manages claude.ai OAuth logins;
  API-key mode is surfaced, not managed)


## Layout

Mirrors the Codex/Grok managed-plugin shape under `packages/plugin-claude/`:
shared DTOs, main accounts service + provider + OAuth/usage modules, renderer
settings page and workbench widget, signed official index entry, bundled
`extraResources`.
