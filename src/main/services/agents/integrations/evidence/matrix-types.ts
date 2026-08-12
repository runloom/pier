/** A status assertion may only be based on an upstream fact, a reconciler, or no fact. */
export type AgentStatusEvidenceLevel = "native" | "reconciled" | "unsupported";

/**
 * Five UI states plus lifecycle, terminal and delegation facts consumed by
 * status policy. Lifecycle is tracked independently and never promotes a UI
 * state capability to ready.
 */
export type AgentStatusEvidenceDimension =
  | "lifecycle"
  | "ready"
  | "processing"
  | "tool"
  | "waiting"
  | "error"
  | "completed"
  | "interrupted"
  | "subagent";

/** Runtime control facts participate in turn bookkeeping but do not assert a UI capability. */
export type AgentStatusEventDimension =
  | AgentStatusEvidenceDimension
  | "control";

export type AgentStatusIntegrationState =
  | "active"
  | "cleanup-only"
  | "retired"
  | "not-integrated";

export type AgentStatusTransport =
  | "hook-command"
  | "hosted-plugin"
  | "transcript-reconciler"
  /** 终端裸 Esc 旁路观察 → `pier.terminal.user_escape`（main FA 注入）。 */
  | "host-terminal-escape"
  | "none";

export interface AgentStatusEventMapping {
  readonly dimension: AgentStatusEventDimension;
  readonly level: Exclude<AgentStatusEvidenceLevel, "unsupported">;
  readonly nativeEvent: string;
  readonly pierEvent: string;
}

export interface AgentStatusEvidence {
  readonly eventMappings: readonly AgentStatusEventMapping[];
  readonly evidence: Readonly<
    Record<AgentStatusEvidenceDimension, AgentStatusEvidenceLevel>
  >;
  readonly integration: AgentStatusIntegrationState;
  readonly transport: readonly AgentStatusTransport[];
  readonly upstream: AgentStatusUpstream;
}

export type AgentStatusUpstream =
  | {
      readonly kind: "source-commit";
      readonly commit: string;
      readonly officialEvidenceUrl: string;
    }
  | {
      readonly kind: "installed-version";
      readonly officialEvidenceUrl: string;
      readonly version: string;
    }
  | {
      readonly documentTitle: string;
      readonly kind: "dated-documentation";
      readonly officialEvidenceUrl: string;
      readonly verifiedOn: string;
    };

const VERIFIED_ON = "2026-07-29";

export function upstream(
  officialEvidenceUrl: string,
  documentTitle: string
): AgentStatusUpstream {
  return {
    documentTitle,
    kind: "dated-documentation",
    officialEvidenceUrl,
    verifiedOn: VERIFIED_ON,
  };
}

export function installedVersion(
  officialEvidenceUrl: string,
  version: string
): AgentStatusUpstream {
  return { kind: "installed-version", officialEvidenceUrl, version };
}

export function sourceCommit(
  officialEvidenceUrl: string,
  commit: string
): AgentStatusUpstream {
  return { kind: "source-commit", officialEvidenceUrl, commit };
}

export function facts(
  ...eventMappings: readonly AgentStatusEventMapping[]
): readonly AgentStatusEventMapping[] {
  return eventMappings;
}

export function fact(
  dimension: AgentStatusEventDimension,
  level: Exclude<AgentStatusEvidenceLevel, "unsupported">,
  nativeEvent: string,
  pierEvent: string
): AgentStatusEventMapping {
  return { dimension, level, nativeEvent, pierEvent };
}

export function nativeFact(
  dimension: AgentStatusEventDimension,
  nativeEvent: string,
  pierEvent: string
): AgentStatusEventMapping {
  return fact(dimension, "native", nativeEvent, pierEvent);
}
