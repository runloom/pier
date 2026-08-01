import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type PierHookCommandV3Spec,
  pierHookCommandV3,
} from "./command-core.ts";
import {
  type StdinExtractionOptions,
  stdinIdentityExtractionLines,
} from "./stdin-commands.ts";

interface StdinPermissionAcceptedThenToolStartSpec
  extends StdinExtractionOptions {
  agentId: AgentKind;
  nativeEvent: string;
}

/**
 * 一个已获准的原生工具前置事件同时证明两件事：先前权限交互已经接受，
 * 且工具开始执行。stdin 只能消费一次，因此由同一命令按顺序发射两条 v3
 * 事件；共享状态机先解除 waiting，再进入 tool。
 */
export function pierHookCommandV3WithStdinPermissionAcceptedThenToolStart(
  spec: StdinPermissionAcceptedThenToolStartSpec
): string {
  const common = {
    ...(spec.actorHintFromAgentId ? { actorHint: "$_pier_actor_hint" } : {}),
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
