import type { AgentLifecycleSpec } from "./types.ts";

/** P1: package-manager full installs (scope-locked npm / brew / pipx). */
export const TIER_B_SPECS: readonly AgentLifecycleSpec[] = [
  {
    agentId: "qwen-code",
    expectedBins: ["qwen"],
    npmPackageForLatest: "@qwen-code/qwen-code",
    support: "full",
    // https://qwenlm.github.io/qwen-code-docs — standalone script recommended
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1",
      },
      { kind: "brew", formula: "qwen-code" },
      { kind: "npm", package: "@qwen-code/qwen-code", bin: "qwen" },
    ],
    update: [
      { kind: "npm-latest" },
      { kind: "brew-upgrade" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "kilo",
    expectedBins: ["kilo", "kilocode"],
    npmPackageForLatest: "@kilocode/cli",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://kilo.ai/cli/install",
      },
      { kind: "brew", formula: "kilo", tap: "Kilo-Org/tap" },
      { kind: "npm", package: "@kilocode/cli", bin: "kilo" },
    ],
    update: [
      { kind: "self", argv: ["upgrade"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "aug",
    expectedBins: ["auggie"],
    npmPackageForLatest: "@augmentcode/auggie",
    support: "full",
    install: [{ kind: "npm", package: "@augmentcode/auggie", bin: "auggie" }],
    // https://docs.augmentcode.com/cli/autoupgrade
    update: [
      { kind: "self", argv: ["upgrade"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "codebuff",
    expectedBins: ["codebuff"],
    npmPackageForLatest: "codebuff",
    support: "full",
    install: [{ kind: "npm", package: "codebuff", bin: "codebuff" }],
    update: [{ kind: "npm-latest" }],
  },
  {
    agentId: "amp",
    expectedBins: ["amp"],
    // Package renamed from @sourcegraph/amp → @ampcode/cli (2026).
    // https://ampcode.com/manual — script preferred; npm for enterprises.
    npmPackageForLatest: "@ampcode/cli",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://ampcode.com/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://ampcode.com/install.ps1",
      },
      { kind: "brew", formula: "ampcode", tap: "ampcode/tap" },
      { kind: "npm", package: "@ampcode/cli", bin: "amp" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "crush",
    expectedBins: ["crush"],
    // Official: brew charmbracelet/tap/crush · npm @charmland/crush (never bare `crush`).
    // https://github.com/charmbracelet/crush
    npmPackageForLatest: "@charmland/crush",
    support: "full",
    install: [
      { kind: "brew", formula: "crush", tap: "charmbracelet/tap" },
      { kind: "npm", package: "@charmland/crush", bin: "crush" },
    ],
    update: [{ kind: "brew-upgrade" }, { kind: "npm-latest" }],
  },
  {
    agentId: "goose",
    expectedBins: ["goose"],
    support: "full",
    // https://goose-docs.ai — install script + brew formula + `goose update`
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh",
      },
      {
        // stable release .ps1 is 404; raw main ships the Windows installer.
        kind: "official-script",
        platform: "win",
        url: "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1",
      },
      { kind: "brew", formula: "block-goose-cli" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "aider",
    expectedBins: ["aider"],
    support: "full",
    // Official docs prefer uv / install.sh; pipx and Homebrew as fallbacks.
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://aider.chat/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://aider.chat/install.ps1",
      },
      { kind: "uv", package: "aider-chat" },
      { kind: "pipx", package: "aider-chat" },
      { kind: "brew", formula: "aider" },
    ],
    update: [
      { kind: "uv-upgrade" },
      { kind: "pipx-upgrade" },
      { kind: "brew-upgrade" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "cline",
    expectedBins: ["cline"],
    npmPackageForLatest: "cline",
    support: "full",
    install: [{ kind: "npm", package: "cline", bin: "cline" }],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "continue",
    expectedBins: ["cn"],
    npmPackageForLatest: "@continuedev/cli",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://raw.githubusercontent.com/continuedev/continue/main/extensions/cli/scripts/install.ps1",
      },
      { kind: "npm", package: "@continuedev/cli", bin: "cn" },
    ],
    // Path/script installs: re-run installer or npm; no reliable self-update argv.
    update: [{ kind: "npm-latest" }, { kind: "reinstall" }],
  },
  {
    agentId: "mistral-vibe",
    expectedBins: ["vibe", "mistral-vibe"],
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://mistral.ai/vibe/install.sh",
      },
      { kind: "uv", package: "mistral-vibe" },
      { kind: "pipx", package: "mistral-vibe" },
    ],
    update: [
      { kind: "uv-upgrade" },
      { kind: "pipx-upgrade" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "droid",
    expectedBins: ["droid"],
    npmPackageForLatest: "@factory/cli",
    support: "full",
    // https://docs.factory.ai — curl install preferred; brew cask; npm fallback
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://app.factory.ai/cli",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://app.factory.ai/cli/windows",
      },
      { kind: "brew", formula: "droid", cask: true },
      { kind: "npm", package: "@factory/cli", bin: "droid" },
    ],
    // https://docs.factory.ai — `droid update` for standalone; brew/npm for PM installs
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "pi",
    expectedBins: ["pi"],
    // Moved to earendil-works (2026-05); old @mariozechner package is frozen.
    // Install: curl pi.dev/install.sh · npm i -g --ignore-scripts @earendil-works/pi-coding-agent
    // Update: pi update --self (CLI only) · npm · re-run installer
    // https://pi.dev/docs/latest · https://pi.dev/news/2026/5/7/pi-has-a-new-home
    npmPackageForLatest: "@earendil-works/pi-coding-agent",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://pi.dev/install.sh",
      },
      {
        kind: "npm",
        package: "@earendil-works/pi-coding-agent",
        bin: "pi",
        // Official: npm i -g --ignore-scripts @earendil-works/pi-coding-agent
        extraArgs: ["--ignore-scripts"],
      },
    ],
    update: [
      { kind: "self", argv: ["update", "--self"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    // Oh My Pi (omp) — https://omp.sh / https://github.com/can1357/oh-my-pi
    // Install: curl -fsSL https://omp.sh/install | sh · brew · bun/npm package
    // Update: omp update (native) · brew upgrade · npm
    agentId: "omp",
    expectedBins: ["omp"],
    npmPackageForLatest: "@oh-my-pi/pi-coding-agent",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://omp.sh/install",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://omp.sh/install.ps1",
      },
      { kind: "brew", formula: "omp", tap: "can1357/tap" },
      { kind: "npm", package: "@oh-my-pi/pi-coding-agent", bin: "omp" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "codebuddy",
    expectedBins: ["codebuddy", "cbc"],
    npmPackageForLatest: "@tencent-ai/codebuddy-code",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://www.codebuddy.cn/cli/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://www.codebuddy.cn/cli/install.ps1",
      },
      {
        kind: "npm",
        package: "@tencent-ai/codebuddy-code",
        bin: "codebuddy",
      },
    ],
    // https://www.codebuddy.ai/docs/cli/installation — self-update detects install method
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "qodercli",
    expectedBins: ["qodercli"],
    npmPackageForLatest: "@qoder-ai/qodercli",
    support: "full",
    // https://docs.qoder.com/cli/install
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://qoder.com/install",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://qoder.com/install.ps1",
      },
      { kind: "npm", package: "@qoder-ai/qodercli", bin: "qodercli" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "autohand",
    expectedBins: ["autohand"],
    npmPackageForLatest: "autohand-cli",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://autohand.ai/install.sh",
      },
      { kind: "brew", formula: "autohand-code", tap: "autohandai/code" },
      { kind: "npm", package: "autohand-cli", bin: "autohand" },
    ],
    update: [
      { kind: "self", argv: ["update"] },
      { kind: "brew-upgrade" },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "command-code",
    expectedBins: ["command-code"],
    npmPackageForLatest: "command-code",
    support: "full",
    install: [{ kind: "npm", package: "command-code", bin: "command-code" }],
    update: [{ kind: "npm-latest" }],
  },
  {
    agentId: "kiro",
    expectedBins: ["kiro-cli"],
    support: "full",
    // Official docs: install script only (Homebrew not supported for the binary).
    // https://kiro.dev/docs/cli/installation — auto-updates in background.
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://cli.kiro.dev/install",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://cli.kiro.dev/install.ps1",
      },
    ],
    // Manual repair: re-run official installer.
    update: [{ kind: "reinstall" }],
  },
  {
    agentId: "mimo-code",
    expectedBins: ["mimo"],
    npmPackageForLatest: "@mimo-ai/cli",
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://mimo.xiaomi.com/install",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://mimo.xiaomi.com/install.ps1",
      },
      { kind: "npm", package: "@mimo-ai/cli", bin: "mimo" },
    ],
    // https://mimo.xiaomi.com/mimocode/cli-options — `mimo upgrade`
    update: [
      { kind: "self", argv: ["upgrade"] },
      { kind: "npm-latest" },
      { kind: "reinstall" },
    ],
  },
  {
    agentId: "antigravity",
    expectedBins: ["agy"],
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://antigravity.google/cli/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://antigravity.google/cli/install.ps1",
      },
    ],
    update: [{ kind: "reinstall" }],
  },
  {
    agentId: "devin",
    expectedBins: ["devin"],
    support: "full",
    install: [
      {
        kind: "official-script",
        platform: "posix",
        url: "https://cli.devin.ai/install.sh",
      },
      {
        kind: "official-script",
        platform: "win",
        url: "https://static.devin.ai/cli/setup.ps1",
      },
      { kind: "brew", formula: "devin-cli", cask: true },
    ],
    update: [{ kind: "brew-upgrade" }, { kind: "reinstall" }],
  },
];
