import type { AgentLifecycleSpec } from "./types.ts";

/** P0: full automation — official script and/or clear npm + self-update. */
export const TIER_A_SPECS: readonly AgentLifecycleSpec[] = [
  {
    agentId: "claude",
    expectedBins: ["claude"],
    npmPackageForLatest: "@anthropic-ai/claude-code",
    support: "full",
    // Official recommended: native installer first, then Homebrew cask, npm last.
    // https://code.claude.com/docs/en/setup
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://claude.ai/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://claude.ai/install.ps1",
      },
      {
        kind: "brew",
        formula: "claude-code",
        cask: true,
      },
      {
        kind: "npm",
        package: "@anthropic-ai/claude-code",
        bin: "claude",
      },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "codex",
    expectedBins: ["codex"],
    npmPackageForLatest: "@openai/codex",
    support: "full",
    // Official: standalone installer, brew cask, or npm.
    // https://github.com/openai/codex · chatgpt.com/codex/install.sh
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://chatgpt.com/codex/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://chatgpt.com/codex/install.ps1",
      },
      { kind: "brew", formula: "codex", cask: true },
      { kind: "npm", package: "@openai/codex", bin: "codex" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "gemini",
    expectedBins: ["gemini"],
    npmPackageForLatest: "@google/gemini-cli",
    support: "full",
    // Official: npm. Homebrew `gemini-cli` still exists on many machines and often
    // wins PATH over nvm — keep brew channels so brew-sourced installs can upgrade
    // (otherwise npm-latest updates a non-default copy and "Update all" never clears).
    // https://geminicli.com/docs/get-started/installation
    install: [
      { kind: "npm", package: "@google/gemini-cli", bin: "gemini" },
      { kind: "brew", formula: "gemini-cli" },
    ],
    update: [{ kind: "brew-upgrade" }, { kind: "npm-latest" }],
  },
  {
    agentId: "grok",
    expectedBins: ["grok"],
    npmPackageForLatest: "@xai-official/grok",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://x.ai/cli/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://x.ai/cli/install.ps1",
      },
      { kind: "npm", package: "@xai-official/grok", bin: "grok" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "opencode",
    expectedBins: ["opencode"],
    npmPackageForLatest: "opencode-ai",
    support: "full",
    // https://opencode.ai/docs — install script, npm, brew anomalyco/tap/opencode
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://opencode.ai/install",
      },
      { kind: "brew", formula: "opencode", tap: "anomalyco/tap" },
      { kind: "npm", package: "opencode-ai", bin: "opencode" },
    ],
    update: [
      { kind: "self", argv: ["upgrade"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "openclaw",
    expectedBins: ["openclaw"],
    npmPackageForLatest: "openclaw",
    support: "full",
    // https://docs.openclaw.ai/install — script recommended, npm alternate
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://openclaw.ai/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://openclaw.ai/install.ps1",
      },
      { kind: "npm", package: "openclaw", bin: "openclaw" },
    ],
    update: [
      { kind: "self", argv: ["update", "--yes"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "hermes",
    expectedBins: ["hermes"],
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://hermes-agent.nousresearch.com/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://hermes-agent.nousresearch.com/install.ps1",
      },
    ],
    // --yes skips interactive config migration prompts
    update: [
      { kind: "self", argv: ["update", "--yes"] },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "kimi",
    expectedBins: ["kimi", "kimi-cli"],
    // Official install is uv (Python): `uv tool install --python 3.13 kimi-cli`.
    // https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html
    // Legacy npm package @moonshot-ai/kimi-code is a different version line; keep
    // as fallback only for users who still have the npm global.
    npmPackageForLatest: "@moonshot-ai/kimi-code",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        // Script installs uv then `uv tool install kimi-cli`.
        url: "https://code.kimi.com/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://code.kimi.com/install.ps1",
      },
      // Alternate docs URL (same product family).
      {
        kind: "official-script",
        platform: "posix",
        url: "https://code.kimi.com/kimi-code/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://code.kimi.com/kimi-code/install.ps1",
      },
      { kind: "uv", package: "kimi-cli" },
      {
        kind: "npm",
        package: "@moonshot-ai/kimi-code",
        bin: "kimi",
      },
    ],
    // Prefer uv for uv-sourced installs; npm only when detected as npm family.
    // Self `kimi upgrade` can be interactive — avoid as primary automation path.
    update: [
      { kind: "uv-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "copilot",
    expectedBins: ["copilot"],
    npmPackageForLatest: "@github/copilot",
    support: "full",
    // https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://gh.io/copilot-install",
      },
      { kind: "npm", package: "@github/copilot", bin: "copilot" },
      { kind: "brew", formula: "copilot-cli", cask: true },
    ],
    // https://docs.github.com — `copilot update` for script installs
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "npm-latest" },
      { kind: "brew-upgrade" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "cursor",
    // Installer also links `agent`; keep cursor-agent first for detection mapping.
    // Bare `agent` is filtered in path-enum unless it resolves into cursor-agent
    // (avoids picking up Grok's `~/.grok/bin/agent`).
    expectedBins: ["cursor-agent", "agent"],
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://cursor.com/install",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://cursor.com/install?win32=true",
      },
    ],
    // `cursor-agent update` / `agent update` requires auth and exits 0 with
    // "Update failed: [unauthenticated]" — Pier would stop and never reinstall.
    // Official install script refreshes the package without auth (reinstall).
    // https://cursor.com/docs/cli/installation
    update: [{ kind: "reinstall" }, { kind: "self", argv: ["update"] }],
  },
];
