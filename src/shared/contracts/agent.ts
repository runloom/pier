import { z } from "zod";

/** 内置支持的 agent 全集（去 claude-agent-teams——它探测/启动自身 CLI）。 */
export const agentKindSchema = z.enum([
  "claude",
  "codex",
  "gemini",
  "aider",
  "opencode",
  "cursor",
  "copilot",
  "droid",
  "kimi",
  "pi",
  "amp",
  "grok",
  "mimo-code",
  "ante",
  "omp",
  "antigravity",
  "goose",
  "kilo",
  "kiro",
  "crush",
  "aug",
  "autohand",
  "cline",
  "codebuff",
  "command-code",
  "continue",
  "mistral-vibe",
  "qwen-code",
  "rovo",
  "hermes",
  "openclaw",
  "devin",
  "openclaude",
  "codebuddy",
  "qodercli",
]);
export type AgentKind = z.infer<typeof agentKindSchema>;

/** 内置目录项（代码常量，不持久化）。 */
export interface AgentCatalogEntry {
  detectCmd: string;
  detectCmdAliases?: readonly string[];
  expectedProcess: string;
  faviconDomain?: string;
  homepageUrl?: string;
  iconId?: string;
  id: AgentKind;
  label: string;
  launchCmd: string;
  launchCmdByPlatform?: Partial<Record<NodeJS.Platform, string>>;
  /** Headless 一次性调用:append 在 launchCmd/defaultArgs 之后的 argv(含 prompt)。 */
  oneShotArgs?: (prompt: string, context: { cwd: string }) => readonly string[];
}

/** 探测结果（IPC 返回）。 */
export interface DetectAgentsResult {
  addedPathSegments?: string[];
  detectedIds: AgentKind[];
}

/**
 * 每个 agent 的「跳过权限」flag。
 * 多 token flag（如 `--approval-mode yolo`）作为 opaque string——整串写入/比较，勿按空格 split。
 */
export const YOLO_FLAGS: Partial<Record<AgentKind, string>> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  gemini: "--yolo",
  aider: "--yes-always",
  cursor: "--yolo",
  copilot: "--yolo",
  kimi: "--yolo",
  amp: "--dangerously-allow-all",
  grok: "--permission-mode bypassPermissions",
  ante: "--yolo",
  antigravity: "--dangerously-skip-permissions",
  kiro: "--trust-all-tools",
  crush: "--yolo",
  autohand: "--unrestricted",
  cline: "--auto-approve true",
  "command-code": "--yolo",
  continue: '--allow "*"',
  "mistral-vibe": "--agent auto-approve",
  "qwen-code": "--approval-mode yolo",
  rovo: "--yolo",
  hermes: "--yolo",
  devin: "--permission-mode bypass",
  openclaude: "--dangerously-skip-permissions",
  // CodeBuddy Code 是 Claude Code fork,同 flag(--dangerously-skip-permissions,
  // 由 `codebuddy --help` 核定)。
  codebuddy: "--dangerously-skip-permissions",
  // Qoder CLI：`qodercli --yolo`（docs.qoder.com/zh/cli 核定）。
  qodercli: "--yolo",
  // 其余 agent 无 yolo flag：goose 走 YOLO_ENV，opencode/kilo 见 UNSUPPORTED_ARGS。
};

/** env-based yolo（goose 用环境变量而非 flag）。 */
export const YOLO_ENV: Partial<Record<AgentKind, Record<string, string>>> = {
  goose: { GOOSE_MODE: "auto" },
};

/** 交互 TUI 模式不支持跳权限 flag、需在写入时剥除的 agent。 */
export const UNSUPPORTED_ARGS: Partial<Record<AgentKind, readonly string[]>> = {
  opencode: ["--dangerously-skip-permissions"],
  kilo: ["--dangerously-skip-permissions"],
};

export type AgentPermissionMode = "yolo" | "manual" | "mixed";

export type AgentDefaultArgs = Partial<Record<AgentKind, string>>;

export type AgentDefaultEnv = Partial<
  Record<AgentKind, Record<string, string>>
>;

const yoloAgentIds = agentKindSchema.options.filter((id) => id in YOLO_FLAGS);
const yoloEnvAgentIds = agentKindSchema.options.filter((id) => id in YOLO_ENV);

/** 读 agentDefaultArgs + agentDefaultEnv → 汇总成 Yolo/Manual/Mixed（派生，非存储）。 */
export function resolvePermissionMode(
  args: AgentDefaultArgs,
  env: AgentDefaultEnv
): AgentPermissionMode {
  let sawYolo = false;
  let sawManual = false;
  for (const id of yoloAgentIds) {
    const current = args[id]?.trim() ?? "";
    if (current === "") {
      sawManual = true;
    } else if (current === YOLO_FLAGS[id]) {
      sawYolo = true;
    } else {
      return "mixed";
    }
  }
  for (const id of yoloEnvAgentIds) {
    const want = YOLO_ENV[id] ?? {};
    const have = env[id] ?? {};
    const matches = Object.entries(want).every(([k, v]) => have[k] === v);
    const empty = Object.keys(want).every((k) => (have[k] ?? "") === "");
    if (matches) {
      sawYolo = true;
    } else if (empty) {
      sawManual = true;
    } else {
      return "mixed";
    }
  }
  if (sawYolo && sawManual) {
    return "mixed";
  }
  return sawYolo ? "yolo" : "manual";
}

/** flag-based agent 的批量切换（仅动空或标准 yolo 值，用户自定义不动）。 */
function applyFlagMode(
  mode: "yolo" | "manual",
  args: AgentDefaultArgs
): AgentDefaultArgs {
  const next: AgentDefaultArgs = { ...args };
  for (const id of yoloAgentIds) {
    const flag = YOLO_FLAGS[id];
    if (flag === undefined) {
      continue;
    }
    const current = next[id]?.trim() ?? "";
    if (current !== "" && current !== flag) {
      continue; // 用户自定义，保留
    }
    if (mode === "yolo") {
      next[id] = flag;
    } else {
      delete next[id];
    }
  }
  return next;
}

/** env-based agent（goose）的批量切换（仅动空或标准 yolo env，用户自定义不动）。 */
function applyEnvMode(
  mode: "yolo" | "manual",
  env: AgentDefaultEnv
): AgentDefaultEnv {
  const next: AgentDefaultEnv = { ...env };
  for (const id of yoloEnvAgentIds) {
    const want = YOLO_ENV[id] ?? {};
    const have = { ...(next[id] ?? {}) };
    const stdOrEmpty = Object.entries(want).every(
      ([k, v]) => (have[k] ?? "") === "" || have[k] === v
    );
    if (!stdOrEmpty) {
      continue; // 用户自定义，保留
    }
    if (mode === "yolo") {
      next[id] = { ...have, ...want };
    } else {
      for (const k of Object.keys(want)) {
        delete have[k];
      }
      if (Object.keys(have).length === 0) {
        delete next[id];
      } else {
        next[id] = have;
      }
    }
  }
  return next;
}

/** 批量切换。仅动「空或正好是标准 yolo 值」的项，用户自定义保持不动。返回新的 args + env。 */
export function applyPermissionMode(
  mode: "yolo" | "manual",
  args: AgentDefaultArgs,
  env: AgentDefaultEnv
): { args: AgentDefaultArgs; env: AgentDefaultEnv } {
  return { args: applyFlagMode(mode, args), env: applyEnvMode(mode, env) };
}
