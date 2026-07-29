import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
} from "./status-trace-types.ts";

export function action(
  nativeEvent: string,
  event: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  payload: unknown
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension,
        expectedEvent: event,
        expectedNativeEvent: nativeEvent,
        ...expected,
      },
    ],
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload,
  };
}

export function event(type: string, properties: Record<string, unknown>) {
  return {
    event: { properties, type },
    handler: "event",
  };
}

export function direct(
  handler: string,
  input: Record<string, unknown>,
  output?: Record<string, unknown>
) {
  return { handler, input, ...(output ? { output } : {}) };
}

export function terminal(
  nativeEvent: string,
  eventName: "TurnCompleted" | "TurnInterrupted",
  dimension: "completed" | "interrupted",
  sessionId: string,
  payload: unknown
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension: "ready",
        expectedEvent: eventName,
        expectedEventFields: { sessionId },
        expectedNativeEvent: nativeEvent,
        expectedStatus: "ready",
      },
      {
        dimension,
        expectedEvent: eventName,
        expectedEventFields: { sessionId },
        expectedNativeEvent: nativeEvent,
        expectedStatus: "ready",
      },
    ],
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload,
  };
}
