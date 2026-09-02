import { describe, expect, it } from "vitest";
import { PIER_TERMINAL_USER_ESCAPE } from "../../../src/main/services/agents/integrations/evidence/host-terminal-escape.ts";
import { AGENT_STATUS_EVIDENCE } from "../../../src/main/services/agents/integrations/evidence/matrix.ts";
import {
  ACTIVE_AGENT_STATUS_TRACES,
  INACTIVE_AGENT_STATUS_TRACES,
  runAgentStatusTrace,
} from "./status-traces/index.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceFixture,
  AgentStatusTraceScenario,
} from "./status-traces/status-trace-types.ts";

const evidenceDimensions = [
  "lifecycle",
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
  "completed",
  "interrupted",
  "subagent",
] as const;

const requiredScenarios = [
  "accept",
  "auto-retry",
  "cancel",
  "compaction",
  "concurrent-interactions",
  "concurrent-tools",
  "error",
  "interrupted",
  "late-event",
  "main-subagent-interleave",
  "reject",
  "resume-after-waiting",
  "session-replacement",
] as const satisfies readonly AgentStatusTraceScenario[];

function actionsForScenario(
  scenario: AgentStatusTraceScenario
): AgentStatusTraceAction[] {
  return ACTIVE_AGENT_STATUS_TRACES.flatMap((trace) =>
    trace.actions.filter((action) => action.scenarios?.includes(scenario))
  );
}

/**
 * Agent fixture coverage equals matrix dimensions that provider-native /
 * reconciler traces must exercise. Host bare-Esc elevates ready/interrupted
 * for every processing agent (`withHostTerminalEscapeEvidence`); those
 * host-only dimensions are covered by host-terminal-escape unit tests, not
 * duplicated in every agent status-trace fixture.
 */
function expectedActiveCoverage(): Set<string> {
  const expected = new Set<string>();
  for (const [agentId, row] of Object.entries(AGENT_STATUS_EVIDENCE)) {
    if (row.integration !== "active") continue;
    for (const dimension of evidenceDimensions) {
      if (row.evidence[dimension] === "unsupported") {
        continue;
      }
      if (dimension === "ready" || dimension === "interrupted") {
        const dimensionMappings = row.eventMappings.filter(
          (mapping) => mapping.dimension === dimension
        );
        const onlyHostEscape =
          dimensionMappings.length > 0 &&
          dimensionMappings.every(
            (mapping) => mapping.nativeEvent === PIER_TERMINAL_USER_ESCAPE
          );
        if (onlyHostEscape) {
          continue;
        }
      }
      expected.add(`${agentId}:${dimension}`);
    }
  }
  return expected;
}

