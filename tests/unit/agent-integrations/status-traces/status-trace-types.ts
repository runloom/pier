import type { AgentStatusEvidenceDimension } from "@main/services/agents/integrations/evidence-matrix.ts";
import type { AgentStopAuthority } from "@main/services/foreground-activity/types.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent-session.ts";

export interface AgentStatusTraceExpectedEventFields {
  readonly agentInstanceId?: string;
  readonly agentType?: string;
  readonly interactionId?: string;
  readonly interactionKind?: "external-block" | "permission" | "question";
  readonly interactionOutcome?:
    | "accepted"
    | "cancelled"
    | "completed"
    | "failed"
    | "rejected"
    | "unknown";
  readonly nativeState?: string;
  readonly parentSessionId?: string;
  readonly sessionId?: string;
  readonly toolUseId?: string;
  readonly turnId?: string;
}

export interface AgentStatusTraceFixture {
  readonly actions: readonly AgentStatusTraceAction[];
  readonly agentId: AgentKind;
  readonly covers: readonly AgentStatusEvidenceDimension[];
  readonly createProducer: () => Promise<AgentStatusTraceProducer>;
  readonly stopAuthority: AgentStopAuthority;
}

export interface AgentStatusTraceAction {
  readonly checkpoints: readonly AgentStatusTraceCheckpoint[];
  readonly eventAssertions?: readonly AgentStatusTraceEventExpectation[];
  readonly expectedIngest?: boolean;
  readonly expectedNativeEvents: readonly string[];
  readonly nativeEvent: string;
  readonly nonCoveringAssertion?: AgentStatusTraceActivityExpectation;
  readonly payload: unknown;
  readonly producerKey?: string;
  readonly scenarios?: readonly AgentStatusTraceScenario[];
}

export interface AgentStatusTraceActivityExpectation {
  readonly expectedAbsent?: boolean;
  readonly expectedStatus?: AgentStatusTraceCheckpoint["expectedStatus"];
  readonly expectedStatusAbsent?: boolean;
}

export interface AgentStatusTraceEventExpectation {
  readonly expectedEvent: AgentHookEventPayloadV3["event"];
  readonly expectedEventFields?: AgentStatusTraceCheckpoint["expectedEventFields"];
  readonly expectedEventFieldsAbsent?: AgentStatusTraceCheckpoint["expectedEventFieldsAbsent"];
  readonly expectedNativeEvent: string;
}

export type AgentStatusTraceScenario =
  | "accept"
  | "auto-retry"
  | "cancel"
  | "compaction"
  | "concurrent-interactions"
  | "concurrent-tools"
  | "error"
  | "interrupted"
  | "late-event"
  | "main-subagent-interleave"
  | "reject"
  | "resume-after-waiting"
  | "session-replacement";

export interface AgentStatusTraceCheckpoint {
  readonly dimension: AgentStatusEvidenceDimension;
  readonly expectedAbsent?: boolean;
  readonly expectedEvent: AgentHookEventPayloadV3["event"];
  readonly expectedEventFields?: Readonly<AgentStatusTraceExpectedEventFields>;
  readonly expectedEventFieldsAbsent?: readonly (
    | "agentInstanceId"
    | "interactionId"
    | "toolUseId"
    | "turnId"
  )[];
  readonly expectedNativeEvent: string;
  readonly expectedStatus?:
    | "error"
    | "processing"
    | "ready"
    | "tool"
    | "waiting";
  readonly expectedStatusAbsent?: boolean;
  readonly expectedSubagentCount?: number;
}

export interface AgentStatusTraceProducer {
  close(): Promise<void> | void;
  run(action: AgentStatusTraceAction): Promise<readonly unknown[]>;
}

export interface InactiveAgentStatusTraceFixture {
  readonly agentId: "aider" | "crush" | "kiro";
  readonly assertNoStatusOutput: () => Promise<void>;
}

export interface AgentStatusTraceResult {
  readonly broadcastEvidenceCount: number;
  readonly coveredDimensions: ReadonlySet<AgentStatusEvidenceDimension>;
  readonly events: readonly AgentHookEventPayloadV3[];
  readonly schemaVersions: ReadonlySet<number>;
  readonly snapshotEvidenceCount: number;
}
