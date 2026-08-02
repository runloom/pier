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

export interface AgentTurnEventSemantics {
  readonly cancelsTerminalCandidate: boolean;
  readonly category: AgentTurnEventCategory;
  readonly createsSession: boolean;
  readonly mappedStatus: ActivityStatus | null | undefined;
  readonly resetEvidence: TurnResetEvidence;
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
  terminalStatus: "ready" | "error"
): AgentTurnEventSemantics {
  return {
    cancelsTerminalCandidate: false,
    category: "terminal-trusted",
    createsSession: false,
    mappedStatus: terminalStatus,
    resetEvidence: "none",
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
  return trustedTerminal("ready");
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
  if (event.event === "TurnCompleted" || event.event === "TurnInterrupted") {
    return trustedTerminal("ready");
  }
  if (event.event === "error") return trustedTerminal("error");
  if (event.event === "PromptSubmit") {
    return turnStart("explicit-prompt");
  }
  if (event.event === "processing" || event.event === "running") {
    if (event.turnId?.trim()) return turnStart("turn-correlatable");
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
