import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  type ActivityStatus,
  activityStatusForHookEvent,
} from "@shared/contracts/foreground-activity.ts";
import type { AgentEventIngestOptions, AgentStopAuthority } from "./types.ts";

export type AgentTurnEventCategory =
  | "session-start"
  | "session-end"
  | "turn-start"
  | "progress"
  | "work"
  | "terminal-candidate"
  | "terminal-trusted"
  | "ignored";

export type TurnResetEvidence =
  | "explicit-prompt"
  | "provider-authoritative"
  | "turn-correlatable"
  | "none";

export type AgentTerminalEvidence = "ready" | "interrupted" | "error";

export interface AgentTurnEventSemantics {
  readonly cancelsTerminalCandidate: boolean;
  readonly category: AgentTurnEventCategory;
  readonly createsSession: boolean;
  readonly mappedStatus: ActivityStatus | null | undefined;
  readonly resetEvidence: TurnResetEvidence;
  readonly terminalEvidence?: AgentTerminalEvidence;
  readonly terminalStatus?: "ready" | "error";
}

const sessionStartSemantics: AgentTurnEventSemantics = {
  cancelsTerminalCandidate: false,
  category: "session-start",
  createsSession: true,
  mappedStatus: undefined,
  resetEvidence: "none",
};

const sessionEndSemantics: AgentTurnEventSemantics = {
  cancelsTerminalCandidate: false,
  category: "session-end",
  createsSession: false,
  mappedStatus: undefined,
  resetEvidence: "none",
};

const progressSemantics: AgentTurnEventSemantics = {
  cancelsTerminalCandidate: true,
  category: "progress",
  createsSession: true,
  mappedStatus: "processing",
  resetEvidence: "none",
};

const legacyWaitingSemantics: AgentTurnEventSemantics = {
  cancelsTerminalCandidate: false,
  category: "work",
  createsSession: true,
  mappedStatus: "waiting",
  resetEvidence: "none",
};

const ignoredSemantics: AgentTurnEventSemantics = {
  cancelsTerminalCandidate: false,
  category: "ignored",
  createsSession: false,
  mappedStatus: null,
  resetEvidence: "none",
};

function trustedTerminal(
  terminalStatus: "ready" | "error",
  terminalEvidence: AgentTerminalEvidence
): AgentTurnEventSemantics {
  return {
    cancelsTerminalCandidate: false,
    category: "terminal-trusted",
    createsSession: false,
    mappedStatus: terminalStatus,
    resetEvidence: "none",
    terminalEvidence,
    terminalStatus,
  };
}

function turnStart(
  resetEvidence: Exclude<TurnResetEvidence, "none">
): AgentTurnEventSemantics {
  return {
    cancelsTerminalCandidate: true,
    category: "turn-start",
    createsSession: true,
    mappedStatus: "processing",
    resetEvidence,
  };
}

function stopSemantics(
  stopAuthority: AgentStopAuthority
): AgentTurnEventSemantics {
  if (stopAuthority === "none") {
    return ignoredSemantics;
  }
  if (stopAuthority === "advisory") {
    return {
      cancelsTerminalCandidate: false,
      category: "terminal-candidate",
      createsSession: false,
      mappedStatus: undefined,
      resetEvidence: "none",
    };
  }
  return trustedTerminal("ready", "ready");
}

/** v1/v2 允许空字符串；所有回合身份判断必须消费同一归一化结果。 */
export function normalizeAgentTurnId(
  turnId: string | undefined
): string | undefined {
  return turnId?.trim() || undefined;
}

/**
 * 跨 session 仍可当同一回合的 turnId。
 * 只认 UUID / ULID / 32 位 hex；短序号和普通长字符串会在进程级并行会话碰撞。
 */
const UUID_TURN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID_TURN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const HEX32_TURN_ID = /^[0-9a-f]{32}$/i;

export function isGloballyUniqueTurnId(turnId: string): boolean {
  return (
    UUID_TURN_ID.test(turnId) ||
    ULID_TURN_ID.test(turnId) ||
    HEX32_TURN_ID.test(turnId)
  );
}

function semanticsForMappedWorkEvent(
  eventName: string
): AgentTurnEventSemantics {
  const mappedStatus = activityStatusForHookEvent(eventName);
  if (mappedStatus === null) {
    return ignoredSemantics;
  }
  const startsWork =
    eventName === "ToolStart" || eventName === "InteractionRequested";
  return {
    cancelsTerminalCandidate: startsWork,
    category: "work",
    createsSession: startsWork,
    mappedStatus,
    resetEvidence: "none",
  };
}

export function classifyAgentTurnEvent(
  event: AgentHookEventPayload,
  options: AgentEventIngestOptions
): AgentTurnEventSemantics {
  if (event.event === "SessionStart") return sessionStartSemantics;
  if (event.event === "SessionEnd") return sessionEndSemantics;
  if (event.event === "Stop") return stopSemantics(options.stopAuthority);
  if (event.event === "TurnCompleted") {
    return trustedTerminal("ready", "ready");
  }
  if (event.event === "TurnInterrupted") {
    return trustedTerminal("ready", "interrupted");
  }
  if (event.event === "error") return trustedTerminal("error", "error");
  if (event.event === "PromptSubmit") {
    return turnStart("explicit-prompt");
  }
  if (event.event === "processing" || event.event === "running") {
    if (normalizeAgentTurnId(event.turnId)) {
      return turnStart("turn-correlatable");
    }
    if (options.turnStartAuthority === "authoritative") {
      return turnStart("provider-authoritative");
    }
    return progressSemantics;
  }
  if (event.v !== 3 && event.event === "PermissionRequest") {
    return legacyWaitingSemantics;
  }
  return semanticsForMappedWorkEvent(event.event);
}
