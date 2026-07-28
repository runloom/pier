/**
 * Agent 会话标题——纯函数层唯一对外入口。
 *
 * 三层收敛：占位 → 首条 prompt 确定性派生(prompt) → agent 自己的会话名
 * (provider) → 用户改名(user)。
 * 没有启发式改写层，也没有模型精修层：标题只是可读性信号，身份由
 * agentId + 项目路径 + panelId + actorHint 承担。
 * 写入裁决见 precedence.ts；main 侧编排见 services/agents/session-title/。
 */

export type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
export {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "./constants.ts";
export { deriveAgentSessionTitleFromPrompt } from "./derive.ts";
export {
  type AgentSessionTitleDisambiguationEntry,
  disambiguateAgentSessionTitles,
} from "./disambiguate.ts";
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
export {
  firstAgentPromptLine,
  stripAgentPromptMarkup,
  unwrapAgentPromptMarkup,
} from "./strip.ts";
