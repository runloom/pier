import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME,
  EXTRACT_STDIN_META_SCRIPT_NAME,
} from "../../hooks-install.ts";
import {
  PIER_AGENT_HOOKS_DIR_MARK,
  PIER_HOOK_GEN_MARK,
  type PierHookCommandV3Spec,
  pierHookCommand,
  pierHookCommandV3,
} from "./command-core.ts";

const SAFE_STDIN_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface StdinExtractionOptions {
  actorHintFromAgentId?: boolean;
  agentInstanceIdFields?: readonly string[];
  agentTypeFields?: readonly string[];
  interactionIdFields?: readonly string[];
  nativeStateFields?: readonly string[];
  nativeStatePaths?: readonly string[];
  parentSessionIdFields?: readonly string[];
  sessionIdAsParent?: boolean;
  suppressTurnId?: boolean;
  toolNamePaths?: readonly string[];
  toolUseIdPaths?: readonly string[];
  turnIdFields?: readonly string[];
}

function stdinFieldArgument(fields: readonly string[] | undefined): string {
  return (fields ?? [])
    .filter((field) => SAFE_STDIN_FIELD_NAME.test(field))
    .join(",");
}

function stdinPathArgument(paths: readonly string[] | undefined): string {
  return (paths ?? [])
    .filter((path) =>
      path.split(".").every((field) => SAFE_STDIN_FIELD_NAME.test(field))
    )
    .join(",");
}

/**
 * stdin 身份提取前奏（各 stdin 系构造器共用）。
 *
 * 只走 `${PIER_AGENT_HOOKS_DIR}/extract-stdin-meta`（PTY 注入，默认
 * `~/.pier/hooks/current` 共享运行时）。**禁止**在全局 hooks 命令里嵌
 * `process.execPath`：多 worktree 互盖会改写 Codex `trusted_hash`。
 * 脚本缺失或坏 payload 时全部提取字段为空（`|| true`），不阻断 agent。
 */
