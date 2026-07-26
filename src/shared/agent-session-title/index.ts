/**
 * Agent 会话标题——纯函数层唯一对外入口。
 *
 * 三层收敛：占位 → 规则派生(T1) → 模型精修(T2) → 冻结（仅用户改名可再动）。
 * 写入裁决见 precedence.ts；main 侧编排见 services/agents/session-title/。
 */

export type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
export {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
  MAX_REFINE_CHANGED_FILES,
  MAX_REFINE_PROMPT_CHARS,
  TARGET_AUTO_TITLE_LENGTH,
} from "./constants.ts";
export { deriveAgentSessionTitleFromPrompt } from "./derive.ts";
export {
  GREETING_ONLY_SOURCE,
  isNoiseTitleInput,
  TRIVIAL_TITLE_SOURCE,
} from "./noise.ts";
export {
  normalizeAgentSessionTitle,
  truncateTerminalTitleForTooltip,
} from "./normalize.ts";
export {
  type AgentSessionTitleWriteDecision,
  agentSessionTitleRank,
  decideAgentSessionTitleWrite,
  normalizeAgentSessionTitleSource,
} from "./precedence.ts";
export {
  agentSessionTitleInput,
  type ResolveAgentSessionTitleInput,
  type ResolvedAgentSessionTitle,
  resolveAgentSessionTitle,
} from "./resolve.ts";
export { titleChangedFileNames } from "./signals.ts";
export { stripAgentPromptMarkup } from "./strip.ts";
