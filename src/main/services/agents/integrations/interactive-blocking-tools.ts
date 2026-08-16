/**
 * 阻塞等人工具 catalog + lifecycle 接线。
 *
 * 领域类型与工具名单归本文件；hook 命令构造见 hooks/stdin-sequences.ts。
 * interactionKind 槽位复用契约枚举：plan 审批门用 `permission`（用户批准后
 * 才继续），问卷用 `question`。不是「整类 PermissionRequest 事件」。
 */

/** plan 审批 / 问卷等阻塞工具 → Interaction* 映射条目。 */
export interface InteractiveBlockingToolCase {
  /**
   * `permission`：审批门（enter/exit plan 等）。
   * `question`：问卷/澄清。
   * `external-block`：外部阻塞（预留）。
   */
  interactionKind: "permission" | "question" | "external-block";
  /** 精确工具名（可多别名）；须全部为 shell 安全标识符。 */
  toolNames: readonly string[];
}

/**
 * Claude Code / OpenClaude 同构阻塞等人工具。
 *
 * 依据：
 * - 官方 plan 模式：https://code.claude.com/docs/en/permission-modes
 * - 官方 hooks：https://code.claude.com/docs/en/hooks
 * - OpenClaude 源码（工具名 + ExitPlanMode 需用户确认）：
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/ExitPlanModeTool/constants.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/EnterPlanModeTool/constants.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/AskUserQuestionTool/prompt.ts
 *   https://github.com/Gitlawb/openclaude/blob/main/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts
 */
export const CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS = [
  {
    interactionKind: "permission",
    toolNames: ["EnterPlanMode", "ExitPlanMode"],
  },
  {
    interactionKind: "question",
    toolNames: ["AskUserQuestion"],
  },
] as const satisfies readonly InteractiveBlockingToolCase[];

/**
 * Grok Build 阻塞等人工具。
 *
 * 依据（本机 `~/.grok/docs` + https://x.ai/cli）：
 * - Plan：user-guide/19-plan-mode.md — enter/exit_plan_mode
 * - 问卷：hook Post 可能在 UI 画出时就响，waiting 只走 updates.jsonl
 */
export const GROK_INTERACTIVE_BLOCKING_TOOLS = [
  {
    interactionKind: "permission",
    toolNames: ["enter_plan_mode", "exit_plan_mode"],
  },
] as const satisfies readonly InteractiveBlockingToolCase[];
