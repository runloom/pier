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
  /**
   * 子智能体派发工具（如 Cursor `Task`）：Pre → SubagentStart，
   * Post/Failure → SubagentStop。会话号转挂 parentSessionId 并抑制
   * turnId——派发工具的 generation 属于子智能体，不得抢占主回合身份。
   */
  subagentDispatchTools?: readonly string[];
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

/**
 * 子智能体派发工具臂：事件改写为 Subagent 生命周期，主会话号转挂
 * parentSessionId（对齐原生 subagentStart 的 sessionIdAsParent），并清空
 * turnId——它是子智能体的 generation，进入主 scope 会触发外来回合抢占。
 */
function subagentDispatchAssignArms(
  toolNames: readonly string[],
  subagentEvent: "SubagentStart" | "SubagentStop"
): string {
  if (toolNames.length === 0) {
    return "";
  }
  assertSafeInteractiveToolNames([
    { interactionKind: "external-block", toolNames },
  ]);
  const pattern = toolNames.join("|");
  return (
    `${pattern}) _pier_event="${subagentEvent}"; ` +
    '_pier_parent_session_id="$_pier_session_id"; _pier_session_id=; ' +
    "_pier_turn_id= ;;"
  );
}

function assertSubagentToolsDisjointFromInteractive(
  tools: readonly InteractiveBlockingToolCase[],
  subagentTools: readonly string[]
): void {
  const interactive = new Set(tools.flatMap((entry) => entry.toolNames));
  for (const name of subagentTools) {
    if (interactive.has(name)) {
      throw new Error(
        `subagent dispatch tool also listed as interactive: ${name}`
      );
    }
  }
}

function joinCaseArms(...arms: string[]): string {
  return arms.filter((arm) => arm.length > 0).join(" ");
}

function stdinCommonPayload(
  spec: StdinExtractionOptions & { agentId: AgentKind; nativeEvent: string }
) {
  return {
    ...(spec.actorHintFromAgentId || spec.actorHintFromAgentType
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
  assertSubagentToolsDisjointFromInteractive(
    spec.tools,
    spec.subagentDispatchTools ?? []
  );
  const common = stdinCommonPayload(spec);
  const arms = joinCaseArms(
    interactiveToolAssignArms(
      spec.tools,
      (kind) =>
        `_pier_event="InteractionRequested"; _pier_interaction_kind="${kind}"; _pier_interaction_id="$_pier_tool_use_id"`
    ),
    subagentDispatchAssignArms(
      spec.subagentDispatchTools ?? [],
      "SubagentStart"
    )
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
  assertSubagentToolsDisjointFromInteractive(
    spec.tools,
    spec.subagentDispatchTools ?? []
  );
  const common = stdinCommonPayload(spec);
  const arms = joinCaseArms(
    interactiveToolAssignArms(
      spec.tools,
      (kind) =>
        `_pier_event="InteractionResolved"; _pier_interaction_kind="${kind}"; _pier_interaction_id="$_pier_tool_use_id"; _pier_interaction_outcome="${spec.interactionOutcome}"`
    ),
    subagentDispatchAssignArms(spec.subagentDispatchTools ?? [], "SubagentStop")
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
