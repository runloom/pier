import type { AgentKind } from "@shared/contracts/agent.ts";
import type { InteractiveBlockingToolCase } from "../interactive-blocking-tools.ts";
import {
  type PierHookCommandV3Spec,
  pierHookCommandV3,
  pierHookCommandV3ShellDispatched,
} from "./command-core.ts";
import type { StdinExtractionOptions } from "./stdin-commands.ts";
import { stdinIdentityExtractionLines } from "./stdin-commands.ts";

export type { StdinExtractionOptions } from "./stdin-commands.ts";

/** shell case 工具名：仅允许标识符，防止注入。 */
const SAFE_INTERACTIVE_TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface StdinPermissionAcceptedThenToolStartSpec
  extends StdinExtractionOptions {
  agentId: AgentKind;
  nativeEvent: string;
}

export interface StdinInteractiveToolDispatchSpec
  extends StdinExtractionOptions {
  agentId: AgentKind;
  nativeEvent: string;
  tools: readonly InteractiveBlockingToolCase[];
}

export type InteractiveToolResolveOutcome =
  | "accepted"
  | "rejected"
  | "cancelled"
  | "failed"
  | "completed"
  | "unknown";

export interface StdinInteractiveToolResolveSpec
  extends StdinInteractiveToolDispatchSpec {
  /** PostToolUse → completed；Failure → failed；Denied → rejected。 */
  interactionOutcome: InteractiveToolResolveOutcome;
}

function assertSafeInteractiveToolNames(
  tools: readonly InteractiveBlockingToolCase[]
): void {
  for (const entry of tools) {
    if (entry.toolNames.length === 0) {
      throw new Error("interactive tool case requires at least one tool name");
    }
    for (const name of entry.toolNames) {
      if (!SAFE_INTERACTIVE_TOOL_NAME.test(name)) {
        throw new Error(`unsafe interactive tool name: ${name}`);
      }
    }
  }
}

/** case 臂只赋值，不嵌 emit；pattern 为 toolNames 的 | 连接。 */
function interactiveToolAssignArms(
  tools: readonly InteractiveBlockingToolCase[],
  assignBody: (kind: InteractiveBlockingToolCase["interactionKind"]) => string
): string {
  assertSafeInteractiveToolNames(tools);
  return tools
    .map((entry) => {
      const pattern = entry.toolNames.join("|");
      return `${pattern}) ${assignBody(entry.interactionKind)} ;;`;
    })
    .join(" ");
}

function stdinCommonPayload(
  spec: StdinExtractionOptions & { agentId: AgentKind; nativeEvent: string }
) {
  return {
    ...(spec.actorHintFromAgentId
      ? { actorHint: "$_pier_actor_hint" as const }
      : {}),
    agentId: spec.agentId,
    agentInstanceId: "$_pier_agent_id",
    agentType: "$_pier_agent_type",
    metadataBase64: "$_pier_metadata_b64",
    nativeEvent: spec.nativeEvent,
    parentSessionId: "$_pier_parent_session_id",
    sessionId: "$_pier_session_id",
    toolName: "$_pier_tool_name",
    toolUseId: "$_pier_tool_use_id",
    transcriptPath: "$_pier_transcript_path",
    turnId: "$_pier_turn_id",
  };
}

/**
 * 一个已获准的原生工具前置事件同时证明两件事：先前权限交互已经接受，
 * 且工具开始执行。stdin 只能消费一次，因此由同一命令按顺序发射两条 v3
 * 事件；共享状态机先解除 waiting，再进入 tool。
 */
export function pierHookCommandV3WithStdinPermissionAcceptedThenToolStart(
  spec: StdinPermissionAcceptedThenToolStartSpec
): string {
  const common = stdinCommonPayload(spec);
  return [
    ...stdinIdentityExtractionLines(spec),
    pierHookCommandV3({
      ...common,
      event: "InteractionResolved",
      interactionId: "$_pier_interaction_id",
      interactionKind: "permission",
      interactionOutcome: "accepted",
    } as unknown as PierHookCommandV3Spec),
    pierHookCommandV3({
      ...common,
      event: "ToolStart",
    } as unknown as PierHookCommandV3Spec),
  ].join("; ");
}

/**
 * PreToolUse：case 只写变量，最后单次 emit。
 * 阻塞等人工具 → InteractionRequested；其余 ToolStart。
 */
export function pierHookCommandV3WithStdinInteractiveToolStart(
  spec: StdinInteractiveToolDispatchSpec
): string {
  const common = stdinCommonPayload(spec);
  const arms = interactiveToolAssignArms(
    spec.tools,
    (kind) =>
      `_pier_event="InteractionRequested"; _pier_interaction_kind="${kind}"; _pier_interaction_id="$_pier_tool_use_id"`
  );
  return [
    ...stdinIdentityExtractionLines(spec),
    '_pier_event="ToolStart"; _pier_interaction_kind=; _pier_interaction_id=',
    `case "$_pier_tool_name" in ${arms} esac`,
    pierHookCommandV3ShellDispatched({
      ...common,
      event: "$_pier_event",
      interactionId: "$_pier_interaction_id",
      interactionKind: "$_pier_interaction_kind",
    }),
  ].join("; ");
}

/**
 * PostToolUse / Failure / Denied：case 只写变量，最后单次 emit。
 * 交互工具 → InteractionResolved（outcome 由调用方固定）；其余 ToolComplete。
 */
export function pierHookCommandV3WithStdinInteractiveToolResolve(
  spec: StdinInteractiveToolResolveSpec
): string {
  const common = stdinCommonPayload(spec);
  const arms = interactiveToolAssignArms(
    spec.tools,
    (kind) =>
      `_pier_event="InteractionResolved"; _pier_interaction_kind="${kind}"; _pier_interaction_id="$_pier_tool_use_id"; _pier_interaction_outcome="${spec.interactionOutcome}"`
  );
  return [
    ...stdinIdentityExtractionLines(spec),
    '_pier_event="ToolComplete"; _pier_interaction_kind=; _pier_interaction_id=; _pier_interaction_outcome=',
    `case "$_pier_tool_name" in ${arms} esac`,
    pierHookCommandV3ShellDispatched({
      ...common,
      event: "$_pier_event",
      interactionId: "$_pier_interaction_id",
      interactionKind: "$_pier_interaction_kind",
      interactionOutcome: "$_pier_interaction_outcome",
    }),
  ].join("; ");
}
