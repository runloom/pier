import type { StdinExtractionOptions } from "./hooks/stdin-sequences.ts";
import {
  pierHookCommandV3WithStdinInteractiveToolResolve,
  pierHookCommandV3WithStdinInteractiveToolStart,
} from "./hooks/stdin-sequences.ts";
import type { InteractiveBlockingToolCase } from "./interactive-blocking-tools.ts";
import type { NestedHookEventSpec } from "./shared.ts";

export interface InteractiveBlockingToolLifecycleOptions
  extends StdinExtractionOptions {
  /**
   * 是否装 PermissionDenied → InteractionResolved rejected（Grok 有此原生事件）。
   * Claude 系 PermissionDenied 是分类器，不得装。
   */
  includePermissionDenied?: boolean;
  /**
   * PostToolUseFailure 是否提取顶层 error（Grok 载荷有；缺省 true 以便
   * nativeState 旁路落盘，字段缺失时为空无害）。
   */
  postToolFailureNativeStateFields?: readonly string[];
  tools: readonly InteractiveBlockingToolCase[];
}

/**
 * Pre/Post(/Denied) 工具生命周期：阻塞等人工具按 toolName 映 Interaction*，
 * 其余仍 ToolStart/ToolComplete。三家接线只填差异，不再各抄一份 events 表。
 */
export function interactiveBlockingToolLifecycleEvents(
  options: InteractiveBlockingToolLifecycleOptions
): readonly NestedHookEventSpec[] {
  const {
    includePermissionDenied = false,
    postToolFailureNativeStateFields = ["error"],
    tools,
    ...extraction
  } = options;

  const events: NestedHookEventSpec[] = [
    {
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdinInteractiveToolStart({
          ...extraction,
          agentId,
          nativeEvent: "PreToolUse",
          tools,
        }),
      emittedPierEvents: ["ToolStart", "InteractionRequested"],
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdinInteractiveToolResolve({
          ...extraction,
          agentId,
          interactionOutcome: "completed",
          nativeEvent: "PostToolUse",
          tools,
        }),
      emittedPierEvents: ["ToolComplete", "InteractionResolved"],
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdinInteractiveToolResolve({
          ...extraction,
          agentId,
          interactionOutcome: "failed",
          nativeEvent: "PostToolUseFailure",
          ...(postToolFailureNativeStateFields.length > 0
            ? { nativeStateFields: postToolFailureNativeStateFields }
            : {}),
          tools,
        }),
      emittedPierEvents: ["ToolComplete", "InteractionResolved"],
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
  ];

  if (includePermissionDenied) {
    events.push({
      buildCommand: (agentId) =>
        pierHookCommandV3WithStdinInteractiveToolResolve({
          ...extraction,
          agentId,
          interactionOutcome: "rejected",
          nativeEvent: "PermissionDenied",
          tools,
        }),
      emittedPierEvents: ["ToolComplete", "InteractionResolved"],
      nativeEvent: "PermissionDenied",
      pierEvent: "ToolComplete",
    });
  }

  return events;
}
