import { z } from "zod";

/** 起步支持子集（可增量扩展）。★ = 有 orca 内联高质量图标。 */
export const agentKindSchema = z.enum([
  "claude", // ★
  "codex", // ★
  "gemini",
  "aider", // ★
  "opencode",
  "cursor",
  "copilot", // ★
  "droid", // ★
  "kimi",
  "pi", // ★
  "amp",
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
}

/** 探测结果（IPC 返回）。 */
export interface DetectAgentsResult {
  addedPathSegments?: string[];
  detectedIds: AgentKind[];
}

/** 每个 agent 的「跳过权限」flag（照搬 orca tui-agent-permissions.ts）。 */
export const YOLO_FLAGS: Partial<Record<AgentKind, string>> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  gemini: "--yolo",
  aider: "--yes-always",
  cursor: "--yolo",
  copilot: "--yolo",
  kimi: "--yolo",
  amp: "--dangerously-allow-all",
  // opencode / droid / pi: 无 yolo flag，保持 CLI 默认
};

/** 交互 TUI 模式不支持跳权限 flag、需在写入时剥除的 agent。 */
export const UNSUPPORTED_ARGS: Partial<Record<AgentKind, readonly string[]>> = {
  opencode: ["--dangerously-skip-permissions"],
};

export type AgentPermissionMode = "yolo" | "manual" | "mixed";

export type AgentDefaultArgs = Partial<Record<AgentKind, string>>;

const yoloAgentIds = agentKindSchema.options.filter((id) => id in YOLO_FLAGS);

/** 读 agentDefaultArgs → 汇总成 Yolo/Manual/Mixed（派生，非存储）。 */
export function resolvePermissionMode(
  args: AgentDefaultArgs
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
  if (sawYolo && sawManual) {
    return "mixed";
  }
  return sawYolo ? "yolo" : "manual";
}

/** 批量切换。仅动「空或正好是标准 yolo 值」的项，用户自定义保持不动。 */
export function applyPermissionMode(
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
