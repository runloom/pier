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
    // Official: npm. Homebrew gemini-cli is deprecated (sunsetting → Antigravity).
    // https://geminicli.com/docs/get-started/installation
    install: [{ kind: "npm", package: "@google/gemini-cli", bin: "gemini" }],
    update: [{ kind: "npm-latest" }],
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
    expectedBins: ["kimi"],
    npmPackageForLatest: "@moonshot-ai/kimi-code",
    support: "full",
    install: [
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
      {
        kind: "npm",
        package: "@moonshot-ai/kimi-code",
        bin: "kimi",
      },
    ],
    // Official `kimi upgrade` can be interactive — prefer non-interactive channels.
    update: [{ kind: "npm-latest" }, { kind: "reinstall" }],
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
    // https://cursor.com/docs/cli/installation — agent update
    update: [{ kind: "self", argv: ["update"] }, { kind: "reinstall" }],
  },
];
