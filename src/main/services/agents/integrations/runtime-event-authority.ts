import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { AgentTurnStartAuthority } from "../../foreground-activity/types.ts";
import type { AgentRuntimeSemantics } from "./types.ts";

export function resolveAgentTurnStartAuthority(
  runtime: AgentRuntimeSemantics | undefined,
  event: AgentHookEventPayload
): AgentTurnStartAuthority {
  if (!(runtime && event.v !== 1)) {
    return "none";
  }

  return runtime.emittedMappings.some(
    (mapping) =>
      mapping.nativeEvent === event.nativeEvent &&
      mapping.pierEvent === event.event &&
      mapping.turnStartAuthority === "authoritative"
  )
    ? "authoritative"
    : "none";
}
