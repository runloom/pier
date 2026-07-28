import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME,
  EXTRACT_STDIN_META_SCRIPT_NAME,
} from "../agent-hooks-install.ts";
import {
  PIER_AGENT_HOOKS_DIR_MARK,
  PIER_HOOK_GEN_MARK,
  pierHookCommand,
} from "./hook-command-core.ts";

/**
 * sed 从 payload 抽 string 字段：先 snake 再 camel，取首个命中。
 * 键名与 agent-hooks-install `buildExtractStdinMetaScript` 必须同步。
 */
function sedExtractJsonStringField(snakeKey: string, camelKey: string): string {
  return (
    `sed -n 's/.*"${snakeKey}"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p; ` +
    `s/.*"${camelKey}"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1`
  );
}

/**
 * stdin 身份提取前奏（各 stdin 系构造器共用）。
 *
 * 只走 `${PIER_AGENT_HOOKS_DIR}/extract-stdin-meta`（PTY 注入，默认
 * `~/.pier/hooks/current` 共享运行时）。**禁止**在全局 hooks 命令里嵌
 * `process.execPath`：多 worktree 互盖会改写 Codex `trusted_hash`。
 * 脚本缺失时 metadata 为空（`|| true`），不阻断 agent。
 */
function stdinIdentityExtractionLines(): string[] {
  const extractMeta = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/${EXTRACT_STDIN_META_SCRIPT_NAME}`;
  return [
    `_pier_hook_gen=${PIER_HOOK_GEN_MARK}`,
    "_pier_payload=$(cat 2>/dev/null | head -c 65536)",
    `_pier_metadata_b64=$(printf '%s' "$_pier_payload" | { if [ -x "${extractMeta}" ]; then "${extractMeta}"; fi; } 2>/dev/null || true)`,
    `_pier_session_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("session_id", "sessionId")})`,
    `_pier_turn_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("turn_id", "turnId")})`,
    `_pier_tool_use_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("tool_use_id", "toolUseId")})`,
    `_pier_tool_name=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("tool_name", "toolName")})`,
    `_pier_agent_id=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("agent_id", "agentId")})`,
    `_pier_agent_type=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("agent_type", "agentType")})`,
    `_pier_transcript_path=$(printf '%s' "$_pier_payload" | ${sedExtractJsonStringField("transcript_path", "transcriptPath")})`,
  ];
}

const STDIN_IDENTITY_PAYLOAD_ARGS = [
  "$_pier_session_id",
  "$_pier_turn_id",
  "$_pier_tool_use_id",
  "$_pier_tool_name",
  "$_pier_agent_id",
  "$_pier_agent_type",
  "$_pier_transcript_path",
  "$_pier_metadata_b64",
] as const;

export function pierHookCommandWithStdinSessionId(
  agentId: AgentKind,
  pierEvent: string,
  nativeEvent: string = pierEvent
): string {
  return [
    ...stdinIdentityExtractionLines(),
    pierHookCommand(
      agentId,
      pierEvent,
      nativeEvent,
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
  ].join("; ");
}

/**
 * Claude UserPromptSubmit：emit 之后向 stdout 回写 hookSpecificOutput.sessionTitle，
 * 让 Claude 自己的会话列表也有个像样的名字。
 *
 * **这是对第三方 UI 的顺带写入，不是 Pier 标题的真源**——Pier 的 tab 走 FA。
 * 因此这里只做「剥标记 + 挡寒暄 + 硬截断」这个便宜子集，**不复刻**规则层的
 * 首句/前缀/名词化流水线。实现落在共享运行时
 * `derive-claude-session-title`（`~/.pier/hooks/vN`，启动时只前进安装）；
 * 全局 hooks 命令只引用 `${PIER_AGENT_HOOKS_DIR}/…`，不嵌 Electron 绝对路径。
 */
export function pierClaudeUserPromptSubmitCommand(agentId: AgentKind): string {
  const deriveScript = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/${DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME}`;
  return [
    ...stdinIdentityExtractionLines(),
    pierHookCommand(
      agentId,
      "PromptSubmit",
      "UserPromptSubmit",
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
    `printf '%s' "$_pier_payload" | { if [ -x "${deriveScript}" ]; then "${deriveScript}"; fi; } 2>/dev/null || true`,
  ].join("; ");
}

export interface StdinStatusDispatchCase {
  /** stdin payload 顶层 `status` 字段的原生取值。 */
  nativeStatus: string;
  /** 命中该取值时上报的 pier 规范事件名。 */
  pierEvent: string;
}

/**
 * 按 stdin payload 的 `status` 字段在安装期命令内分发 pier 事件名
 * （事件映射仍在安装时完成——mapping 逻辑写进 hook 命令本身, 接收端保持
 * agent 无关）。未命中任何 case 或 payload 无 status 时回落 fallbackPierEvent,
 * 由集成的 stopAuthority 语义兜底——provider 未来改 payload 只会退化为
 * 现状, 不会伪造终态。
 */
export function pierHookCommandWithStdinStatusDispatch(
  agentId: AgentKind,
  fallbackPierEvent: string,
  nativeEvent: string,
  cases: readonly StdinStatusDispatchCase[]
): string {
  const arms = cases
    .map(
      (entry) => `${entry.nativeStatus}) _pier_event="${entry.pierEvent}" ;;`
    )
    .concat(`*) _pier_event="${fallbackPierEvent}" ;;`)
    .join(" ");
  return [
    ...stdinIdentityExtractionLines(),
    `_pier_status=$(printf '%s' "$_pier_payload" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n 1)`,
    `case "$_pier_status" in ${arms} esac`,
    pierHookCommand(
      agentId,
      "$_pier_event",
      nativeEvent,
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
  ].join("; ");
}
