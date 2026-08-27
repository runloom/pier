import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
  AgentHookEventPayloadV2,
  AgentHookEventPayloadV3,
} from "@shared/contracts/agent/session.ts";
import type {
  AgentActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import {
  type LogRecord,
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForegroundActivityAggregator as createRawForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import {
  newHookLayer,
  newHookScope,
} from "../../../../src/main/services/foreground-activity/entry.ts";
import {
  commitSubagentWorkPlan,
  planSubagentWork,
} from "../../../../src/main/services/foreground-activity/subagent-work-associations.ts";
import type {
  AgentEventIngestOptions,
  AgentStopAuthority,
  ForegroundActivityAggregator,
  ForegroundActivityAggregatorOpts,
} from "../../../../src/main/services/foreground-activity/types.ts";

type TestForegroundActivityAggregator = Omit<
  ForegroundActivityAggregator,
  "ingestAgentEvent"
> & {
  ingestAgentEvent(
    event: AgentHookEventPayload,
    options?: Partial<AgentEventIngestOptions>
  ): boolean;
};

const DEFAULT_INGEST_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function createForegroundActivityAggregator(
  opts: ForegroundActivityAggregatorOpts = {}
): TestForegroundActivityAggregator {
  const aggregator = createRawForegroundActivityAggregator(opts);
  return {
    ...aggregator,
    ingestAgentEvent: (
      event: AgentHookEventPayload,
      options: Partial<AgentEventIngestOptions> = {}
    ) =>
      aggregator.ingestAgentEvent(event, {
        ...DEFAULT_INGEST_OPTIONS,
        ...options,
      }),
  };
}

function hookEvent(
  event: string,
  panelId = "p1",
  windowId = "1"
): AgentHookEventPayload {
  return {
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    event,
    panelId,
    windowId,
  };
}

function agentHookEvent(
  args: Partial<AgentHookEventPayloadV1> & {
    event: string;
  }
): AgentHookEventPayload {
  return {
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    panelId: "p1",
    windowId: "1",
    ...args,
  };
}

/** v2 payload：`actorHint` / `parentSessionId` 只在 v2 上存在（v1 schema 无此字段）。 */
function agentHookEventV2(
  args: Partial<AgentHookEventPayloadV2> & {
    event: string;
  }
): AgentHookEventPayload {
  return {
    v: 2,
    kind: "agentEvent",
    agent: "claude",
    panelId: "p1",
    windowId: "1",
    nativeEvent: args.event,
    ...args,
  };
}

function agentHookEventV3(
  args: Partial<AgentHookEventPayloadV3> & {
    event: AgentHookEventPayloadV3["event"];
    nativeEvent: string;
  }
): AgentHookEventPayloadV3 {
  return {
    v: 3,
    kind: "agentEvent",
    agent: "claude",
    panelId: "p1",
    windowId: "1",
    ...args,
  } as AgentHookEventPayloadV3;
}

function interactionEvent(
  event: "InteractionRequested" | "InteractionResolved",
  args: {
    interactionId?: string;
    interactionKind?: "external-block" | "permission" | "question";
    interactionOutcome?:
      | "accepted"
      | "cancelled"
      | "completed"
      | "failed"
      | "rejected"
      | "unknown";
  } = {}
): AgentHookEventPayloadV3 {
  const base = {
    v: 3 as const,
    kind: "agentEvent" as const,
    agent: "claude" as const,
    nativeEvent: event,
    panelId: "p1",
    windowId: "1",
  };
  const interaction = {
    ...(args.interactionId ? { interactionId: args.interactionId } : {}),
    interactionKind: args.interactionKind ?? "permission",
  };
  if (event === "InteractionRequested") {
    return { ...base, ...interaction, event };
  }
  return {
    ...base,
    ...interaction,
    event,
    ...(args.interactionOutcome
      ? { interactionOutcome: args.interactionOutcome }
      : {}),
  };
}

const scopeCreatingEventCases: [string, AgentHookEventPayload][] = [
  [
    "PromptSubmit",
    agentHookEventV2({
      agent: "pi",
      event: "PromptSubmit",
      sessionId: "session-A",
    }),
  ],
  [
    "ToolStart",
    agentHookEventV2({
      agent: "pi",
      event: "ToolStart",
      sessionId: "session-A",
      toolUseId: "tool-A",
    }),
  ],
  [
    "InteractionRequested",
    {
      ...interactionEvent("InteractionRequested", {
        interactionId: "ask-A",
      }),
      agent: "pi",
      sessionId: "session-A",
    },
  ],
  [
    "processing",
    agentHookEventV2({
      agent: "pi",
      event: "processing",
      sessionId: "session-A",
    }),
  ],
  [
    "running",
    agentHookEventV2({
      agent: "pi",
      event: "running",
      sessionId: "session-A",
    }),
  ],
  [
    "PermissionRequest",
    agentHookEventV2({
      agent: "pi",
      event: "PermissionRequest",
      sessionId: "session-A",
    }),
  ],
];

describe("ForegroundActivityAggregator", () => {
  let clock = 0;
  const now = (): number => clock;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetDefaultLogSinkForTests();
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  it("agentLaunched → 建立 launch-source agent activity, 250ms 消抖后可见且无 status", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    // 消抖期内隐藏（瞬时命令不闪条）
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    // launch 先验无 hook 证据 → 投影不带 status
    expect(a.status).toBeUndefined();
    expect(a.subagentCount).toBe(0);
    agg.dispose();
  });

  it("同 agent 双击去抖: launcher + OSC 二次 agentLaunched 不重置消抖 timer", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(150);
    // OSC 133 C 匹配同 agent → 去抖, 不重置 250ms 消抖
    agg.ingestCommandStarted("p1", "1", "codex --resume", "codex");
    advance(100);
    // 距首次 launch 恰 250ms → 可见（若 timer 被重置此刻仍隐藏）
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("不同 agent 重 launch → 换新层, 重新 250ms 消抖", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(150);
    agg.agentLaunched("1", "p1", "claude");
    // 首层的 250ms 已到, 但层已被替换 → 仍隐藏
    advance(100);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 新层自建立起 250ms 后可见
    advance(150);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.agentId).toBe("claude");
    agg.dispose();
  });

  it("ingestAgentEvent(SessionStart) → 建立 hook-source agent activity, 250ms 隐藏后可见", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    // 消抖期内隐藏
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    expect(a.status).toBeUndefined();
    expect(a.stateStartedAt).toBeUndefined();
    agg.dispose();
  });

  it("隐藏期被拒事件不揭示 hook，也不取消原可见性计时器", () => {
    const agg = createForegroundActivityAggregator({ now });
    const broadcasts: ReturnType<typeof agg.snapshot>[] = [];
    const unsubscribe = agg.onChange((broadcast) => {
      broadcasts.push(broadcast);
    });

    expect(agg.ingestAgentEvent(hookEvent("SessionStart"))).toBe(true);
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(100);
    expect(broadcasts.at(-1)?.activities).toHaveLength(0);
    const broadcastsBeforeRejectedEvent = broadcasts.length;

    expect(
      agg.ingestAgentEvent(hookEvent("Stop"), { stopAuthority: "none" })
    ).toBe(false);
    expect(agg.snapshot().activities).toHaveLength(0);
    expect(broadcasts).toHaveLength(broadcastsBeforeRejectedEvent);

    advance(150);
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(broadcasts).toHaveLength(broadcastsBeforeRejectedEvent);
    advance(100);
    expect(broadcasts).toHaveLength(broadcastsBeforeRejectedEvent + 1);
    expect(broadcasts.at(-1)?.activities).toHaveLength(1);

    unsubscribe();
    agg.dispose();
  });

  it("身份只由主会话事件推进：子会话事件不得改写面板行身份", () => {
    // 标题可以不准，身份不能被猜。子会话（actorHint / parentSessionId /
    // Subagent*）的会话号不是面板主会话的身份，多 agent 调度要靠它区分。
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "main-1" })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        event: "ToolStart",
        parentSessionId: "main-1",
        sessionId: "sub-9",
      })
    );
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.sessionId).toBe("main-1");
    expect(a.actorHint).toBeUndefined();
    expect(a.parentSessionId).toBeUndefined();
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("子智能体生命周期按 parentSessionId 归入主 scope，不参与状态与身份竞选", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "SessionStart", sessionId: "main-1" })
    );
    advance(250);

    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        parentSessionId: "main-1",
        sessionId: "child-1",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-1",
      subagentCount: 1,
    });
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();

    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agentInstanceId: "worker-1",
        event: "SubagentStop",
        parentSessionId: "main-1",
        sessionId: "child-1",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-1",
      subagentCount: 0,
    });
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();
    agg.dispose();
  });

  it("仅有 child sessionId 的子智能体生命周期复用唯一主 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "SessionStart", sessionId: "main-1" })
    );
    advance(250);

    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        sessionId: "child-1",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-1",
      subagentCount: 1,
    });
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();
    agg.dispose();
  });

  it("子工作项可用 Start 的 sessionId 别名结算，不要求 Stop 重复 agentInstanceId", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "SessionStart", sessionId: "main-A" })
    );
    advance(250);
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "child-1",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          event: "SubagentStop",
          sessionId: "child-1",
        })
      )
    ).toBe(true);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(0);
    agg.dispose();
  });

  it("Start 只有 sessionId 时，不得把陌生 agentInstanceId 的 Stop 猜成同一工作项", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "SessionStart", sessionId: "main-A" })
    );
    advance(250);
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "child-1",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agentInstanceId: "worker-1",
          event: "SubagentStop",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);
    agg.dispose();
  });

  it("无 parent 时多个别名分别属于不同活跃工作项则拒绝冲突 Start", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (const sessionId of ["main-A", "main-B"]) {
      agg.ingestAgentEvent(
        agentHookEventV2({ agent: "pi", event: "PromptSubmit", sessionId })
      );
    }
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-A",
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "child-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-B",
        event: "SubagentStart",
        parentSessionId: "main-B",
        sessionId: "child-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-B",
          event: "SubagentStart",
          sessionId: "child-A",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(2);
    agg.dispose();
  });

  it("显式 parent 先限定 scope：共享 instance 时可按 child 别名只结束 A", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (const sessionId of ["main-A", "main-B"]) {
      agg.ingestAgentEvent(
        agentHookEventV2({ agent: "pi", event: "PromptSubmit", sessionId })
      );
    }
    for (const parent of ["A", "B"]) {
      expect(
        agg.ingestAgentEvent(
          agentHookEventV2({
            actorHint: "subagent",
            agent: "pi",
            agentInstanceId: "worker-shared",
            event: "SubagentStart",
            parentSessionId: `main-${parent}`,
            sessionId: `child-${parent}`,
          })
        )
      ).toBe(true);
    }

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-shared",
          event: "SubagentStop",
          parentSessionId: "main-A",
          sessionId: "child-A",
        })
      )
    ).toBe(true);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);
    agg.dispose();
  });

  it("完全相同 instance 可由显式不同 parent 建立两个工作项并分别结束", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (const sessionId of ["main-A", "main-B"]) {
      agg.ingestAgentEvent(
        agentHookEventV2({ agent: "pi", event: "PromptSubmit", sessionId })
      );
      expect(
        agg.ingestAgentEvent(
          agentHookEventV2({
            actorHint: "subagent",
            agent: "pi",
            agentInstanceId: "worker-shared",
            event: "SubagentStart",
            parentSessionId: sessionId,
          })
        )
      ).toBe(true);
    }
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(2);

    for (const [parentSessionId, count] of [
      ["main-A", 1],
      ["main-B", 0],
    ] as const) {
      expect(
        agg.ingestAgentEvent(
          agentHookEventV2({
            actorHint: "subagent",
            agent: "pi",
            agentInstanceId: "worker-shared",
            event: "SubagentStop",
            parentSessionId,
          })
        )
      ).toBe(true);
      expect(
        (agg.snapshot().activities[0] as AgentActivity | undefined)
          ?.subagentCount
      ).toBe(count);
    }
    agg.dispose();
  });

  it("单工作项轮换 1000 个同类别名时索引有界，旧别名进入保守保护", () => {
    const mainEvent = agentHookEventV2({
      agent: "pi",
      event: "PromptSubmit",
      sessionId: "main-A",
    });
    const hook = newHookLayer(mainEvent, 0, false);
    const scope = newHookScope("session:main-A", 0, {
      sessionId: "main-A",
    });
    hook.scopes.set(scope.key, scope);

    for (let index = 0; index < 1000; index += 1) {
      const event = agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: `worker-${index}`,
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "child-1",
      });
      const plan = planSubagentWork(hook, scope, event);
      expect(plan).not.toBeNull();
      commitSubagentWorkPlan(hook, scope, plan ?? undefined);
    }

    expect(hook.activeSubagentWorks.size).toBe(1);
    expect(hook.subagentWorkIdsByAlias.size).toBeLessThanOrEqual(2);
    expect([...hook.activeSubagentWorks.values()][0]?.aliases.size).toBe(2);
    expect(hook.subagentAssociationHistoryIncomplete).toBe(true);
    expect(
      planSubagentWork(
        hook,
        scope,
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-0",
          event: "SubagentStop",
          parentSessionId: "main-A",
        })
      )
    ).toBeNull();
    expect(
      planSubagentWork(
        hook,
        scope,
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-999",
          event: "SubagentStop",
          parentSessionId: "main-A",
          sessionId: "child-1",
        })
      )
    ).not.toBeNull();

    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(mainEvent);
    for (let index = 0; index < 1000; index += 1) {
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: `worker-${index}`,
          event: "SubagentStart",
          parentSessionId: "main-A",
          sessionId: "child-1",
        })
      );
    }
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        event: "SubagentStart",
        parentSessionId: "main-A",
      })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-0",
          event: "SubagentStop",
          parentSessionId: "main-A",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(2);
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-999",
          event: "SubagentStop",
          parentSessionId: "main-A",
          sessionId: "child-1",
        })
      )
    ).toBe(true);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);
    agg.dispose();
  });

  it("超过 128 个双别名活跃子工作项时不淘汰，均可按 sessionId 结算", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "SessionStart", sessionId: "main-A" })
    );
    advance(250);
    for (let index = 0; index < 140; index += 1) {
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agentInstanceId: `worker-${index}`,
          event: "SubagentStart",
          parentSessionId: "main-A",
          sessionId: `child-${index}`,
        })
      );
    }
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(140);

    for (let index = 0; index < 140; index += 1) {
      expect(
        agg.ingestAgentEvent(
          agentHookEventV2({
            actorHint: "subagent",
            event: "SubagentStop",
            sessionId: `child-${index}`,
          })
        )
      ).toBe(true);
    }
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(0);
    agg.dispose();
  });

  it("旧 scope 退休后的迟到具名 Stop 不得扣减新 scope 的匿名子工作项", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "old-worker",
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "old-child",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "SessionEnd",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        event: "SubagentStart",
        parentSessionId: "main-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "old-worker",
          event: "SubagentStop",
          sessionId: "old-child",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);
    agg.dispose();
  });

  it("子工作项墓碑超过上限后仍拒绝把旧 Stop 配给新匿名工作项", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    for (let index = 0; index < 300; index += 1) {
      const lifecycle = {
        actorHint: "subagent" as const,
        agent: "pi" as const,
        agentInstanceId: `worker-${index}`,
        parentSessionId: "main-A",
        sessionId: `child-${index}`,
      };
      agg.ingestAgentEvent(
        agentHookEventV2({ ...lifecycle, event: "SubagentStart" })
      );
      agg.ingestAgentEvent(
        agentHookEventV2({ ...lifecycle, event: "SubagentStop" })
      );
    }
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "SessionEnd",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        event: "SubagentStart",
        parentSessionId: "main-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-0",
          event: "SubagentStop",
          sessionId: "child-0",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);
    agg.dispose();
  });

  it("无 parent 的具名子 Stop 沿用 Start 时确定的主 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        sessionId: "child-1",
      })
    );
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(1);

    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-1",
          event: "SubagentStop",
          sessionId: "child-1",
        })
      )
    ).toBe(true);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-B",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("子实例所属主 scope 已删除时迟到 Stop 不得归给剩余唯一 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        sessionId: "child-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "SessionEnd",
        sessionId: "main-A",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-1",
          event: "SubagentStop",
          sessionId: "child-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-B",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("新回合清理后的迟到具名子 Stop 不得复用旧归属", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
        turnId: "turn-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        sessionId: "child-1",
        turnId: "turn-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
        turnId: "turn-2",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-1",
          event: "SubagentStop",
          sessionId: "child-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-A",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("可信终态清理后的迟到具名子 Stop 不得复用旧归属", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-1",
        event: "SubagentStart",
        sessionId: "child-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "TurnCompleted",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-1",
          event: "SubagentStop",
          sessionId: "child-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-A",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("相同 agentInstanceId 同时属于多个主 scope 时无 parent 的 Stop 不得猜测", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-shared",
        event: "SubagentStart",
        parentSessionId: "main-A",
        sessionId: "child-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        actorHint: "subagent",
        agent: "pi",
        agentInstanceId: "worker-shared",
        event: "SubagentStart",
        parentSessionId: "main-B",
        sessionId: "child-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-shared",
          event: "SubagentStop",
        })
      )
    ).toBe(false);
    expect(
      (agg.snapshot().activities[0] as AgentActivity | undefined)?.subagentCount
    ).toBe(2);
    agg.dispose();
  });

  it("子智能体显式 parentSessionId 不存在时不得回退到唯一主 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-B",
          event: "SubagentStart",
          parentSessionId: "main-B",
          sessionId: "child-B",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-A",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("子智能体无 parentSessionId 且存在多个主 scope 时不得猜 panel scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ agent: "pi", event: "PromptSubmit" })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          agentInstanceId: "worker-1",
          event: "SubagentStart",
          sessionId: "child-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-B",
      status: "processing",
      subagentCount: 0,
    });
    agg.dispose();
  });

  it("缺少 child sessionId 的子 SessionEnd 不得删除主活动", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "main-1" })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          event: "SessionEnd",
          parentSessionId: "main-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-1",
      status: "processing",
    });
    agg.dispose();
  });

  it("具名 child SessionEnd 无 child scope 时安全 no-op，不删除主活动", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "main-1" })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          event: "SessionEnd",
          parentSessionId: "main-1",
          sessionId: "child-1",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-1",
      status: "processing",
    });
    agg.dispose();
  });

  it("子 SessionEnd 的 child sessionId 与主 scope 碰撞时不得删除主活动", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "main-A" })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          event: "SessionEnd",
          parentSessionId: "main-A",
          sessionId: "main-A",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-A",
      status: "processing",
    });
    agg.dispose();
  });

  it("进程级多 scope 中子 SessionEnd 的编号碰撞也不得删除主 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "main-A",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "ToolStart",
        sessionId: "main-B",
        toolUseId: "tool-B",
      })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          agent: "pi",
          event: "SessionEnd",
          parentSessionId: "main-A",
          sessionId: "main-A",
        })
      )
    ).toBe(false);
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "SessionEnd",
        sessionId: "main-B",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "main-A",
      status: "processing",
    });
    agg.dispose();
  });

  it("子会话细节事件先到时不建父面板活动", () => {
    // 子会话 ToolStart 既不是父状态，也不是子会话计数边界；没有父层时必须丢弃，
    // 否则会凭空出现一个没有身份、看起来像主会话的活动行。
    const agg = createForegroundActivityAggregator({ now });
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          actorHint: "subagent",
          event: "ToolStart",
          parentSessionId: "main-1",
          sessionId: "sub-9",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("持久化规范标题水合会修正竞态留下的低优先级槽位", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "session-1" })
    );
    agg.setAgentSessionTitle("1", "p1", {
      sessionId: "session-1",
      source: "provider",
      title: "错误的自动标题",
    });

    agg.hydrateAgentSessionTitle("1", "p1", {
      sessionId: "session-1",
      source: "user",
      title: "磁盘中的用户标题",
    });

    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionTitle: "磁盘中的用户标题",
      sessionTitleSource: "user",
    });
    agg.dispose();
  });

  it("SessionStart 换会话：旧 sessionId 不得残留成错误身份", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({ event: "PromptSubmit", sessionId: "old-1" })
    );
    agg.ingestAgentEvent(agentHookEventV2({ event: "SessionStart" }));
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.sessionId).toBeUndefined();
    agg.dispose();
  });

  it("非进程作用域提供方的新主 SessionStart 退休旧 session scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        event: "ToolStart",
        sessionId: "old-session",
        toolUseId: "old-tool",
      })
    );

    agg.ingestAgentEvent(
      agentHookEventV2({
        event: "SessionStart",
        sessionId: "new-session",
      })
    );
    advance(250);

    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "new-session",
    });
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();
    agg.dispose();
  });

  it("launch 先验不带身份字段（没有 hook 事实可依据）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.sessionId).toBeUndefined();
    expect(a.actorHint).toBeUndefined();
    expect(a.parentSessionId).toBeUndefined();
    agg.dispose();
  });

  it("PromptSubmit → status=processing 立即可见", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    const snap = agg.snapshot();
    const a = snap.activities[0] as AgentActivity;
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("v1 PermissionRequest 兼容映射为 waiting", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("PermissionRequest"));
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("waiting");
    agg.dispose();
  });

  it("具名交互全部解除后才离开 waiting，并恢复仍在执行的工具", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "tool-1" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-2" })
    );

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "ask-1",
        interactionOutcome: "accepted",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "ask-2",
        interactionOutcome: "completed",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("未解除交互优先于随后开始的工具，解除后再投影 tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "tool-1" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "ask-1" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("InteractionRequested 是可建立 hook scope 的正向信号", () => {
    const agg = createForegroundActivityAggregator({ now });
    expect(
      agg.ingestAgentEvent(
        interactionEvent("InteractionRequested", {
          interactionId: "question-1",
          interactionKind: "question",
        })
      )
    ).toBe(true);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.dispose();
  });

  it("匿名交互支持计数，并可由首次出现 ID 的 resolved 兼容配对", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "late-interaction-id",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(interactionEvent("InteractionResolved"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("重复具名 InteractionResolved 不得再次消耗匿名交互", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "ask-1" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.ingestAgentEvent(interactionEvent("InteractionResolved"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("跨回合迟到的旧具名 InteractionResolved 不得消耗当前匿名交互", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", {
        interactionId: "old-ask",
      })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "old-ask" })
    );
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "old-ask" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(interactionEvent("InteractionResolved"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("跨回合旧匿名交互首次带 ID Resolved 不得消耗当前匿名交互", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "late-old-ask",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(interactionEvent("InteractionResolved"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("具名交互结算历史超过容量后旧 Resolved 不得消耗匿名交互", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (let index = 0; index < 257; index += 1) {
      const interactionId = `settled-ask-${index}`;
      agg.ingestAgentEvent(
        interactionEvent("InteractionRequested", { interactionId })
      );
      agg.ingestAgentEvent(
        interactionEvent("InteractionResolved", { interactionId })
      );
    }
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", {
        interactionId: "settled-ask-0",
      })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "settled-ask-0",
      })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "settled-ask-0",
      })
    );
    agg.ingestAgentEvent(interactionEvent("InteractionRequested"));

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "settled-ask-1",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(interactionEvent("InteractionResolved"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("新回合清理旧交互事实", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "old-ask" })
    );
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "new-ask" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "new-ask" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("可信终态清理交互并保持 ready", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(hookEvent("TurnCompleted"));

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("TTL 只标记陈旧，不清空未解除交互事实", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "old-ask" })
    );
    advance(30 * 60 * 1000);
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();

    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "new-ask" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "new-ask" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "old-ask" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("v1 PermissionRequest 兼容 waiting，但不伪造 v3 交互计数", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PermissionRequest"));
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", { interactionId: "ask-1" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("ToolStart → tool，最后一个 ToolComplete → processing", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "tool-1" })
    );
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "tool-1" })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("匿名工具：最后一个 ToolComplete 回落 processing，不粘在 tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("匿名 ToolStart 可由首次出现 ID 的 ToolComplete 配对", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "late-tool-id" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("重复具名 ToolComplete 不得再次消耗匿名工具", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "tool-1" })
    );
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "tool-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "tool-1" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("跨回合迟到的旧具名 ToolComplete 不得消耗当前匿名工具", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "old-tool" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "old-tool" })
    );
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));

    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "old-tool" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");

    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("跨回合旧匿名工具首次带 ID Complete 不得消耗当前匿名工具", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));

    agg.ingestAgentEvent(
      agentHookEvent({
        event: "ToolComplete",
        toolUseId: "late-old-tool",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");

    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("具名工具结算历史超过容量后旧 Complete 不得消耗匿名工具", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (let index = 0; index < 257; index += 1) {
      const toolUseId = `settled-tool-${index}`;
      agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart", toolUseId }));
      agg.ingestAgentEvent(
        agentHookEvent({ event: "ToolComplete", toolUseId })
      );
    }
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "settled-tool-0" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "settled-tool-0" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "settled-tool-0" })
    );
    agg.ingestAgentEvent(agentHookEvent({ event: "ToolStart" }));

    agg.ingestAgentEvent(
      agentHookEvent({
        event: "ToolComplete",
        toolUseId: "settled-tool-1",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");

    agg.ingestAgentEvent(agentHookEvent({ event: "ToolComplete" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("主 session TurnCompleted 后，无 sessionId 的迟到工具不得盖住 ready", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "main-session",
      }),
      { stopAuthority: "advisory" }
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "main-session",
        toolUseId: "t1",
      }),
      { stopAuthority: "advisory" }
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolComplete",
        sessionId: "main-session",
        toolUseId: "t1",
      }),
      { stopAuthority: "advisory" }
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "main-session",
      }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );

    // Cursor 部分 hook 丢 sessionId → 落入 panel 兜底 scope；不得把已结算
    // 主会话从 ready 拉回 tool/processing。
    advance(10);
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "cursor", event: "ToolStart" }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    advance(10);
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "cursor", event: "ToolComplete" }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  const cursorTurnA = "92c079e3-84b1-4982-8c8a-aaaaaaaaaaa1";
  const cursorTurnB = "e293da54-f249-4220-b8d1-bbbbbbbbbbb2";

  it.each([
    { terminal: "TurnCompleted", want: "ready" },
    { terminal: "TurnInterrupted", want: "ready" },
    { terminal: "error", want: "error" },
  ] as const)("同 turnId 不同 sessionId 的工具事件并入 PromptSubmit 账本，$terminal 后不为 processing", ({
    terminal,
    want,
  }) => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolComplete",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    expect((agg.snapshot().activities[0] as AgentActivity).sessionId).toBe(
      "prompt-session"
    );

    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: terminal,
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(want);

    advance(10);
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolComplete",
        sessionId: "stale-tool-session",
        toolUseId: "late-same-turn",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(want);
    agg.dispose();
  });

  it("不同 turnId 的并行会话不随另一会话终态封账", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "chat-a",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "chat-b",
        turnId: cursorTurnB,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "chat-b",
        toolUseId: "other-tool",
        turnId: cursorTurnB,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");

    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "chat-a",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("短 turnId 的空终态不扩散到其它已提问 session", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: "gen-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "peer-session",
        turnId: "gen-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "peer-session",
        toolUseId: "shell-1",
        turnId: "gen-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "prompt-session",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("先落到错误 session 的工具仍能被对侧终态封账", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("transcript 空 turnId 终态回退 origin.currentTurnId 封账对侧", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "prompt-session",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("主会话可信终态封掉未见过提问的子智能体独立 conversation", () => {
    const agg = createForegroundActivityAggregator({ now });
    const subagentSession = "6597f476-e166-4d4c-a12b-838d579191dc";
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: subagentSession,
        toolUseId: "read-1",
        turnId: subagentSession,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolComplete",
        sessionId: subagentSession,
        toolUseId: "read-1",
        turnId: subagentSession,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("主会话空终态仍封掉未见过提问的衍生账本", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "prompt-session",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("origin 未见过提问时，可信终态不封其它 promptless 账", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "processing",
        sessionId: "silent-session",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "silent-session",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("进程级并行会话的不同 messageId 互不改写", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "opencode",
        event: "PromptSubmit",
        sessionId: "thread-a",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "opencode",
        event: "PromptSubmit",
        sessionId: "thread-b",
        turnId: cursorTurnB,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "opencode",
        event: "ToolStart",
        sessionId: "thread-b",
        toolUseId: "call-b",
        turnId: cursorTurnB,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "opencode",
        event: "TurnCompleted",
        sessionId: "thread-a",
        turnId: cursorTurnA,
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("进程级并行会话的短 turnId 不互相封账", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "amp",
        event: "PromptSubmit",
        sessionId: "thread-a",
        turnId: "1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "amp",
        event: "PromptSubmit",
        sessionId: "thread-b",
        turnId: "1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "amp",
        event: "ToolStart",
        sessionId: "thread-b",
        toolUseId: "call-b",
        turnId: "1",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "amp",
        event: "TurnCompleted",
        sessionId: "thread-a",
        turnId: "1",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("stale SessionEnd 不得挡住已认领 turn 的工具事件", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEvent({
          agent: "cursor",
          event: "SessionEnd",
          sessionId: "stale-tool-session",
        })
      )
    ).toBe(false);
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    const afterStaleEnd = agg.snapshot().activities[0] as AgentActivity;
    expect(afterStaleEnd.status).toBe("tool");
    expect(afterStaleEnd.sessionId).toBe("prompt-session");
    agg.dispose();
  });

  it("stale running 不得抢占 PromptSubmit 认领", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "prompt-session",
        turnId: cursorTurnA,
      })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "running",
        sessionId: "stale-tool-session",
        turnId: cursorTurnA,
      })
    );
    const afterRunning = agg.snapshot().activities[0] as AgentActivity;
    expect(afterRunning.status).toBe("processing");
    expect(afterRunning.sessionId).toBe("prompt-session");
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "ToolStart",
        sessionId: "stale-tool-session",
        toolUseId: "shell-1",
        turnId: cursorTurnA,
      })
    );
    const afterTool = agg.snapshot().activities[0] as AgentActivity;
    expect(afterTool.status).toBe("tool");
    expect(afterTool.sessionId).toBe("prompt-session");
    agg.dispose();
  });

  it("主 session 结算后，无 sessionId 的新 PromptSubmit 仍可开新回合", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "PromptSubmit",
        sessionId: "main-session",
      }),
      { stopAuthority: "advisory" }
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "cursor",
        event: "TurnCompleted",
        sessionId: "main-session",
      }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );

    advance(10);
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "cursor", event: "PromptSubmit" }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("并发工具按 toolUseId 幂等记账，全部完成后才离开 tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "a" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "b" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "a" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "a" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolComplete", toolUseId: "b" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("advisory Stop 不谎报 ready，后续 ToolStart 恢复为 tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("Stop"), { stopAuthority: "advisory" });
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBeUndefined();
    agg.ingestAgentEvent(hookEvent("ToolStart"), {
      stopAuthority: "advisory",
    });
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.dispose();
  });

  it("transcript 问卷覆盖在 TurnInterrupted 后仍保持 waiting", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", {
        interactionId: "cq:1",
        interactionKind: "question",
      }),
      { evidenceSource: "transcript" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.ingestAgentEvent(hookEvent("TurnInterrupted"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.dispose();
  });

  it("封账后的 transcript 问卷解除仍摘掉等待确认", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", {
        interactionId: "cq:1",
        interactionKind: "question",
      }),
      { evidenceSource: "transcript" }
    );
    agg.ingestAgentEvent(hookEvent("TurnInterrupted"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    expect(
      agg.ingestAgentEvent(
        interactionEvent("InteractionResolved", {
          interactionId: "cq:1",
          interactionKind: "question",
          interactionOutcome: "completed",
        }),
        { evidenceSource: "transcript" }
      )
    ).toBe(true);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("transcript 问卷覆盖不被 Cursor 普通 ToolStart 揭掉", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", {
        interactionId: "cq:1",
        interactionKind: "question",
      }),
      { evidenceSource: "transcript" }
    );
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.ingestAgentEvent(
      interactionEvent("InteractionResolved", {
        interactionId: "cq:1",
        interactionKind: "question",
        interactionOutcome: "completed",
      }),
      { evidenceSource: "transcript" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("TurnInterrupted 后 InteractionRequested 仍恢复 waiting", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("TurnInterrupted"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );

    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.dispose();
  });

  it("advisory Stop 后 InteractionRequested 恢复 waiting", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("Stop"), { stopAuthority: "advisory" });

    agg.ingestAgentEvent(
      interactionEvent("InteractionRequested", { interactionId: "ask-1" }),
      { stopAuthority: "advisory" }
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );
    agg.dispose();
  });

  it("none Stop 整条丢弃，不得借 canonical 名称制造 ready", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));

    expect(
      agg.ingestAgentEvent(hookEvent("Stop"), { stopAuthority: "none" })
    ).toBe(false);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it.each([
    "TurnCompleted",
    "TurnInterrupted",
  ])("%s 可信终态不被迟到 advisory Stop 降级", (terminalEvent) => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-settled" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: terminalEvent, turnId: "turn-settled" })
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEvent({ event: "Stop", turnId: "turn-settled" }),
        { stopAuthority: "advisory" }
      )
    ).toBe(false);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it.each([
    "TurnCompleted",
    "TurnInterrupted",
  ])("advisory 集成经安装期分发送达的 %s 仍是可信终态（cursor stop.status 路径）", (terminalEvent) => {
    const agg = createForegroundActivityAggregator({ now });
    const cursorEvent = (
      event: string,
      toolUseId?: string
    ): AgentHookEventPayload => ({
      ...agentHookEvent({ event, toolUseId }),
      agent: "cursor",
    });
    agg.ingestAgentEvent(cursorEvent("PromptSubmit"), {
      stopAuthority: "advisory",
    });
    // preToolUse/postToolUse 带真实 tool_use_id（shell/MCP 闸门事件不装）
    agg.ingestAgentEvent(cursorEvent("ToolStart", "tool-1"), {
      stopAuthority: "advisory",
    });
    agg.ingestAgentEvent(cursorEvent("ToolComplete", "tool-1"), {
      stopAuthority: "advisory",
    });
    agg.ingestAgentEvent(cursorEvent(terminalEvent), {
      stopAuthority: "advisory",
    });
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("生命周期诊断记录转换来源与退休计数且不记录正文", () => {
    const records: LogRecord[] = [];
    setDefaultLogSink((record) => records.push(record));
    const agg = createForegroundActivityAggregator({ now });
    const sensitivePrompt = "SENSITIVE_PROMPT";
    const sensitiveToolId = "SENSITIVE_TOOL_ID";
    const sensitiveTranscriptPath = "/private/transcript.jsonl";
    const base = {
      metadataBase64: Buffer.from(sensitivePrompt).toString("base64"),
      sessionId: "session-log",
      transcriptPath: sensitiveTranscriptPath,
      turnId: "turn-log",
    };
    const hookOptions: AgentEventIngestOptions = {
      evidenceSource: "hook",
      stopAuthority: "advisory",
      turnStartAuthority: "none",
    };
    agg.ingestAgentEvent(
      agentHookEventV3({
        ...base,
        event: "PromptSubmit",
        nativeEvent: "UserPromptSubmit",
        promptSnippet: sensitivePrompt,
      }),
      hookOptions
    );
    agg.ingestAgentEvent(
      agentHookEventV3({ ...base, event: "Stop", nativeEvent: "Stop" }),
      hookOptions
    );
    agg.ingestAgentEvent(
      agentHookEventV3({
        ...base,
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        toolUseId: sensitiveToolId,
      }),
      hookOptions
    );
    agg.ingestAgentEvent(
      agentHookEventV3({
        ...base,
        event: "TurnCompleted",
        nativeEvent: "codex.transcript.task_complete",
      }),
      {
        evidenceSource: "transcript",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      }
    );

    const trustedRecord = records.find(
      (record) => record.msg === "agent-terminal-trusted"
    );
    expect(trustedRecord?.ctx).toMatchObject({
      category: "terminal-trusted",
      evidenceSource: "transcript",
      nativeEvent: "codex.transcript.task_complete",
      transition: "terminal-trusted",
      terminalRetiredWork: {
        interactionCount: 0,
        subagentCount: 0,
        toolCount: 1,
      },
    });
    expect(records.map((record) => record.msg)).toEqual(
      expect.arrayContaining([
        "agent-turn-started",
        "agent-terminal-candidate",
        "agent-terminal-trusted",
        "agent-ready-derived",
      ])
    );
    expect(JSON.stringify(records)).not.toContain(sensitiveToolId);
    expect(JSON.stringify(records)).not.toContain(sensitivePrompt);
    expect(JSON.stringify(records)).not.toContain(sensitiveTranscriptPath);
    expect(JSON.stringify(records)).not.toContain(base.metadataBase64);
    agg.dispose();
  });

  it("封账拒绝日志记录有限原因和来源且不改变快照或广播", () => {
    const records: LogRecord[] = [];
    const broadcasts: unknown[] = [];
    setDefaultLogSink((record) => records.push(record));
    const agg = createForegroundActivityAggregator({ now });
    const options: AgentEventIngestOptions = {
      evidenceSource: "hook",
      stopAuthority: "authoritative",
      turnStartAuthority: "none",
    };
    const unsubscribe = agg.onChange((broadcast) => broadcasts.push(broadcast));
    agg.ingestAgentEvent(
      agentHookEventV3({
        event: "PromptSubmit",
        nativeEvent: "UserPromptSubmit",
        turnId: "turn-sealed",
      }),
      options
    );
    agg.ingestAgentEvent(
      agentHookEventV3({
        event: "TurnCompleted",
        nativeEvent: "TaskComplete",
        turnId: "turn-sealed",
      }),
      options
    );
    advance(110);
    const snapshotBefore = agg.snapshot();
    const broadcastsBefore = broadcasts.length;

    expect(
      agg.ingestAgentEvent(
        agentHookEventV3({
          event: "processing",
          nativeEvent: "session.status=busy",
        }),
        options
      )
    ).toBe(false);
    advance(110);

    expect(agg.snapshot().activities).toEqual(snapshotBefore.activities);
    expect(broadcasts).toHaveLength(broadcastsBefore);
    expect(
      records.find((record) => record.ctx?.reason === "sealed-turn")?.ctx
    ).toMatchObject({
      evidenceSource: "hook",
      nativeEvent: "session.status=busy",
      reason: "sealed-turn",
    });
    unsubscribe();
    agg.dispose();
  });

  it("无 Stop 权威时由记账器给出有限拒绝原因", () => {
    const records: LogRecord[] = [];
    setDefaultLogSink((record) => records.push(record));
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));

    expect(
      agg.ingestAgentEvent(hookEvent("Stop"), {
        stopAuthority: "none",
      })
    ).toBe(false);
    expect(
      records.find((record) => record.ctx?.reason === "stop-without-authority")
        ?.ctx
    ).toMatchObject({
      evidenceSource: "hook",
      nativeEvent: "Stop",
      reason: "stop-without-authority",
    });
    agg.dispose();
  });

  it.each([
    { expectedStatus: "ready", terminalEvent: "TurnCompleted" },
    { expectedStatus: "error", terminalEvent: "error" },
  ])("$terminalEvent 终态诊断只记录被退休工作计数，不记录工具标识", ({
    expectedStatus,
    terminalEvent,
  }) => {
    const records: LogRecord[] = [];
    setDefaultLogSink((record) => records.push(record));
    const agg = createForegroundActivityAggregator({ now });
    const sensitiveToolId = "SENSITIVE_TOOL_ID";
    const base = {
      sessionId: "session-terminal-retirement",
      turnId: "turn-terminal-retirement",
    };
    agg.ingestAgentEvent(agentHookEvent({ ...base, event: "PromptSubmit" }));
    agg.ingestAgentEvent(
      agentHookEvent({
        ...base,
        event: "ToolStart",
        toolUseId: sensitiveToolId,
      })
    );
    agg.ingestAgentEvent(agentHookEvent({ ...base, event: terminalEvent }));

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      expectedStatus
    );
    expect(
      records.find((record) => record.msg === "agent-terminal-trusted")?.ctx
    ).toMatchObject({
      terminalRetiredWork: {
        interactionCount: 0,
        subagentCount: 0,
        toolCount: 1,
      },
    });
    expect(JSON.stringify(records)).not.toContain(sensitiveToolId);
    agg.dispose();
  });

  it("同 scope 重复 SessionStart 幂等，不清空正在执行的工具事实", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "session-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        event: "ToolStart",
        sessionId: "session-1",
        toolUseId: "tool-1",
      })
    );

    agg.ingestAgentEvent(
      agentHookEvent({ event: "SessionStart", sessionId: "session-1" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("新 scope 的 SessionStart 后可直接接收 ToolStart", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("Cline TaskComplete 后 TaskResume 可开始新的工具回合", () => {
    const agg = createForegroundActivityAggregator({ now });
    const clineEvent = (
      event: string,
      extra: Partial<AgentHookEventPayloadV1> = {}
    ): AgentHookEventPayload => ({
      agent: "cline",
      event,
      kind: "agentEvent",
      panelId: "p1",
      v: 1,
      windowId: "1",
      ...extra,
    });
    agg.ingestAgentEvent(clineEvent("SessionStart"));
    agg.ingestAgentEvent(clineEvent("ToolStart", { toolUseId: "t1" }));
    agg.ingestAgentEvent(clineEvent("ToolComplete", { toolUseId: "t1" }));
    agg.ingestAgentEvent(clineEvent("Stop"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );

    agg.ingestAgentEvent(clineEvent("running"), {
      turnStartAuthority: "authoritative",
    });
    agg.ingestAgentEvent(clineEvent("ToolStart", { toolUseId: "t2" }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it.each([
    "ToolStart",
    "PermissionRequest",
    "error",
    "SubagentStart",
  ])("拒绝旧 turn 的 %s 污染当前 turn", (event) => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-2" })
    );

    expect(
      agg.ingestAgentEvent(agentHookEvent({ event, turnId: "turn-1" }))
    ).toBe(false);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    agg.dispose();
  });

  it("TurnInterrupted → ready，并吸收迟到的工具完成事件", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    agg.ingestAgentEvent(hookEvent("TurnInterrupted"));
    let activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("ready");
    agg.ingestAgentEvent(hookEvent("ToolComplete"));
    activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("ready");
    agg.dispose();
  });

  it("TurnCompleted → ready，并吸收迟到的工具事件", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-complete" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "TurnCompleted", turnId: "turn-complete" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", toolUseId: "late-tool" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("TurnCompleted 到达时立即封账，并吸收未完成工具的迟到收尾", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-complete" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({
        event: "ToolStart",
        toolUseId: "still-running",
        turnId: "turn-complete",
      })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");

    agg.ingestAgentEvent(
      agentHookEvent({ event: "TurnCompleted", turnId: "turn-complete" })
    );
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );

    expect(
      agg.ingestAgentEvent(
        agentHookEvent({
          event: "ToolComplete",
          toolUseId: "still-running",
          turnId: "turn-complete",
        })
      )
    ).toBe(false);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "ready"
    );
    agg.dispose();
  });

  it("旧 turn 的迟到 TurnInterrupted 不会冻结当前回合", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", turnId: "turn-2" })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEvent({ event: "TurnInterrupted", turnId: "turn-1" })
      )
    ).toBe(false);
    let activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("processing");
    agg.ingestAgentEvent(
      agentHookEvent({
        event: "ToolStart",
        toolUseId: "tool-2",
        turnId: "turn-2",
      })
    );
    activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("tool");
    agg.dispose();
  });

  it("SessionEnd → activity 删除, 1500ms 短冷却拦迟到事件", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内迟到 Stop 被吞
    agg.ingestAgentEvent(hookEvent("Stop"));
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(1501);
    // 冷却过期后 SessionStart 豁免冷却重建
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("Pi 扩展运行时: 单个 pid SessionEnd 不清掉仍活跃的同 panel pid", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "SessionStart", pid: 1001 })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "PromptSubmit", pid: 1001 })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "SessionStart", pid: 1002 })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "PromptSubmit", pid: 1002 })
    );
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.agentId).toBe("pi");
    expect(a.status).toBe("processing");

    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "Stop", pid: 1001 })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "SessionEnd", pid: 1001 })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.agentId).toBe("pi");
    expect(a.status).toBe("processing");

    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "Stop", pid: 1002 })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("ready");
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "SessionEnd", pid: 1002 })
    );
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("A scope 删除且冷却过期后，迟到 ToolComplete 不得借 B layer 重建 A", () => {
    const agg = createForegroundActivityAggregator({ now });
    for (const sessionId of ["session-A", "session-B"]) {
      agg.ingestAgentEvent(
        agentHookEventV2({
          agent: "pi",
          event: "PromptSubmit",
          sessionId,
        })
      );
    }
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          agent: "pi",
          event: "SessionEnd",
          sessionId: "session-A",
        })
      )
    ).toBe(true);
    advance(1501);

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          agent: "pi",
          event: "ToolComplete",
          sessionId: "session-A",
          toolUseId: "late-tool-A",
        })
      )
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-B",
      status: "processing",
    });
    agg.dispose();
  });

  it("未知 scope 的 InteractionResolved 不得借已有 B layer 建立 A", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "session-B",
      })
    );

    expect(
      agg.ingestAgentEvent({
        ...interactionEvent("InteractionResolved", {
          interactionId: "late-ask-A",
        }),
        agent: "pi",
        sessionId: "session-A",
      })
    ).toBe(false);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-B",
      status: "processing",
    });
    agg.dispose();
  });

  it.each(
    scopeCreatingEventCases
  )("不存在的隔离 scope 可由正向 %s 建立", (_eventName, event) => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "session-B",
      })
    );

    expect(agg.ingestAgentEvent(event)).toBe(true);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-A",
    });
    agg.dispose();
  });

  it("SessionStart 可正常建立新 scope，后续非创建事件复用该 scope", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "session-B",
      })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          agent: "pi",
          event: "SessionStart",
          sessionId: "session-A",
        })
      )
    ).toBe(true);

    expect(
      agg.ingestAgentEvent(
        agentHookEventV2({
          agent: "pi",
          event: "ToolComplete",
          sessionId: "session-A",
          toolUseId: "tool-A",
        })
      )
    ).toBe(true);
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-A",
      status: "processing",
    });
    agg.dispose();
  });

  it("进程级多 scope 切换投影时同步切换 scope-local identity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "PromptSubmit",
        sessionId: "session-1",
      })
    );
    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "ToolStart",
        sessionId: "session-2",
        toolUseId: "tool-2",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-2",
      status: "tool",
    });

    agg.ingestAgentEvent(
      agentHookEventV2({
        agent: "pi",
        event: "SessionEnd",
        sessionId: "session-2",
      })
    );
    expect(agg.snapshot().activities[0]).toMatchObject({
      sessionId: "session-1",
      status: "processing",
    });
    agg.dispose();
  });

  it("sessionId 优先于 pid: 结束一个 session 不清掉同 panel 另一个 session", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", pid: 1001, sessionId: "s1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", pid: 1002, sessionId: "s2" })
    );
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");

    agg.ingestAgentEvent(
      agentHookEvent({ event: "SessionEnd", pid: 1001, sessionId: "s1" })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");

    agg.ingestAgentEvent(
      agentHookEvent({ event: "SessionEnd", pid: 1002, sessionId: "s2" })
    );
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("旧 session 的重复 SessionEnd 不会被当作当前会话终态", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "old" })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEvent({ event: "SessionEnd", sessionId: "old" })
      )
    ).toBe(true);
    advance(1501);
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "current" })
    );
    expect(
      agg.ingestAgentEvent(
        agentHookEvent({ event: "SessionEnd", sessionId: "old" })
      )
    ).toBe(false);
    const activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("processing");
    agg.dispose();
  });

  it("Codex/Claude shell hook pid 不作为会话身份", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "PromptSubmit", pid: 2001 })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "Stop", pid: 2002 }),
      { stopAuthority: "advisory" }
    );
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBeUndefined();

    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "ToolStart", pid: 2003 })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "SessionEnd", pid: 2004 })
    );
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("扩展运行时事件缺 pid 且无 sessionId 时回退到 panel 级收尾", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "pi", event: "PromptSubmit" })
    );
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestAgentEvent(agentHookEvent({ agent: "pi", event: "SessionEnd" }));
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("ingestCommandStarted with agent match → 250ms 后 launch-source agent activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "codex --resume", "codex");
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    expect(a.status).toBeUndefined();
    agg.dispose();
  });

  it("ingestCommandStarted with no agent match → shell activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls -la", null);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0];
    expect(a?.kind).toBe("shell");
    if (a?.kind === "shell") {
      expect(a.commandLine).toBe("ls -la");
    }
    agg.dispose();
  });

  it("ingestCommandFinished 正常退出 → 清活动, hook 冷却只拦迟到 hook 不拦新命令", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 相邻命令 <5s：新 OSC 证据不受 hook 冷却拦截, 立即可见
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 命令收尾后迟到 hook（ToolStart 属 SESSION_CREATING）5s 内被拦
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却过期后 PromptSubmit 重建 hook 会话
    advance(5001);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("ingestCommandFinished 悬挂退出码 (147) → 保留活动（Ctrl+Z）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 147);
    // 悬挂不视为 agent 退出
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("taskLaunched / taskFinished → task occupation pointer", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "npm build",
      runId: "run-1",
    });
    const a = agg.snapshot().activities[0] as TaskActivity;
    expect(a.kind).toBe("task");
    expect(a.label).toBe("npm build");
    expect("status" in a).toBe(false);
    agg.taskFinished("p1", { runId: "run-1" });
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("跨窗口同 panelId 的 taskFinished 只清除目标窗口", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("same-panel", "w-1", {
      label: "one",
      runId: "run-1",
      taskId: "task-1",
    });
    agg.taskLaunched("same-panel", "w-2", {
      label: "two",
      runId: "run-2",
      taskId: "task-2",
    });

    agg.taskFinished("same-panel", { runId: "run-1" }, "w-1");

    expect(agg.snapshot("w-1").activities).toHaveLength(0);
    expect(agg.snapshot("w-2").activities[0]).toMatchObject({
      label: "two",
      runId: "run-2",
      windowId: "w-2",
    });
    agg.dispose();
  });

  it("taskLaunched 覆盖已有 agent activity（用户显式操作优先）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    expect((agg.snapshot().activities[0] as AgentActivity).kind).toBe("agent");
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "npm build",
      runId: "run-1",
    });
    const a = agg.snapshot().activities[0];
    expect(a?.kind).toBe("task");
    agg.dispose();
  });

  it("ignores a late finish from the run replaced in the same panel", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      label: "old",
      runId: "run-1",
      taskId: "t1",
    });
    agg.taskLaunched("p1", "1", {
      label: "new",
      runId: "run-2",
      taskId: "t1",
    });

    agg.taskFinished("p1", {
      runId: "run-1",
    });

    expect(agg.snapshot().activities[0]).toMatchObject({
      kind: "task",
      label: "new",
      runId: "run-2",
    });
    agg.dispose();
  });

  it("panelClosed 清活动 + 5s 冷却拦迟到 hook", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内孤儿事件被吸收
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(5001);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("retainPanels 只清不在集合内的面板", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "1"));
    expect(agg.snapshot().activities).toHaveLength(2);
    agg.retainPanels("1", ["p1"]);
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.panelId).toBe("p1");
    agg.dispose();
  });

  it("windowClosed 清空该窗口保留其他窗口", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "2"));
    agg.windowClosed("1");
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.windowId).toBe("2");
    agg.dispose();
  });

  it("hook TTL 30min → 清除不再可信的 agent status", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("processing");
    advance(30 * 60 * 1000);
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBeUndefined();
    expect(a.updatedAt).toBe(0);
    agg.dispose();
  });

  it("多 scope 投影优先当前执行事实，旧 error 不遮住新 tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "error", sessionId: "session-error" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", sessionId: "session-tool" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe("tool");
    agg.dispose();
  });

  it("多 scope 同状态切换不重置公共 stateStartedAt", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "session-1" })
    );
    advance(100);
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "session-2" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).stateStartedAt).toBe(
      0
    );
    agg.dispose();
  });

  it("主导 scope 删除导致公共状态变化时从删除时刻重新计时", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(
      agentHookEvent({ event: "PromptSubmit", sessionId: "session-processing" })
    );
    advance(100);
    agg.ingestAgentEvent(
      agentHookEvent({ event: "ToolStart", sessionId: "session-tool" })
    );
    advance(100);

    agg.ingestAgentEvent(
      agentHookEvent({ event: "SessionEnd", sessionId: "session-tool" })
    );

    const activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBe("processing");
    expect(activity.stateStartedAt).toBe(200);
    agg.dispose();
  });

  it("broadcast ts 严格单调（pull/push 同毫秒竞态不可能并列）", () => {
    const agg = createForegroundActivityAggregator({ now });
    const seen: number[] = [];
    agg.onChange((b) => seen.push(b.ts));
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    vi.advanceTimersByTime(100);
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    vi.advanceTimersByTime(100);
    agg.panelClosed("p1");
    vi.advanceTimersByTime(100);
    for (let i = 1; i < seen.length; i += 1) {
      const cur = seen[i];
      const prev = seen[i - 1];
      if (cur === undefined || prev === undefined) {
        throw new Error("undefined broadcast ts");
      }
      expect(cur).toBeGreaterThan(prev);
    }
    agg.dispose();
  });

  it("cooldown 期间同 key 事件不重建", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.panelClosed("p1");
    for (let i = 0; i < 5; i += 1) {
      agg.ingestAgentEvent(hookEvent("ToolStart"));
    }
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("SubagentStart / SubagentStop 只计数, 不改父状态", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(hookEvent("SubagentStart"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.subagentCount).toBe(1);
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(hookEvent("SubagentStop"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.subagentCount).toBe(0);
    expect(a.status).toBe("tool");
    agg.dispose();
  });

  it("advisory Stop 后 SubagentStart / Stop 只计数，不恢复主状态", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("Stop"), { stopAuthority: "advisory" });
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();

    agg.ingestAgentEvent(hookEvent("SubagentStart"), {
      stopAuthority: "advisory",
    });
    let activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBeUndefined();
    expect(activity.subagentCount).toBe(1);

    agg.ingestAgentEvent(hookEvent("SubagentStop"), {
      stopAuthority: "advisory",
    });
    activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBeUndefined();
    expect(activity.subagentCount).toBe(0);
    agg.dispose();
  });

  it("TTL stale 后 SubagentStart / Stop 只更新时间和计数，不清除 stale", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    advance(30 * 60 * 1000);
    expect(
      (agg.snapshot().activities[0] as AgentActivity).status
    ).toBeUndefined();

    agg.ingestAgentEvent(hookEvent("SubagentStart"));
    let activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBeUndefined();
    expect(activity.subagentCount).toBe(1);

    agg.ingestAgentEvent(hookEvent("SubagentStop"));
    activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.status).toBeUndefined();
    expect(activity.subagentCount).toBe(0);
    agg.dispose();
  });

  it("子代理按 agentInstanceId 幂等记账，重复事件不漂移", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStart", agentInstanceId: "worker-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStart", agentInstanceId: "worker-1" })
    );
    let activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.subagentCount).toBe(1);
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStop", agentInstanceId: "worker-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStop", agentInstanceId: "worker-1" })
    );
    activity = agg.snapshot().activities[0] as AgentActivity;
    expect(activity.subagentCount).toBe(0);
    agg.dispose();
  });

  it("匿名 SubagentStart 可由首次出现 ID 的 SubagentStop 配对", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(agentHookEvent({ event: "SubagentStart" }));
    agg.ingestAgentEvent(
      agentHookEvent({
        event: "SubagentStop",
        agentInstanceId: "late-subagent-id",
      })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).subagentCount).toBe(
      0
    );
    agg.dispose();
  });

  it("重复具名 SubagentStop 不得再次消耗匿名子智能体", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStart", agentInstanceId: "worker-1" })
    );
    agg.ingestAgentEvent(agentHookEvent({ event: "SubagentStart" }));
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStop", agentInstanceId: "worker-1" })
    );
    agg.ingestAgentEvent(
      agentHookEvent({ event: "SubagentStop", agentInstanceId: "worker-1" })
    );

    expect((agg.snapshot().activities[0] as AgentActivity).subagentCount).toBe(
      1
    );
    agg.ingestAgentEvent(agentHookEvent({ event: "SubagentStop" }));
    expect((agg.snapshot().activities[0] as AgentActivity).subagentCount).toBe(
      0
    );
    agg.dispose();
  });

  it("snapshot(windowId) 过滤只返回该窗口 activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "2"));
    expect(agg.snapshot("1").activities).toHaveLength(1);
    expect(agg.snapshot("1").activities[0]?.windowId).toBe("1");
    expect(agg.snapshot("2").activities).toHaveLength(1);
    agg.dispose();
  });

  it("相同 panelId 在不同窗口使用独立 slot", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "shared", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "shared", "2"));
    expect(agg.snapshot().activities).toHaveLength(2);

    agg.panelClosed("shared", "1");
    const remaining = agg.snapshot().activities;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.panelId).toBe("shared");
    expect(remaining[0]?.windowId).toBe("2");
    agg.dispose();
  });

  it("回归: 迟到 ToolComplete 不销毁已有 shell activity (acquireHookAgentEntry 顺序)", () => {
    const agg = createForegroundActivityAggregator({ now });
    // shell activity 先存在
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities[0]?.kind).toBe("shell");
    // 迟到的 ToolComplete (非 SESSION_CREATING) 不应销毁 shell
    agg.ingestAgentEvent(hookEvent("ToolComplete"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: 迟到 Stop 不销毁 task activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "npm build",
      runId: "run-1",
    });
    agg.ingestAgentEvent(hookEvent("Stop"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("task");
    agg.dispose();
  });

  it("回归: agentLaunched 异 agent 清 hook 层 → 投影为新 agent launch", () => {
    const agg = createForegroundActivityAggregator({ now });
    // 建立 hook agent activity (claude) + tool status
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    const before = agg.snapshot().activities[0] as AgentActivity;
    expect(before.status).toBe("tool");
    expect(before.agentId).toBe("claude");
    // 异 agent 启动 → 旧 hook 证据作废 (clearAgentHookActivitiesBySession)
    agg.agentLaunched("1", "p1", "codex");
    // hook 层已清, 新 launch 层 250ms 消抖内隐藏 → 无 activity
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const after = agg.snapshot().activities[0] as AgentActivity;
    expect(after.kind).toBe("agent");
    expect(after.source).toBe("launch");
    expect(after.agentId).toBe("codex");
    expect(after.status).toBeUndefined();
    agg.dispose();
  });

  it("回归: agentLaunched 同 agent 保留 hook 层 (证据与 TTL 不被 relaunch 清除)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    // 同 agent 重启（如 claude --resume）→ hook 证据延续, 不清层
    agg.agentLaunched("1", "p1", "claude");
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.agentId).toBe("claude");
    expect(a.status).toBe("tool");
    // hook TTL 不因 relaunch 重置：30min 静默照常清除不再可信的状态
    advance(30 * 60 * 1000);
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.status).toBeUndefined();
    agg.dispose();
  });

  it("回归: taskFinished 清除占用, rerun(taskLaunched) 重建指针", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-1",
    });
    agg.taskFinished("p1", { runId: "run-1" });
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-2",
    });
    const a = agg.snapshot().activities[0] as TaskActivity;
    expect(a.runId).toBe("run-2");
    agg.dispose();
  });

  it("回归: shell 冷却期内新命令被拦截 (panelClosed 后 5s 内 ingestCommandStarted)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内新 shell 命令被拦
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(5001);
    agg.ingestCommandStarted("p1", "1", "ps", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: panelClosed 后 5s 内 SessionStart 不得重建 (panel 死亡冷却不豁免)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 幽灵防复活：panel 冷却期内 SessionStart 也被拦（过消抖窗仍无 activity）
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(0);
    // panel 冷却过期后 SessionStart 才能重建
    advance(4751);
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("回归: SessionEnd 后 1.5s 内新 shell 命令立即可见 (hook 冷却不拦命令)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // hook 收尾冷却只 gate hook 层——新 shell 命令是新鲜 OSC 证据
    agg.ingestCommandStarted("p1", "1", "ls -la", null);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: windowClosed 清已完成 task activity (无幽灵复活)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-1",
    });
    agg.taskFinished("p1", { runId: "run-1" });
    agg.windowClosed("1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // advance 后不应有幽灵 emit / 状态复活
    advance(6000);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: commandStart/Finished hook stub 无副作用 no-op (保 discriminated union)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    // stub 通道不应改变 activity 状态
    agg.ingestCommandStartHook({
      v: 1,
      kind: "commandStart",
      panelId: "p1",
      windowId: "1",
      commandLine: "test",
    });
    agg.ingestCommandFinishedHook({
      v: 1,
      kind: "commandFinished",
      panelId: "p1",
      windowId: "1",
      exitCode: 0,
    });
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.kind).toBe("agent");
    agg.dispose();
  });

  it("回归: omp update → agent match 250ms 后可见且无 status, 正常退出清空", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "omp update", "omp");
    // 消抖期内隐藏
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("omp");
    expect(a.source).toBe("launch");
    expect(a.status).toBeUndefined();
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: 瞬时命令不闪条 — 消抖期内退出全程不可见, 消抖 timer 不复活", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(200);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 消抖 timer 不得在层清除后复活条目
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("hook 证据优先于 launch 先验: PromptSubmit 立即可见并压过消抖中的 launch", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "PromptSubmit" })
    );
    // hook 证据立即显形, 无须等 launch 消抖
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    expect(a.status).toBe("processing");
    expect(a.agentId).toBe("codex");
    agg.dispose();
  });

  it("回归: 明确前台 agent 命令拒绝异 agent hook 抢占归属", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("launch");
    expect(a.agentId).toBe("codex");

    agg.ingestAgentEvent(
      agentHookEvent({
        agent: "claude",
        event: "SessionStart",
        sessionId: "foreign",
      })
    );
    advance(250);
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("launch");
    expect(a.agentId).toBe("codex");
    expect(a.status).toBeUndefined();

    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "PromptSubmit" })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.agentId).toBe("codex");
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("回归: 异 agent SessionEnd 不清当前前台 agent 活动", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    agg.ingestAgentEvent(
      agentHookEvent({ agent: "codex", event: "PromptSubmit" })
    );
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.agentId).toBe("codex");
    expect(a.status).toBe("processing");

    agg.ingestAgentEvent(
      agentHookEvent({ agent: "claude", event: "SessionEnd" })
    );
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.agentId).toBe("codex");
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("回归: fg 不摧毁挂起会话 — Ctrl+Z 后 shell 命令只盖 command 层", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    // Ctrl+Z 悬挂：双层保留
    agg.ingestCommandFinished("p1", 147);
    // `fg`（无 agent match）只覆盖 command 层, hook 证据保留
    agg.ingestCommandStarted("p1", "1", "fg", null);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("SessionEnd clears matching launch activity so ended agents do not block quit", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "claude");
    advance(250);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("task 压住 hook 投影: task 在场时 hook 事件仍建 hook 层但投影为 task", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "npm build",
      runId: "run-1",
    });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("task");
    agg.dispose();
  });

  it("回归: taskFinished 后 ptyExited 不再保留 task 占用", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-1",
    });
    agg.taskFinished("p1", { runId: "run-1" });
    agg.ptyExited("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: crash 顺序容忍 — ptyExited 先于 taskFinished 到达时 task 层保留到 clear", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-1",
    });
    agg.ptyExited("p1");
    const a = agg.snapshot().activities[0] as TaskActivity;
    expect(a).toBeDefined();
    expect(a.kind).toBe("task");
    agg.taskFinished("p1", { runId: "run-1" });
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: 非 task 面板 ptyExited 等同 panelClosed — 清层且 5s 冷却拦 SessionStart", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    // shell 面板 pty 退出 → 完整 panelClosed 语义（若 no-op 此处仍有 activity）
    agg.ptyExited("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 幽灵防复活：panel 冷却期内 SessionStart 也被拦（过消抖窗仍无 activity）
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(0);
    // panel 冷却过期后 SessionStart 才能重建
    advance(4751);
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("回归: task 面板 ptyExited 清 hook 证据并冷却迟到 hook", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", {
      taskId: "t1",
      label: "test",
      runId: "run-1",
    });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ptyExited("p1");
    let snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    let a = snap.activities[0] as TaskActivity;
    expect(a.kind).toBe("task");
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    advance(250);
    snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    a = snap.activities[0] as TaskActivity;
    expect(a.kind).toBe("task");
    agg.taskFinished("p1", { runId: "run-1" });
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  describe("omp 新映射下的多轮/子代理交错回归", () => {
    // omp 集成重写后 turn_start/turn_end 不再订阅——旧映射把 turn_end 映射为
    // Stop, 每轮 LLM round 边界都会谎报「等待输入」。以下事件名是新映射
    // (OMP_EVENT_MAP / OMP_SUBAGENT_EVENT_MAP) 输出的 pier 事件, 序列取自
    // 真实 omp 进程 probe 采集的原生事件流。
    function ompEvent(event: string): AgentHookEventPayload {
      return {
        v: 1,
        kind: "agentEvent",
        agent: "omp",
        event,
        panelId: "p1",
        windowId: "1",
      };
    }

    it("多轮工具循环期间 ToolComplete 回落 processing，仅 Stop 才 ready (旧 turn_end→Stop 谎报回归)", () => {
      const agg = createForegroundActivityAggregator({ now });
      // 原生: session_start → agent_start → 2×(tool_call → tool_result) → agent_end
      agg.ingestAgentEvent(ompEvent("SessionStart"));
      agg.ingestAgentEvent(ompEvent("PromptSubmit"));
      let a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.agentId).toBe("omp");
      expect(a.status).toBe("processing");
      for (let round = 1; round <= 2; round += 1) {
        agg.ingestAgentEvent(ompEvent("ToolStart"));
        a = agg.snapshot().activities[0] as AgentActivity;
        expect(a.status, `第 ${round} 轮 ToolStart 后`).toBe("tool");
        agg.ingestAgentEvent(ompEvent("ToolComplete"));
        a = agg.snapshot().activities[0] as AgentActivity;
        // 轮间是思考（processing），不得插入 ready（旧 turn_end→Stop 谎报）
        expect(a.status, `第 ${round} 轮 ToolComplete 后`).toBe("processing");
      }
      agg.ingestAgentEvent(ompEvent("Stop"));
      a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("ready");
      agg.dispose();
    });

    it("子代理交错: Subagent 事件不改主 status, subagentCount 1→0, activity 全程不拆层", () => {
      const agg = createForegroundActivityAggregator({ now });
      agg.ingestAgentEvent(ompEvent("SessionStart"));
      agg.ingestAgentEvent(ompEvent("PromptSubmit"));
      // 真实 probe 交错(主 M / 子 S)。子实例的 session_* 不产生 pier 事件,
      // 主 activity 不得被中途拆层。
      // [原生事件, pier 事件, 期望 status, 期望 subagentCount]
      const steps: [string, string, string, number][] = [
        ["M:tool_call(task)", "ToolStart", "tool", 0],
        ["M:tool_result(task)", "ToolComplete", "processing", 0],
        ["S:agent_start", "SubagentStart", "processing", 1],
        ["M:tool_call(job)", "ToolStart", "tool", 1],
        ["S:agent_end", "SubagentStop", "tool", 0],
        ["M:tool_result(job)", "ToolComplete", "processing", 0],
      ];
      for (const [native, event, status, subagents] of steps) {
        agg.ingestAgentEvent(ompEvent(event));
        const snap = agg.snapshot();
        expect(snap.activities, native).toHaveLength(1);
        const a = snap.activities[0] as AgentActivity;
        expect(a.status, native).toBe(status);
        expect(a.subagentCount, native).toBe(subagents);
      }
      // M:agent_end → Stop: 回合真正结束
      agg.ingestAgentEvent(ompEvent("Stop"));
      const a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("ready");
      expect(a.subagentCount).toBe(0);
      agg.dispose();
    });

    it.each<AgentStopAuthority>([
      "authoritative",
      "reset-only",
    ])("%s Stop 在仍有工具时立即封账并吸收迟到事件", (stopAuthority) => {
      const agg = createForegroundActivityAggregator({ now });
      agg.ingestAgentEvent(ompEvent("PromptSubmit"));
      agg.ingestAgentEvent(
        agentHookEvent({
          agent: "omp",
          event: "ToolStart",
          panelId: "p1",
          toolUseId: "open-tool",
          windowId: "1",
        })
      );
      agg.ingestAgentEvent(ompEvent("Stop"), { stopAuthority });
      let a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("ready");
      expect(
        agg.ingestAgentEvent(
          agentHookEvent({
            agent: "omp",
            event: "ToolComplete",
            panelId: "p1",
            toolUseId: "open-tool",
            windowId: "1",
          })
        )
      ).toBe(false);
      a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("ready");
      // 新一轮 PromptSubmit → processing
      agg.ingestAgentEvent(ompEvent("PromptSubmit"));
      a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("processing");
      // 复活后工具事件恢复生效
      agg.ingestAgentEvent(ompEvent("ToolStart"));
      a = agg.snapshot().activities[0] as AgentActivity;
      expect(a.status).toBe("tool");
      agg.dispose();
    });
  });
  it("transferPanelOwnership moves slot to target window id", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "panel-a", "claude");
    advance(250);
    expect(agg.snapshot("1").activities).toHaveLength(1);

    agg.transferPanelOwnership({
      panelId: "panel-a",
      sourceWindowId: "1",
      targetWindowId: "2",
    });
    advance(100);

    expect(agg.snapshot("1").activities).toHaveLength(0);
    expect(agg.snapshot("2").activities).toHaveLength(1);
    expect(agg.snapshot("2").activities[0]?.panelId).toBe("panel-a");
    agg.dispose();
  });
});