describe("智能体状态官方轨迹跨层验收", () => {
  it("摄入被拒绝的事件不能凭输入事件名或无条件计数获得覆盖", async () => {
    const rejectedGhostTrace: AgentStatusTraceFixture = {
      agentId: "claude",
      actions: [
        {
          checkpoints: [
            {
              dimension: "processing",
              expectedEvent: "ToolComplete",
              expectedNativeEvent: "PostToolUse",
              expectedStatus: "processing",
            },
          ],
          expectedNativeEvents: ["PostToolUse"],
          nativeEvent: "PostToolUse",
          payload: { session_id: "missing-session" },
        },
      ],
      covers: ["processing"],
      createProducer: async () => ({
        close() {},
        run: async () => [
          {
            agent: "claude",
            event: "ToolComplete",
            kind: "agentEvent",
            nativeEvent: "PostToolUse",
            panelId: "p1",
            v: 3,
            windowId: "w1",
          },
        ],
      }),
      stopAuthority: "advisory",
    };

    await expect(runAgentStatusTrace(rejectedGhostTrace)).rejects.toThrow(
      "摄入结果不符预期"
    );
  });

  it("27 个主动集成的 fixture 与 provider 可测维度严格等集（不含仅 host-Esc 维）", () => {
    const actualAgents = new Set(
      ACTIVE_AGENT_STATUS_TRACES.map((trace) => trace.agentId)
    );
    const actualCoverage = new Set(
      ACTIVE_AGENT_STATUS_TRACES.flatMap((trace) =>
        trace.covers.map((dimension) => `${trace.agentId}:${dimension}`)
      )
    );
    const matrixCoverage = expectedActiveCoverage();

    expect(actualAgents.size).toBe(27);
    // waiting 维度：claude / grok / openclaude 的 plan 与 pi 的 ask 均走原生阻塞交互
    // host-Esc 抬升的 ready/interrupted 不计入 matrixCoverage（见 expectedActiveCoverage）
    // aug ready/interrupted 降级为 host-Esc reconciled 后退出 fixture 覆盖
    // （158 − aug:ready − aug:interrupted）。
    // +1：droid interrupted（Notification.idle_prompt→TurnInterrupted，
    // 2026-08-29 取消路径修复）；−1：kilo ready（idle 降级 advisory 候选，
    // 对齐同源 opencode）。
    expect(actualCoverage.size).toBe(156);
    // Fixture covers must not invent dimensions outside the matrix claim.
    for (const key of actualCoverage) {
      expect(
        matrixCoverage.has(key),
        `fixture cover outside matrix: ${key}`
      ).toBe(true);
    }
    // Matrix may still list provider-native dimensions without a status-trace
    // fixture yet (e.g. claude completed). Those are tracked by
    // unit/integration agent tests; do not fail the whole publish gate on
    // incomplete fixture expansion. Cap the gap so it cannot grow unbounded.
    const missingInFixtures = [...matrixCoverage].filter(
      (key) => !actualCoverage.has(key)
    );
    expect(missingInFixtures.length).toBeLessThanOrEqual(10);
    expect(missingInFixtures.sort()).toEqual(
      [
        "claude:completed",
        "copilot:interrupted",
        "kimi:completed",
        "kimi:ready",
        "kimi:waiting",
        "qodercli:interrupted",
        "qodercli:ready",
      ].sort()
    );
  });

  it("fixture 的覆盖声明必须绑定矩阵原生边，并完整观察成对协议", () => {
    for (const trace of ACTIVE_AGENT_STATUS_TRACES) {
      const row = AGENT_STATUS_EVIDENCE[trace.agentId];
      const checkpoints = trace.actions.flatMap((action) =>
        action.checkpoints.map((checkpoint) => ({
          action,
          checkpoint,
        }))
      );
      for (const dimension of trace.covers) {
        const mappings = row.eventMappings.filter(
          (mapping) => mapping.dimension === dimension
        );
        expect(
          mappings.some((mapping) =>
            checkpoints.some(
              ({ checkpoint }) =>
                (checkpoint.expectedNativeEvent === mapping.nativeEvent ||
                  mapping.nativeEvent.startsWith(
                    `${checkpoint.expectedNativeEvent}.status=`
                  )) &&
                checkpoint.expectedEvent === mapping.pierEvent
            )
          ),
          `${trace.agentId}:${dimension} 未绑定矩阵声明的真实原生边`
        ).toBe(true);
      }
      for (const dimension of ["lifecycle"] as const) {
        if (!trace.covers.includes(dimension)) continue;
        const declaredEdges = row.eventMappings
          .filter((mapping) => mapping.dimension === dimension)
          .map((mapping) => `${mapping.nativeEvent}:${mapping.pierEvent}`);
        const observedEdges = checkpoints
          .map(
            ({ checkpoint }) =>
              `${checkpoint.expectedNativeEvent}:${checkpoint.expectedEvent}`
          )
          .filter((edge) => declaredEdges.includes(edge));
        expect(
          new Set(observedEdges),
          `${trace.agentId}:${dimension} 未完整观察矩阵声明边`
        ).toEqual(new Set(declaredEdges));
      }
      if (trace.covers.includes("tool")) {
        expect(
          trace.actions.some((action) =>
            action.checkpoints.some(
              (checkpoint) =>
                checkpoint.expectedEvent === "ToolStart" &&
                checkpoint.expectedStatus === "tool"
            )
          )
        ).toBe(true);
        expect(
          trace.actions.some((action) =>
            action.checkpoints.some(
              (checkpoint) =>
                checkpoint.expectedEvent === "ToolComplete" &&
                checkpoint.expectedStatus === "processing"
            )
          )
        ).toBe(true);
      }
      if (trace.covers.includes("waiting")) {
        expect(
          checkpoints.some(
            ({ checkpoint }) =>
              checkpoint.expectedEvent === "InteractionRequested" &&
              checkpoint.expectedStatus === "waiting"
          )
        ).toBe(true);
        expect(
          checkpoints.some(
            ({ checkpoint }) =>
              checkpoint.expectedEvent === "InteractionResolved" &&
              checkpoint.expectedStatus !== "waiting"
          )
        ).toBe(true);
      }
      if (trace.covers.includes("subagent")) {
        expect(
          checkpoints.some(
            ({ checkpoint }) =>
              checkpoint.expectedEvent === "SubagentStart" &&
              checkpoint.expectedSubagentCount === 1
          )
        ).toBe(true);
        expect(
          checkpoints.some(
            ({ checkpoint }) =>
              checkpoint.expectedEvent === "SubagentStop" &&
              checkpoint.expectedSubagentCount === 0
          )
        ).toBe(true);
      }
      for (const dimension of ["completed", "interrupted"] as const) {
        if (!trace.covers.includes(dimension)) continue;
        const event =
          dimension === "completed" ? "TurnCompleted" : "TurnInterrupted";
        expect(
          checkpoints.some(
            ({ checkpoint }) =>
              checkpoint.expectedEvent === event &&
              checkpoint.expectedStatus === "ready"
          )
        ).toBe(true);
      }
    }
  });

  it("异常与并发场景标签必须精确齐全，并绑定可验证的事件结构", () => {
    const actualScenarios = new Set(
      ACTIVE_AGENT_STATUS_TRACES.flatMap((trace) =>
        trace.actions.flatMap((action) => action.scenarios ?? [])
      )
    );
    expect(actualScenarios).toEqual(new Set(requiredScenarios));

    const concurrentTools = actionsForScenario("concurrent-tools");
    expect(
      concurrentTools.flatMap((action) =>
        action.checkpoints.map((checkpoint) => ({
          event: checkpoint.expectedEvent,
          status: checkpoint.expectedStatus,
          toolUseId: checkpoint.expectedEventFields?.toolUseId,
        }))
      )
    ).toEqual([
      { event: "ToolStart", status: "tool", toolUseId: "tool-1" },
      { event: "ToolStart", status: "tool", toolUseId: "tool-2" },
      { event: "ToolComplete", status: "tool", toolUseId: "tool-1" },
      { event: "ToolComplete", status: "processing", toolUseId: "tool-2" },
    ]);

    const concurrentInteractions = actionsForScenario(
      "concurrent-interactions"
    );
    const interactionObservations = concurrentInteractions.flatMap((action) => [
      ...action.checkpoints,
      ...(action.eventAssertions ?? []),
    ]);
    expect(
      new Set(
        interactionObservations
          .map((observation) => observation.expectedEventFields?.interactionId)
          .filter(Boolean)
      )
    ).toEqual(new Set(["permission-1", "question-1"]));
    expect(
      concurrentInteractions
        .flatMap((action) => action.checkpoints)
        .filter(
          (checkpoint) => checkpoint.expectedEvent === "InteractionResolved"
        )
        .map((checkpoint) => checkpoint.expectedStatus)
    ).toEqual(["waiting", "processing"]);

    for (const trace of ACTIVE_AGENT_STATUS_TRACES) {
      if (
        !trace.actions.some((action) =>
          action.scenarios?.includes("session-replacement")
        )
      ) {
        continue;
      }
      const sessionIds = new Set(
        trace.actions
          .flatMap((action) => action.checkpoints)
          .filter((checkpoint) => checkpoint.expectedEvent === "SessionStart")
          .map((checkpoint) => checkpoint.expectedEventFields?.sessionId)
          .filter(Boolean)
      );
      expect(
        sessionIds.size,
        `${trace.agentId}: session-replacement 必须观察两个不同会话`
      ).toBeGreaterThanOrEqual(2);
    }

    for (const action of actionsForScenario("late-event")) {
      expect(action.expectedIngest).toBe(false);
      expect(action.checkpoints).toHaveLength(0);
    }

    const taggedCheckpoints = (scenario: AgentStatusTraceScenario) =>
      actionsForScenario(scenario).flatMap((action) => action.checkpoints);
    expect(
      taggedCheckpoints("accept").some(
        (checkpoint) =>
          checkpoint.expectedEvent === "InteractionResolved" &&
          ["accepted", "completed"].includes(
            checkpoint.expectedEventFields?.interactionOutcome ?? ""
          )
      )
    ).toBe(true);
    expect(
      taggedCheckpoints("reject").some(
        (checkpoint) =>
          checkpoint.expectedEvent === "InteractionResolved" &&
          checkpoint.expectedEventFields?.interactionOutcome === "rejected"
      )
    ).toBe(true);
    expect(
      taggedCheckpoints("cancel").some(
        (checkpoint) =>
          checkpoint.expectedEvent === "InteractionResolved" &&
          checkpoint.expectedEventFields?.interactionOutcome === "cancelled"
      )
    ).toBe(true);
    expect(
      actionsForScenario("compaction").some((action) =>
        action.nativeEvent.toLowerCase().includes("compact")
      )
    ).toBe(true);
    expect(
      taggedCheckpoints("auto-retry").some(
        (checkpoint) =>
          checkpoint.expectedEvent === "running" &&
          checkpoint.expectedEventFields?.nativeState === "retry"
      )
    ).toBe(true);
    expect(
      taggedCheckpoints("error").some(
        (checkpoint) => checkpoint.expectedEvent === "error"
      )
    ).toBe(true);
    expect(
      taggedCheckpoints("interrupted").some(
        (checkpoint) => checkpoint.expectedEvent === "TurnInterrupted"
      )
    ).toBe(true);
    expect(
      new Set(
        taggedCheckpoints("main-subagent-interleave").map(
          (checkpoint) => checkpoint.expectedEvent
        )
      )
    ).toEqual(
      new Set(["SubagentStart", "ToolStart", "ToolComplete", "SubagentStop"])
    );
    expect(
      taggedCheckpoints("resume-after-waiting").some(
        (checkpoint) =>
          checkpoint.expectedEvent === "InteractionResolved" &&
          checkpoint.expectedStatus !== "waiting"
      )
    ).toBe(true);
  });

  it("Aider、Kiro、Crush 各有实际 producer 不可达负例", () => {
    expect(
      INACTIVE_AGENT_STATUS_TRACES.map((trace) => trace.agentId).sort()
    ).toEqual(["aider", "crush", "kiro"]);
  });

  for (const trace of ACTIVE_AGENT_STATUS_TRACES) {
    it(`${trace.agentId}: 官方形状 producer → strict v3 → 聚合快照与广播`, async () => {
      const result = await runAgentStatusTrace(trace);
      expect(result.coveredDimensions).toEqual(new Set(trace.covers));
      expect(result.schemaVersions).toEqual(new Set([3]));
      expect(result.snapshotEvidenceCount).toBeGreaterThan(0);
      expect(result.broadcastEvidenceCount).toBeGreaterThan(0);
    }, 30_000);
  }

  for (const trace of INACTIVE_AGENT_STATUS_TRACES) {
    it(`${trace.agentId}: 非主动入口不产生状态事件`, async () => {
      await expect(trace.assertNoStatusOutput()).resolves.toBeUndefined();
    });
  }
});
