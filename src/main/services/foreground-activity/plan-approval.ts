/**
 * Plan 审批门：provider 可能丢掉 Post。再次出示、后续普通 ToolStart，
 * 或具名非 plan 交互会结算未闭环条目。不要把普通权限/问卷加进此表。
 */
export const PLAN_APPROVAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "EnterPlanMode",
  "ExitPlanMode",
  "enter_plan_mode",
  "exit_plan_mode",
  "CreatePlan",
  "SwitchMode",
]);

/**
 * 各家阻塞问卷/权限工具名（文档与测试用）。
 * 聚合器不得凭 ToolStart 把这些名字升成 waiting：Gemini ask_user 的
 * AfterTool 在拒绝/取消时可以不来，CodeIsland / Open Island 也不这样升。
 * waiting 只来自具名 InteractionRequested 或 transcript / 视口对账。
 */
export const QUESTION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "AskUserQuestion",
  "ask_user_question",
  "AskQuestion",
  "ask_question",
  "ask_user",
  "ask",
  "clarify",
  "request_user_input",
  "request_permissions",
]);

export function isPlanApprovalToolName(toolName: string | undefined): boolean {
  return Boolean(toolName && PLAN_APPROVAL_TOOL_NAMES.has(toolName));
}

export function isQuestionToolName(toolName: string | undefined): boolean {
  return Boolean(toolName && QUESTION_TOOL_NAMES.has(toolName));
}

export function isInteractiveBlockingToolName(
  toolName: string | undefined
): boolean {
  return isPlanApprovalToolName(toolName) || isQuestionToolName(toolName);
}
