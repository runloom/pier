/**
 * Agent 产品会话名——纯函数层唯一对外入口。
 *
 * 终端 tab 标题不在此层：OSC 0/2 → cwd（terminalPanelDescriptor）。
 * 产品 sessionTitle 仅 provider（agent 自命名）与 user（改名）。
 * 无启发式、无模型精修、无 prompt 派生。
 */

export type { AgentSessionTitleSource } from "../contracts/foreground-activity.ts";
export {
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_AGENT_TERMINAL_TITLE_TOOLTIP_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "./constants.ts";
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
export { agentSessionTitleValueSchema } from "./schema.ts";
export {
  firstAgentPromptLine,
  stripAgentPromptMarkup,
  unwrapAgentPromptMarkup,
} from "./strip.ts";
