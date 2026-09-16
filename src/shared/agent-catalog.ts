import type { AgentCatalogEntry, AgentKind } from "@shared/contracts/agent.ts";
import { APPKIT_KEYCODE } from "@shared/terminal-appkit-keys.ts";
import { AGENT_INITIAL_PROMPTS } from "./agent-surfaces/initial-prompts.ts";

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: "claude",
    initialPrompt: AGENT_INITIAL_PROMPTS.claude,
    label: "Claude",
    launchCmd: "claude",
    detectCmd: "claude",
    expectedProcess: "claude",
    iconId: "claude",
    homepageUrl: "https://claude.com/claude-code",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "codex",
    initialPrompt: AGENT_INITIAL_PROMPTS.codex,
    label: "Codex",
    launchCmd: "codex",
    detectCmd: "codex",
    expectedProcess: "codex",
    iconId: "codex",
    homepageUrl: "https://github.com/openai/codex",
    oneShotArgs: (prompt, { cwd }) => [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "--cd",
      cwd,
      prompt,
    ],
  },
  {
    id: "gemini",
    initialPrompt: AGENT_INITIAL_PROMPTS.gemini,
    label: "Gemini",
    launchCmd: "gemini",
    detectCmd: "gemini",
    expectedProcess: "gemini",
    iconId: "gemini",
    homepageUrl: "https://github.com/google-gemini/gemini-cli",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "aider",
    initialPrompt: AGENT_INITIAL_PROMPTS.aider,
    label: "Aider",
    launchCmd: "aider",
    detectCmd: "aider",
    expectedProcess: "aider",
    iconId: "aider",
    homepageUrl: "https://aider.chat/docs/",
  },
  {
    id: "opencode",
    initialPrompt: AGENT_INITIAL_PROMPTS.opencode,
    label: "OpenCode",
    launchCmd: "opencode",
    detectCmd: "opencode",
    expectedProcess: "opencode",
    faviconDomain: "opencode.ai",
    homepageUrl: "https://opencode.ai/docs/cli/",
    oneShotArgs: (prompt) => ["run", prompt],
  },
  {
    id: "cursor",
    initialPrompt: AGENT_INITIAL_PROMPTS.cursor,
    label: "Cursor",
    launchCmd: "cursor-agent",
    detectCmd: "cursor-agent",
    expectedProcess: "cursor-agent",
    faviconDomain: "cursor.com",
    homepageUrl: "https://cursor.com/cli",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "copilot",
    initialPrompt: AGENT_INITIAL_PROMPTS.copilot,
    label: "GitHub Copilot",
    launchCmd: "copilot",
    detectCmd: "copilot",
    expectedProcess: "copilot",
    iconId: "copilot",
    homepageUrl:
      "https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "droid",
    initialPrompt: AGENT_INITIAL_PROMPTS.droid,
    label: "Droid",
    launchCmd: "droid",
    detectCmd: "droid",
    expectedProcess: "droid",
    iconId: "droid",
    homepageUrl: "https://docs.factory.ai/cli/getting-started/quickstart",
  },
  {
    id: "kimi",
    initialPrompt: AGENT_INITIAL_PROMPTS.kimi,
    label: "Kimi",
    launchCmd: "kimi",
    detectCmd: "kimi",
    // OSC only: leftover Python `kimi-cli` still maps to this identity.
    // PATH / lifecycle presence is Kimi Code (`kimi`), not the uv package.
    detectCmdAliases: ["kimi-cli"],
    expectedProcess: "kimi",
    faviconDomain: "moonshot.cn",
    homepageUrl:
      "https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "pi",
    initialPrompt: AGENT_INITIAL_PROMPTS.pi,
    label: "Pi",
    launchCmd: "pi",
    detectCmd: "pi",
    expectedProcess: "pi",
    iconId: "pi",
    homepageUrl: "https://pi.dev",
  },
  {
    id: "amp",
    initialPrompt: AGENT_INITIAL_PROMPTS.amp,
    label: "Amp",
    launchCmd: "amp",
    detectCmd: "amp",
    expectedProcess: "amp",
    faviconDomain: "ampcode.com",
    homepageUrl: "https://ampcode.com/manual#install",
  },
  // 全集补全（去 claude-agent-teams——它探测/启动自身 CLI）。
  {
    id: "grok",
    initialPrompt: AGENT_INITIAL_PROMPTS.grok,
    label: "Grok",
    launchCmd: "grok",
    detectCmd: "grok",
    expectedProcess: "grok",
    faviconDomain: "x.ai",
    homepageUrl: "https://x.ai/cli",
    oneShotArgs: (prompt) => ["-p", prompt],
    // 实测（pty 探测）：首帧后硬件光标保持 `?25h`，浏览态（提示行为
    // `Space:prompt | Enter:open`）与聚焦态可区分，等价关系成立，故启用光标探针。
    inputFocusProbe: "cursor",
  },
  {
    id: "mimo-code",
    initialPrompt: AGENT_INITIAL_PROMPTS["mimo-code"],
    label: "MiMo Code",
    launchCmd: "mimo",
    detectCmd: "mimo",
    expectedProcess: "mimo",
    faviconDomain: "mimo.xiaomi.com",
    homepageUrl: "https://mimo.xiaomi.com/coder",
  },
  {
    id: "ante",
    initialPrompt: AGENT_INITIAL_PROMPTS.ante,
    label: "Ante",
    launchCmd: "ante",
    detectCmd: "ante",
    expectedProcess: "ante",
    faviconDomain: "antigma.ai",
    homepageUrl: "https://github.com/AntigmaLabs/ante-preview",
  },
  {
    id: "omp",
    initialPrompt: AGENT_INITIAL_PROMPTS.omp,
    label: "OMP",
    launchCmd: "omp",
    detectCmd: "omp",
    expectedProcess: "omp",
    iconId: "omp",
    homepageUrl: "https://omp.sh",
  },
  {
    id: "antigravity",
    initialPrompt: AGENT_INITIAL_PROMPTS.antigravity,
    label: "Antigravity",
    launchCmd: "agy",
    detectCmd: "agy",
    expectedProcess: "agy",
    faviconDomain: "antigravity.google",
    homepageUrl: "https://antigravity.google/docs/cli-overview",
  },
  {
    id: "goose",
    initialPrompt: AGENT_INITIAL_PROMPTS.goose,
    label: "Goose",
    launchCmd: "goose",
    detectCmd: "goose",
    expectedProcess: "goose",
    faviconDomain: "goose-docs.ai",
    homepageUrl: "https://block.github.io/goose/docs/quickstart/",
  },
  {
    id: "kilo",
    initialPrompt: AGENT_INITIAL_PROMPTS.kilo,
    // Official copy is "Kilo Code" / "Kilo CLI"; "kilocode" survives only in
    // org/npm identifiers and the legacy binary alias below.
    label: "Kilo Code",
    launchCmd: "kilo",
    detectCmd: "kilo",
    detectCmdAliases: ["kilocode"],
    expectedProcess: "kilo",
    iconId: "kilo",
    homepageUrl: "https://kilo.ai/docs/cli",
  },
  {
    id: "kiro",
    initialPrompt: AGENT_INITIAL_PROMPTS.kiro,
    label: "Kiro",
    launchCmd: "kiro-cli chat --tui",
    detectCmd: "kiro-cli",
    expectedProcess: "kiro-cli",
    faviconDomain: "kiro.dev",
    homepageUrl: "https://kiro.dev/docs/cli/",
  },
  {
    id: "crush",
    initialPrompt: AGENT_INITIAL_PROMPTS.crush,
    // crush 编辑器失焦（点消息区 / Tab 切到消息区）时会静默丢弃 paste 与
    // Enter；失焦必定隐藏硬件光标（ui.go Draw 里 textarea.Focused() 门控），
    // Tab 在 chat/main 态必定重新 Focus 编辑器（ui.go:2553），符合
    // inputFocusKey 的确定性要求。
    inputFocusKey: { keycode: APPKIT_KEYCODE.tab },
    // 实测（v0.86.0，pty 探测）：进入 chat 后编辑器聚焦 → `?25h`，Tab 切走
    // → `?25l`，切回 → `?25h`，等价关系成立，故启用光标探针。
    inputFocusProbe: "cursor",
    // Product name is Crush; Charm (charmbracelet) is the vendor, kept only
    // in faviconDomain / URLs.
    label: "Crush",
    launchCmd: "crush",
    detectCmd: "crush",
    expectedProcess: "crush",
    faviconDomain: "charm.sh",
    homepageUrl: "https://github.com/charmbracelet/crush",
  },
  {
    id: "aug",
    initialPrompt: AGENT_INITIAL_PROMPTS.aug,
    label: "Auggie",
    launchCmd: "auggie",
    detectCmd: "auggie",
    expectedProcess: "auggie",
    faviconDomain: "augmentcode.com",
    homepageUrl: "https://docs.augmentcode.com/cli/overview",
  },
  {
    id: "autohand",
    initialPrompt: AGENT_INITIAL_PROMPTS.autohand,
    label: "Autohand Code",
    launchCmd: "autohand",
    detectCmd: "autohand",
    expectedProcess: "autohand",
    faviconDomain: "autohand.ai",
    homepageUrl: "https://github.com/autohandai/code-cli",
  },
  {
    id: "cline",
    initialPrompt: AGENT_INITIAL_PROMPTS.cline,
    label: "Cline",
    launchCmd: "cline",
    detectCmd: "cline",
    expectedProcess: "cline",
    faviconDomain: "cline.bot",
    homepageUrl: "https://docs.cline.bot/cline-cli/overview",
  },
  {
    id: "codebuff",
    initialPrompt: AGENT_INITIAL_PROMPTS.codebuff,
    label: "Codebuff",
    launchCmd: "codebuff",
    detectCmd: "codebuff",
    expectedProcess: "codebuff",
    faviconDomain: "codebuff.com",
    homepageUrl: "https://www.codebuff.com/docs/help/quick-start",
  },
  {
    id: "command-code",
    initialPrompt: AGENT_INITIAL_PROMPTS["command-code"],
    label: "Command Code",
    launchCmd: "command-code --trust",
    detectCmd: "command-code",
    expectedProcess: "command-code",
    faviconDomain: "commandcode.ai",
    homepageUrl: "https://commandcode.ai/docs/quickstart",
  },
  {
    id: "continue",
    initialPrompt: AGENT_INITIAL_PROMPTS.continue,
    label: "Continue",
    launchCmd: "cn",
    detectCmd: "cn",
    expectedProcess: "cn",
    faviconDomain: "continue.dev",
    homepageUrl: "https://docs.continue.dev/guides/cli",
  },
  {
    id: "mistral-vibe",
    initialPrompt: AGENT_INITIAL_PROMPTS["mistral-vibe"],
    label: "Mistral Vibe",
    launchCmd: "vibe",
    detectCmd: "vibe",
    detectCmdAliases: ["mistral-vibe", "vibe-acp"],
    expectedProcess: "vibe",
    faviconDomain: "mistral.ai",
    homepageUrl: "https://github.com/mistralai/mistral-vibe",
  },
  {
    id: "qwen-code",
    initialPrompt: AGENT_INITIAL_PROMPTS["qwen-code"],
    label: "Qwen Code",
    // npm `@qwen-code/qwen-code` 安装后二进制为 `qwen`（integration detect 亦同）。
    launchCmd: "qwen",
    detectCmd: "qwen",
    detectCmdAliases: ["qwen-code"],
    expectedProcess: "qwen",
    faviconDomain: "qwenlm.github.io",
    homepageUrl: "https://github.com/QwenLM/qwen-code",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "rovo",
    initialPrompt: AGENT_INITIAL_PROMPTS.rovo,
    label: "Rovo Dev",
    launchCmd: "acli rovodev run",
    launchCommandPrefix: ["acli", "rovodev", "run"],
    detectCmd: "acli",
    expectedProcess: "acli",
    faviconDomain: "atlassian.com",
    homepageUrl:
      "https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/",
  },
  {
    id: "hermes",
    initialPrompt: AGENT_INITIAL_PROMPTS.hermes,
    label: "Hermes",
    // Hermes CLI v0.8+：无子命令即交互会话；已无 `--tui`（会 unrecognized arguments）。
    launchCmd: "hermes",
    detectCmd: "hermes",
    expectedProcess: "hermes",
    faviconDomain: "nousresearch.com",
    homepageUrl: "https://hermes-agent.nousresearch.com/docs/",
  },
  {
    id: "openclaw",
    initialPrompt: AGENT_INITIAL_PROMPTS.openclaw,
    label: "OpenClaw",
    launchCmd: "openclaw",
    detectCmd: "openclaw",
    expectedProcess: "openclaw",
    faviconDomain: "openclaw.ai",
    homepageUrl: "https://github.com/openclaw/openclaw",
  },
  {
    id: "devin",
    initialPrompt: AGENT_INITIAL_PROMPTS.devin,
    label: "Devin",
    launchCmd: "devin",
    detectCmd: "devin",
    expectedProcess: "devin",
    faviconDomain: "devin.ai",
    homepageUrl: "https://devin.ai/cli",
  },
  {
    id: "openclaude",
    initialPrompt: AGENT_INITIAL_PROMPTS.openclaude,
    label: "OpenClaude",
    launchCmd: "openclaude",
    detectCmd: "openclaude",
    expectedProcess: "openclaude",
    homepageUrl: "https://openclaude.gitlawb.com/",
    // 图标 favicons/openclaude.png 手动放入（非脚本下载）。
  },
  {
    id: "codebuddy",
    initialPrompt: AGENT_INITIAL_PROMPTS.codebuddy,
    label: "CodeBuddy",
    launchCmd: "codebuddy",
    detectCmd: "codebuddy",
    detectCmdAliases: ["cbc"],
    expectedProcess: "codebuddy",
    homepageUrl: "https://cnb.cool/codebuddy/codebuddy-code",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "qodercli",
    initialPrompt: AGENT_INITIAL_PROMPTS.qodercli,
    label: "Qoder",
    launchCmd: "qodercli",
    detectCmd: "qodercli",
    // 中国版独占 CLI。`qoder` / `qodercn` 是 CLI+IDE 合一启动器，由
    // matchAgentCommand 按 argv 区分，不进词元表（否则 `qoder .` 会开 IDE 却点亮智能体）。
    detectCmdAliases: ["qoderclicn"],
    expectedProcess: "qodercli",
    homepageUrl: "https://qoder.com/cli",
    oneShotArgs: (prompt) => ["-p", prompt],
  },
  {
    id: "fx",
    initialPrompt: AGENT_INITIAL_PROMPTS.fx,
    label: "fx",
    launchCmd: "fx",
    detectCmd: "fx",
    expectedProcess: "fx",
    faviconDomain: "fx.sh",
    homepageUrl: "https://fx.sh/",
    oneShotArgs: (prompt) => ["ask", prompt],
  },
];

const byId = new Map<string, AgentCatalogEntry>(
  AGENT_CATALOG.map((entry) => [entry.id, entry])
);

export function getAgentCatalogEntry(
  id: AgentKind
): AgentCatalogEntry | undefined {
  return byId.get(id);
}

export function getAgentCatalogAliases(
  entry: AgentCatalogEntry
): readonly string[] {
  return [
    entry.label,
    entry.id,
    entry.launchCmd,
    entry.detectCmd,
    ...(entry.detectCmdAliases ?? []),
  ];
}

export function getKnownDetectCommands(): string[] {
  const out = new Set<string>();
  for (const entry of AGENT_CATALOG) {
    out.add(entry.detectCmd);
    for (const alias of entry.detectCmdAliases ?? []) {
      out.add(alias);
    }
  }
  return [...out];
}
