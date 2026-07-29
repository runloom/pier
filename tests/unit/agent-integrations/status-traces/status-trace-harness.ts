import type { AgentStatusEvidenceDimension } from "@main/services/agents/integrations/evidence-matrix.ts";
import { getAgentHookIntegration } from "@main/services/agents/integrations/registry.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent-session.ts";
import { agentHookEventSchema } from "@shared/contracts/agent-session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  AgentStatusTraceCheckpoint,
  AgentStatusTraceEventExpectation,
  AgentStatusTraceFixture,
  AgentStatusTraceResult,
} from "./status-trace-types.ts";

const BROADCAST_DEBOUNCE_WAIT_MS = 110;
const SESSION_START_VISIBILITY_WAIT_MS = 370;

export async function runAgentStatusTrace(
  fixture: AgentStatusTraceFixture
): Promise<AgentStatusTraceResult> {
  const registered = getAgentHookIntegration(fixture.agentId);
  if (!registered) {
    throw new Error(`${fixture.agentId} 不在智能体 hook 注册表中`);
  }
  if (fixture.stopAuthority !== registered.runtime.stopAuthority) {
    throw new Error(
      `${fixture.agentId} 轨迹 stopAuthority 与注册表不一致：${fixture.stopAuthority} !== ${registered.runtime.stopAuthority}`
    );
  }
  const producer = await fixture.createProducer();
  const events: AgentHookEventPayloadV3[] = [];
  const aggregator = createForegroundActivityAggregator();
  const broadcasts: ReturnType<typeof aggregator.snapshot>[] = [];
  const covered = new Set<AgentStatusEvidenceDimension>();
  let snapshotEvidenceCount = 0;
  const unsubscribe = aggregator.onChange((broadcast) => {
    broadcasts.push(broadcast);
  });
  try {
    for (const action of fixture.actions) {
      const snapshotBefore = aggregator.snapshot();
      const rawEvents = await producer.run(action);
      const actionEvents = rawEvents.map((raw) => {
        const parsed = agentHookEventSchema.parse(raw);
        if (parsed.kind !== "agentEvent" || parsed.v !== 3) {
          throw new Error(`${fixture.agentId} 轨迹输出不是严格 v3 agentEvent`);
        }
        if (parsed.agent !== fixture.agentId) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} producer 错发为 ${parsed.agent}`
          );
        }
        if (!action.expectedNativeEvents.includes(parsed.nativeEvent)) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} producer 发出未声明的原生事件 ${parsed.nativeEvent}`
          );
        }
        return parsed;
      });
      for (const expectation of action.eventAssertions ?? []) {
        assertEventExpectation(
          fixture.agentId,
          action.nativeEvent,
          expectation,
          actionEvents
        );
      }
      const broadcastsBefore = broadcasts.length;
      for (const event of actionEvents) {
        events.push(event);
        const ingested = aggregator.ingestAgentEvent(event, {
          stopAuthority: fixture.stopAuthority,
        });
        if (action.expectedIngest === false ? ingested : !ingested) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} 聚合器摄入结果不符预期：${String(ingested)}`
          );
        }
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          action.checkpoints.some(
            (checkpoint) => checkpoint.expectedEvent === "SessionStart"
          )
            ? SESSION_START_VISIBILITY_WAIT_MS
            : BROADCAST_DEBOUNCE_WAIT_MS
        )
      );
      const snapshotActivity = aggregator.snapshot().activities[0] as
        | AgentActivity
        | undefined;
      if (action.expectedIngest === false) {
        if (broadcasts.length !== broadcastsBefore) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} 被拒事件不应产生 onChange 广播`
          );
        }
        if (
          JSON.stringify(aggregator.snapshot().activities) !==
          JSON.stringify(snapshotBefore.activities)
        ) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} 被拒事件不应改变快照`
          );
        }
        if (action.checkpoints.length > 0) {
          throw new Error(
            `${fixture.agentId}:${action.nativeEvent} 被拒事件不能贡献覆盖`
          );
        }
        continue;
      }
      const newBroadcast = broadcasts.at(-1);
      if (!(newBroadcast && broadcasts.length > broadcastsBefore)) {
        throw new Error(
          `${fixture.agentId}:${action.nativeEvent} 本步没有新增 onChange 广播`
        );
      }
      const broadcastActivity = newBroadcast.activities[0] as
        | AgentActivity
        | undefined;
      if (action.nonCoveringAssertion) {
        assertActivityExpectation(
          fixture.agentId,
          action.nativeEvent,
          "snapshot",
          action.nonCoveringAssertion,
          snapshotActivity
        );
        assertActivityExpectation(
          fixture.agentId,
          action.nativeEvent,
          "broadcast",
          action.nonCoveringAssertion,
          broadcastActivity
        );
      }
      for (const checkpoint of action.checkpoints) {
        assertCheckpointStatusMatchesDimension(
          fixture.agentId,
          action.nativeEvent,
          checkpoint
        );
        assertCheckpoint(
          fixture.agentId,
          action.nativeEvent,
          checkpoint,
          actionEvents,
          snapshotActivity,
          broadcastActivity
        );
        covered.add(checkpoint.dimension);
        snapshotEvidenceCount += 1;
      }
    }
  } finally {
    unsubscribe();
    aggregator.dispose();
    await producer.close();
  }
  return {
    broadcastEvidenceCount: broadcasts.length,
    coveredDimensions: covered,
    events,
    schemaVersions: new Set(events.map((event) => event.v)),
    snapshotEvidenceCount,
  };
}

function assertActivityExpectation(
  agentId: string,
  nativeEvent: string,
  source: "broadcast" | "snapshot",
  expectation: {
    expectedAbsent?: boolean;
    expectedStatus?: AgentStatusTraceCheckpoint["expectedStatus"];
    expectedStatusAbsent?: boolean;
  },
  activity: AgentActivity | undefined
): void {
  if (expectation.expectedAbsent) {
    if (activity !== undefined) {
      throw new Error(`${agentId}:${nativeEvent} ${source} 应移除活动`);
    }
    return;
  }
  if (!activity) {
    throw new Error(`${agentId}:${nativeEvent} ${source} 缺少活动`);
  }
  if (
    expectation.expectedStatus !== undefined &&
    activity.status !== expectation.expectedStatus
  ) {
    throw new Error(
      `${agentId}:${nativeEvent} ${source} 状态应为 ${expectation.expectedStatus}，实际 ${activity.status}`
    );
  }
  if (expectation.expectedStatusAbsent && activity.status !== undefined) {
    throw new Error(
      `${agentId}:${nativeEvent} ${source} 不应带状态，实际 ${activity.status}`
    );
  }
}

function assertEventExpectation(
  agentId: string,
  nativeEvent: string,
  expectation: AgentStatusTraceEventExpectation,
  emittedEvents: readonly AgentHookEventPayloadV3[]
): void {
  const matchedEvent = emittedEvents.find(
    (event) =>
      event.event === expectation.expectedEvent &&
      event.nativeEvent === expectation.expectedNativeEvent &&
      Object.entries(expectation.expectedEventFields ?? {}).every(
        ([field, expected]) => eventField(event, field) === expected
      )
  );
  if (!matchedEvent) {
    throw new Error(
      `${agentId}:${nativeEvent} 未发出期望事件 ${expectation.expectedNativeEvent}:${expectation.expectedEvent}`
    );
  }
  for (const field of expectation.expectedEventFieldsAbsent ?? []) {
    if (eventField(matchedEvent, field) !== undefined) {
      throw new Error(
        `${agentId}:${nativeEvent} 事件字段 ${field} 应缺席，实际 ${String(eventField(matchedEvent, field))}`
      );
    }
  }
}

function eventField(event: AgentHookEventPayloadV3, field: string): unknown {
  return (event as unknown as Readonly<Record<string, unknown>>)[field];
}

function assertCheckpointStatusMatchesDimension(
  agentId: string,
  nativeEvent: string,
  checkpoint: AgentStatusTraceCheckpoint
): void {
  if (
    ["ready", "processing", "tool", "waiting", "error"].includes(
      checkpoint.dimension
    ) &&
    checkpoint.expectedStatus !== checkpoint.dimension
  ) {
    throw new Error(
      `${agentId}:${nativeEvent} ${checkpoint.dimension} 检查点必须观察同名状态`
    );
  }
}

function assertCheckpoint(
  agentId: string,
  nativeEvent: string,
  checkpoint: AgentStatusTraceCheckpoint,
  emittedEvents: readonly AgentHookEventPayloadV3[],
  snapshot: AgentActivity | undefined,
  broadcast: AgentActivity | undefined
): void {
  assertEventExpectation(agentId, nativeEvent, checkpoint, emittedEvents);
  const matchedEvent = emittedEvents.find(
    (event) =>
      event.event === checkpoint.expectedEvent &&
      event.nativeEvent === checkpoint.expectedNativeEvent &&
      Object.entries(checkpoint.expectedEventFields ?? {}).every(
        ([field, expected]) => eventField(event, field) === expected
      )
  );
  if (!matchedEvent) return;
  for (const [field, expected] of Object.entries(
    checkpoint.expectedEventFields ?? {}
  )) {
    const actual = eventField(matchedEvent, field);
    if (actual !== expected) {
      throw new Error(
        `${agentId}:${nativeEvent} 事件字段 ${field} 应为 ${String(expected)}，实际 ${String(actual)}`
      );
    }
  }
  for (const field of checkpoint.expectedEventFieldsAbsent ?? []) {
    if (eventField(matchedEvent, field) !== undefined) {
      throw new Error(
        `${agentId}:${nativeEvent} 事件字段 ${field} 应缺席，实际 ${String(eventField(matchedEvent, field))}`
      );
    }
  }
  for (const [source, activity] of [
    ["snapshot", snapshot],
    ["broadcast", broadcast],
  ] as const) {
    assertActivityExpectation(
      agentId,
      nativeEvent,
      source,
      checkpoint,
      activity
    );
    if (!activity) continue;
    if (
      checkpoint.expectedSubagentCount !== undefined &&
      activity.subagentCount !== checkpoint.expectedSubagentCount
    ) {
      throw new Error(
        `${agentId}:${nativeEvent} ${source} 子智能体数应为 ${checkpoint.expectedSubagentCount}，实际 ${activity.subagentCount}`
      );
    }
  }
}