export function stdinIdentityExtractionLines(
  options: StdinExtractionOptions = {}
): string[] {
  const extractMeta = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/${EXTRACT_STDIN_META_SCRIPT_NAME}`;
  const interactionFields = stdinFieldArgument(options.interactionIdFields);
  const nativeStateFields = stdinFieldArgument(options.nativeStateFields);
  const turnIdFields = stdinFieldArgument(options.turnIdFields);
  const nativeStatePaths = stdinPathArgument(options.nativeStatePaths);
  const agentInstanceIdFields = stdinFieldArgument(
    options.agentInstanceIdFields
  );
  const parentSessionIdFields = stdinFieldArgument(
    options.parentSessionIdFields
  );
  const agentTypeFields = stdinFieldArgument(options.agentTypeFields);
  const toolUseIdPaths = stdinPathArgument(options.toolUseIdPaths);
  const toolNamePaths = stdinPathArgument(options.toolNamePaths);
  return [
    `_pier_hook_gen=${PIER_HOOK_GEN_MARK}`,
    "_pier_payload=$(cat 2>/dev/null)",
    "_pier_metadata_b64=; _pier_session_id=; _pier_turn_id=; _pier_tool_use_id=; _pier_tool_name=",
    "_pier_agent_id=; _pier_agent_type=; _pier_transcript_path=; _pier_parent_session_id=",
    "_pier_native_state=; _pier_interaction_id=; _pier_actor_hint=",
    `_pier_extracted_fields=$(printf '%s' "$_pier_payload" | { if [ -x "${extractMeta}" ]; then "${extractMeta}" --shell-fields "${interactionFields}" "${nativeStateFields}" "${turnIdFields}" "${nativeStatePaths}" "${agentInstanceIdFields}" "${parentSessionIdFields}" "${agentTypeFields}" "${toolUseIdPaths}" "${toolNamePaths}"; fi; } 2>/dev/null || true)`,
    'eval "$_pier_extracted_fields" 2>/dev/null || true',
    ...(options.sessionIdAsParent
      ? [
          '[ -n "$_pier_session_id" ] && [ -z "$_pier_parent_session_id" ] && _pier_parent_session_id="$_pier_session_id"',
          "_pier_session_id=",
        ]
      : []),
    ...(options.suppressTurnId ? ["_pier_turn_id="] : []),
    ...(options.actorHintFromAgentId
      ? ['[ -n "$_pier_agent_id" ] && _pier_actor_hint=subagent']
      : []),
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

type StdinManagedV3Field =
  | "agentInstanceId"
  | "agentType"
  | "interactionId"
  | "metadataBase64"
  | "nativeState"
  | "parentSessionId"
  | "promptSnippet"
  | "sessionId"
  | "toolName"
  | "toolUseId"
  | "transcriptPath"
  | "turnId";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never;

type PierHookCommandV3WithStdinBase = DistributiveOmit<
  PierHookCommandV3Spec,
  StdinManagedV3Field
>;

export type PierHookCommandV3WithStdinSpec =
  PierHookCommandV3WithStdinBase extends infer Spec
    ? Spec extends {
        event: "InteractionRequested" | "InteractionResolved";
      }
      ? Spec & StdinExtractionOptions
      : Spec & {
          actorHintFromAgentId?: boolean;
          agentInstanceIdFields?: readonly string[];
          agentTypeFields?: readonly string[];
          interactionIdFields?: never;
          nativeStateFields?: readonly string[];
          nativeStatePaths?: readonly string[];
          parentSessionIdFields?: readonly string[];
          sessionIdAsParent?: boolean;
          suppressTurnId?: boolean;
          toolNamePaths?: readonly string[];
          toolUseIdPaths?: readonly string[];
          turnIdFields?: readonly string[];
        }
    : never;

/**
 * 构造读取 stdin 顶层字段的新 v3 命令。
 *
 * 会话、工具和父会话只消费共享审计过的别名；`interactionId` 没有默认
 * 来源，调用方必须为该原生事件显式给出 `interactionIdFields`。
 */
export function pierHookCommandV3WithStdin(
  spec: PierHookCommandV3WithStdinSpec
): string {
  const {
    actorHintFromAgentId,
    agentInstanceIdFields,
    agentTypeFields,
    interactionIdFields,
    nativeStateFields,
    nativeStatePaths,
    parentSessionIdFields,
    sessionIdAsParent,
    suppressTurnId,
    toolNamePaths,
    toolUseIdPaths,
    turnIdFields,
    ...commandSpec
  } = spec;
  return [
    ...stdinIdentityExtractionLines({
      ...(actorHintFromAgentId ? { actorHintFromAgentId } : {}),
      ...(agentInstanceIdFields ? { agentInstanceIdFields } : {}),
      ...(agentTypeFields ? { agentTypeFields } : {}),
      ...(interactionIdFields ? { interactionIdFields } : {}),
      ...(nativeStateFields ? { nativeStateFields } : {}),
      ...(nativeStatePaths ? { nativeStatePaths } : {}),
      ...(parentSessionIdFields ? { parentSessionIdFields } : {}),
      ...(sessionIdAsParent ? { sessionIdAsParent } : {}),
      ...(suppressTurnId ? { suppressTurnId } : {}),
      ...(toolNamePaths ? { toolNamePaths } : {}),
      ...(toolUseIdPaths ? { toolUseIdPaths } : {}),
      ...(turnIdFields ? { turnIdFields } : {}),
    }),
    pierHookCommandV3({
      ...commandSpec,
      ...(actorHintFromAgentId ? { actorHint: "$_pier_actor_hint" } : {}),
      agentInstanceId: "$_pier_agent_id",
      agentType: "$_pier_agent_type",
      ...(commandSpec.event === "InteractionRequested" ||
      commandSpec.event === "InteractionResolved"
        ? { interactionId: "$_pier_interaction_id" }
        : {}),
      metadataBase64: "$_pier_metadata_b64",
      nativeState: "$_pier_native_state",
      parentSessionId: "$_pier_parent_session_id",
      sessionId: "$_pier_session_id",
      toolName: "$_pier_tool_name",
      toolUseId: "$_pier_tool_use_id",
      transcriptPath: "$_pier_transcript_path",
      turnId: "$_pier_turn_id",
    } as unknown as PierHookCommandV3Spec),
  ].join("; ");
}

export interface StdinInteractionOutcomeDispatchCase {
  interactionOutcome:
    | "accepted"
    | "rejected"
    | "cancelled"
    | "failed"
    | "completed"
    | "unknown";
  nativeValue: string;
}

type InteractionResolvedStdinSpec = Extract<
  PierHookCommandV3WithStdinSpec,
  { event: "InteractionResolved" }
>;

/**
 * 把 provider 明示的交互结果字段在 hook 命令内归一化。
 *
 * 这里只做安装期声明的值映射；共享状态机仍不识别 provider 或 toolName。
 * 未知新值保守落为 unknown，并将原值保存在 nativeState。
 */
export function pierHookCommandV3WithStdinOutcomeDispatch(
  spec: Omit<InteractionResolvedStdinSpec, "interactionOutcome">,
  cases: readonly StdinInteractionOutcomeDispatchCase[]
): string {
  const {
    actorHintFromAgentId,
    agentInstanceIdFields,
    agentTypeFields,
    interactionIdFields,
    nativeStateFields,
    nativeStatePaths,
    parentSessionIdFields,
    toolNamePaths,
    toolUseIdPaths,
    turnIdFields,
    ...commandSpec
  } = spec;
  const arms = cases
    .map(
      (entry) =>
        `${entry.nativeValue}) _pier_interaction_outcome="${entry.interactionOutcome}" ;;`
    )
    .concat('*) _pier_interaction_outcome="unknown" ;;')
    .join(" ");
  return [
    ...stdinIdentityExtractionLines({
      ...(actorHintFromAgentId ? { actorHintFromAgentId } : {}),
      ...(agentInstanceIdFields ? { agentInstanceIdFields } : {}),
      ...(agentTypeFields ? { agentTypeFields } : {}),
      ...(interactionIdFields ? { interactionIdFields } : {}),
      ...(nativeStateFields ? { nativeStateFields } : {}),
      ...(nativeStatePaths ? { nativeStatePaths } : {}),
      ...(parentSessionIdFields ? { parentSessionIdFields } : {}),
      ...(toolNamePaths ? { toolNamePaths } : {}),
      ...(toolUseIdPaths ? { toolUseIdPaths } : {}),
      ...(turnIdFields ? { turnIdFields } : {}),
    }),
    `case "$_pier_native_state" in ${arms} esac`,
    pierHookCommandV3({
      ...commandSpec,
      ...(actorHintFromAgentId ? { actorHint: "$_pier_actor_hint" } : {}),
      agentInstanceId: "$_pier_agent_id",
      agentType: "$_pier_agent_type",
      interactionId: "$_pier_interaction_id",
      interactionOutcome: "$_pier_interaction_outcome",
      metadataBase64: "$_pier_metadata_b64",
      nativeState: "$_pier_native_state",
      parentSessionId: "$_pier_parent_session_id",
      sessionId: "$_pier_session_id",
      toolName: "$_pier_tool_name",
      toolUseId: "$_pier_tool_use_id",
      transcriptPath: "$_pier_transcript_path",
      turnId: "$_pier_turn_id",
    } as unknown as PierHookCommandV3Spec),
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

/** Claude 专属 sessionTitle 双写的严格 v3 版本。 */
export function pierClaudeUserPromptSubmitCommandV3(
  agentId: AgentKind
): string {
  const deriveScript = `\${${PIER_AGENT_HOOKS_DIR_MARK}}/${DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME}`;
  return [
    ...stdinIdentityExtractionLines({
      actorHintFromAgentId: true,
      turnIdFields: ["prompt_id"],
    }),
    pierHookCommandV3({
      actorHint: "$_pier_actor_hint",
      agentId,
      agentInstanceId: "$_pier_agent_id",
      agentType: "$_pier_agent_type",
      event: "PromptSubmit",
      metadataBase64: "$_pier_metadata_b64",
      nativeEvent: "UserPromptSubmit",
      parentSessionId: "$_pier_parent_session_id",
      sessionId: "$_pier_session_id",
      toolName: "$_pier_tool_name",
      toolUseId: "$_pier_tool_use_id",
      transcriptPath: "$_pier_transcript_path",
      turnId: "$_pier_turn_id",
    } as unknown as PierHookCommandV3Spec),
    `printf '%s' "$_pier_payload" | { if [ -x "${deriveScript}" ]; then "${deriveScript}"; fi; } 2>/dev/null || true`,
  ].join("; ");
}

export interface StdinStatusDispatchCase {
  /** stdin payload 顶层 `status` 字段的原生取值。 */
  nativeStatus: string;
  /** 命中该取值时上报的 pier 规范事件名。 */
  pierEvent: string;
}

export interface StdinValueDispatchCase {
  /** stdin payload 字段或路径的原生标量取值。 */
  nativeValue: string;
  /** 命中该取值时上报的 pier 规范事件名。 */
  pierEvent: string;
}

export interface StdinV3ValueDispatchSpec extends StdinExtractionOptions {
  agentId: AgentKind;
  cases: readonly StdinValueDispatchCase[];
  fallbackPierEvent: string;
  nativeEvent: string;
}

/**
 * 按调用方声明的 stdin 标量字段分发严格 v3 事件。
 *
 * 分支固化在安装命令；共享接收端仍只处理规范事件，不识别 provider。
 */
export function pierHookCommandV3WithStdinValueDispatch(
  spec: StdinV3ValueDispatchSpec
): string {
  const arms = spec.cases
    .map((entry) => `${entry.nativeValue}) _pier_event="${entry.pierEvent}" ;;`)
    .concat(`*) _pier_event="${spec.fallbackPierEvent}" ;;`)
    .join(" ");
  return [
    ...stdinIdentityExtractionLines({
      ...(spec.actorHintFromAgentId
        ? { actorHintFromAgentId: spec.actorHintFromAgentId }
        : {}),
      ...(spec.agentInstanceIdFields
        ? { agentInstanceIdFields: spec.agentInstanceIdFields }
        : {}),
      ...(spec.agentTypeFields
        ? { agentTypeFields: spec.agentTypeFields }
        : {}),
      ...(spec.nativeStateFields
        ? { nativeStateFields: spec.nativeStateFields }
        : {}),
      ...(spec.nativeStatePaths
        ? { nativeStatePaths: spec.nativeStatePaths }
        : {}),
      ...(spec.parentSessionIdFields
        ? { parentSessionIdFields: spec.parentSessionIdFields }
        : {}),
      ...(spec.toolNamePaths ? { toolNamePaths: spec.toolNamePaths } : {}),
      ...(spec.toolUseIdPaths ? { toolUseIdPaths: spec.toolUseIdPaths } : {}),
      ...(spec.turnIdFields ? { turnIdFields: spec.turnIdFields } : {}),
    }),
    `case "$_pier_native_state" in ${arms} esac`,
    pierHookCommandV3({
      ...(spec.actorHintFromAgentId ? { actorHint: "$_pier_actor_hint" } : {}),
      agentId: spec.agentId,
      agentInstanceId: "$_pier_agent_id",
      agentType: "$_pier_agent_type",
      event: "$_pier_event",
      metadataBase64: "$_pier_metadata_b64",
      nativeEvent: spec.nativeEvent,
      nativeState: "$_pier_native_state",
      parentSessionId: "$_pier_parent_session_id",
      sessionId: "$_pier_session_id",
      toolName: "$_pier_tool_name",
      toolUseId: "$_pier_tool_use_id",
      transcriptPath: "$_pier_transcript_path",
      turnId: "$_pier_turn_id",
    } as unknown as PierHookCommandV3Spec),
  ].join("; ");
}

export interface StdinV3StatusDispatchSpec extends StdinExtractionOptions {
  agentId: AgentKind;
  cases: readonly StdinStatusDispatchCase[];
  fallbackPierEvent: string;
  nativeEvent: string;
}

/** v3 版 status 分发；provider 分支仍固化在安装命令，不进入共享状态机。 */
export function pierHookCommandV3WithStdinStatusDispatch(
  spec: StdinV3StatusDispatchSpec
): string {
  return pierHookCommandV3WithStdinValueDispatch({
    ...spec,
    cases: spec.cases.map((entry) => ({
      nativeValue: entry.nativeStatus,
      pierEvent: entry.pierEvent,
    })),
    nativeStateFields: ["status"],
  });
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
    ...stdinIdentityExtractionLines({ nativeStateFields: ["status"] }),
    `case "$_pier_native_state" in ${arms} esac`,
    pierHookCommand(
      agentId,
      "$_pier_event",
      nativeEvent,
      ...STDIN_IDENTITY_PAYLOAD_ARGS
    ),
  ].join("; ");
}
