import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import {
  type LogRecord,
  resetDefaultLogSinkForTests,
  setDefaultLogSink,
} from "@shared/logger.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import { HOOK_FRESH_TTL_MS } from "../../../../src/main/services/foreground-activity/entry.ts";
import type {
  AgentEventIngestOptions,
  ForegroundActivityAggregator,
} from "../../../../src/main/services/foreground-activity/types.ts";

const HOOK_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function event(
  eventName: string,
  details: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "claude",
    event: eventName,
    kind: "agentEvent",
    panelId: "panel-1",
    v: 1,
    windowId: "window-1",
    ...details,
  };
}

function ingest(
  aggregator: ForegroundActivityAggregator,
  hookEvent: AgentHookEventPayload,
  overrides: Partial<AgentEventIngestOptions> = {}
): boolean {
  return aggregator.ingestAgentEvent(hookEvent, {
    ...HOOK_OPTIONS,
    ...overrides,
  });
}

function statusOf(
  aggregator: ForegroundActivityAggregator
): AgentActivity["status"] | undefined {
  return (aggregator.snapshot().activities[0] as AgentActivity | undefined)
    ?.status;
}

afterEach(() => {
  resetDefaultLogSinkForTests();
  vi.useRealTimers();
});

describe("前台活动回合状态机", () => {
  it.each([
    { terminal: "TurnCompleted", want: "ready" },
    { terminal: "TurnInterrupted", want: "ready" },
    { terminal: "error", want: "error" },
  ] as const)("活跃工具不能否定 $terminal", ({ terminal, want }) => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(
      aggregator,
      event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" })
    );

    expect(ingest(aggregator, event(terminal, { turnId: "turn-1" }))).toBe(
      true
    );
    expect(statusOf(aggregator)).toBe(want);
    aggregator.dispose();
  });

  it.each([
    { terminal: "TurnCompleted", want: "ready" },
    { terminal: "error", want: "error" },
  ] as const)("$terminal 封账后吸收无身份和同身份迟到工作", ({
    terminal,
    want,
  }) => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event(terminal, { turnId: "turn-1" }));
    const lateEvents = [
      event("processing"),
      event("running"),
      event("ToolStart", { toolUseId: "anonymous-late" }),
      event("ToolComplete", { toolUseId: "anonymous-late" }),
      event("processing", { turnId: "turn-1" }),
      event("ToolStart", { toolUseId: "same-turn-late", turnId: "turn-1" }),
      event("ToolComplete", {
        toolUseId: "same-turn-late",
        turnId: "turn-1",
      }),
    ];

    for (const lateEvent of lateEvents) {
      expect(ingest(aggregator, lateEvent)).toBe(false);
      expect(statusOf(aggregator)).toBe(want);
    }
    aggregator.dispose();
  });

  it("无关联进展不能重开，明确 prompt 可以", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(ingest(aggregator, event("processing"))).toBe(false);
    expect(statusOf(aggregator)).toBe("ready");
    expect(ingest(aggregator, event("PromptSubmit"))).toBe(true);
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("新 PromptSubmit 可重开已结算 turnId，后续中断计入新回合", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(
      ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("processing");
    expect(
      ingest(aggregator, event("TurnInterrupted", { turnId: "turn-1" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("新的 turnId 可关联重开，已结算 turnId 不可复活", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(ingest(aggregator, event("processing", { turnId: "turn-2" }))).toBe(
      true
    );
    expect(statusOf(aggregator)).toBe("processing");
    expect(ingest(aggregator, event("processing", { turnId: "turn-1" }))).toBe(
      false
    );
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("封账后新 turnId 的 ToolStart 与可信终态可开新回合", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "shell-1", turnId: "turn-2" })
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-2" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("封账后方案解除若无 PromptSubmit，新 turnId 终态仍回到 ready", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));
    ingest(aggregator, {
      agent: "claude",
      event: "InteractionRequested",
      interactionId: "cp:session:1",
      interactionKind: "permission",
      kind: "agentEvent",
      nativeEvent: "cursor.transcript.create_plan",
      panelId: "panel-1",
      toolName: "CreatePlan",
      toolUseId: "cp:session:1",
      v: 3,
      windowId: "window-1",
    });
    ingest(aggregator, {
      agent: "claude",
      event: "InteractionResolved",
      interactionId: "cp:session:1",
      interactionKind: "permission",
      interactionOutcome: "completed",
      kind: "agentEvent",
      nativeEvent: "cursor.transcript.create_plan.resolved",
      panelId: "panel-1",
      toolName: "CreatePlan",
      toolUseId: "cp:session:1",
      v: 3,
      windowId: "window-1",
    });
    expect(statusOf(aggregator)).toBe("processing");
    expect(
      ingest(
        aggregator,
        event("ToolStart", { toolUseId: "shell-1", turnId: "turn-2" })
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    expect(
      ingest(
        aggregator,
        event("ToolComplete", { toolUseId: "shell-1", turnId: "turn-2" })
      )
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("processing");
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-2" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("封账后仅新 turnId 的可信终态也可收口，ToolComplete 不能开新回合", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));
    ingest(aggregator, {
      agent: "claude",
      event: "InteractionRequested",
      interactionId: "cp:session:1",
      interactionKind: "permission",
      kind: "agentEvent",
      nativeEvent: "cursor.transcript.create_plan",
      panelId: "panel-1",
      toolName: "CreatePlan",
      toolUseId: "cp:session:1",
      v: 3,
      windowId: "window-1",
    });
    ingest(aggregator, {
      agent: "claude",
      event: "InteractionResolved",
      interactionId: "cp:session:1",
      interactionKind: "permission",
      interactionOutcome: "completed",
      kind: "agentEvent",
      nativeEvent: "cursor.transcript.create_plan.resolved",
      panelId: "panel-1",
      toolName: "CreatePlan",
      toolUseId: "cp:session:1",
      v: 3,
      windowId: "window-1",
    });
    expect(
      ingest(
        aggregator,
        event("ToolComplete", { toolUseId: "late-1", turnId: "turn-2" })
      )
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("processing");
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-2" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("新回合替换会退休旧身份，迟到旧进展不能夺回且新终态仍可完成", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-2" }));

    expect(ingest(aggregator, event("processing", { turnId: "turn-1" }))).toBe(
      false
    );
    expect(statusOf(aggregator)).toBe("processing");
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-2" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("旧版空 turnId 按缺失处理，终态结算当前身份且不能被旧进展重开", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));

    expect(ingest(aggregator, event("TurnCompleted", { turnId: "" }))).toBe(
      true
    );
    expect(statusOf(aggregator)).toBe("ready");
    expect(ingest(aggregator, event("processing", { turnId: "turn-1" }))).toBe(
      false
    );
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it("同一活跃 turnId 的重复 PromptSubmit 不清空工具账本", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(
      aggregator,
      event("ToolStart", { toolUseId: "tool-1", turnId: "turn-1" })
    );

    expect(
      ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }))
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("提供方权威起点只在封账后重开，活跃时不重复清账", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(
      ingest(aggregator, event("processing"), {
        turnStartAuthority: "authoritative",
      })
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("processing");
    ingest(aggregator, event("ToolStart", { toolUseId: "tool-2" }));
    expect(
      ingest(aggregator, event("processing"), {
        turnStartAuthority: "authoritative",
      })
    ).toBe(true);
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("error 不被完成事实降级，ready 可被 error 纠正", () => {
    const errored = createForegroundActivityAggregator();
    ingest(errored, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(errored, event("error", { turnId: "turn-1" }));
    expect(ingest(errored, event("TurnCompleted", { turnId: "turn-1" }))).toBe(
      false
    );
    expect(statusOf(errored)).toBe("error");
    errored.dispose();

    const completed = createForegroundActivityAggregator();
    ingest(completed, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(completed, event("TurnCompleted", { turnId: "turn-1" }));
    expect(ingest(completed, event("error", { turnId: "turn-1" }))).toBe(true);
    expect(statusOf(completed)).toBe("error");
    completed.dispose();
  });

  it("终态证据只按 ready → interrupted → error 增强且重复中断幂等", () => {
    vi.useFakeTimers();
    const aggregator = createForegroundActivityAggregator();
    const broadcasts: unknown[] = [];
    const unsubscribe = aggregator.onChange((broadcast) =>
      broadcasts.push(broadcast)
    );
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));
    vi.advanceTimersByTime(110);

    expect(
      ingest(aggregator, event("TurnInterrupted", { turnId: "turn-1" }))
    ).toBe(true);
    vi.advanceTimersByTime(110);
    const broadcastsAfterInterruption = broadcasts.length;
    expect(
      ingest(aggregator, event("TurnInterrupted", { turnId: "turn-1" }))
    ).toBe(false);
    vi.advanceTimersByTime(110);
    expect(broadcasts).toHaveLength(broadcastsAfterInterruption);
    expect(statusOf(aggregator)).toBe("ready");

    expect(ingest(aggregator, event("error", { turnId: "turn-1" }))).toBe(true);
    expect(statusOf(aggregator)).toBe("error");
    expect(
      ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }))
    ).toBe(false);
    expect(statusOf(aggregator)).toBe("error");
    unsubscribe();
    aggregator.dispose();
  });

  it("缺失 ID 的更强终态可纠正当前回合", () => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-1" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-1" }));

    expect(ingest(aggregator, event("error"))).toBe(true);
    expect(statusOf(aggregator)).toBe("error");
    aggregator.dispose();
  });

  it("旧具名终态不能纠正已完成的匿名新回合且拒绝零广播", () => {
    vi.useFakeTimers();
    const aggregator = createForegroundActivityAggregator();
    const broadcasts: unknown[] = [];
    const unsubscribe = aggregator.onChange((broadcast) =>
      broadcasts.push(broadcast)
    );
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-old" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-old" }));
    ingest(aggregator, event("PromptSubmit"));
    ingest(aggregator, event("TurnCompleted"));
    vi.advanceTimersByTime(110);
    const snapshotBefore = aggregator.snapshot().activities;
    const broadcastsBefore = broadcasts.length;

    expect(ingest(aggregator, event("error", { turnId: "turn-old" }))).toBe(
      false
    );
    vi.advanceTimersByTime(110);
    expect(aggregator.snapshot().activities).toEqual(snapshotBefore);
    expect(broadcasts).toHaveLength(broadcastsBefore);
    expect(statusOf(aggregator)).toBe("ready");
    unsubscribe();
    aggregator.dispose();
  });

  it("已结算身份即使携带权威起点也以 settled-turn 零副作用拒绝", () => {
    vi.useFakeTimers();
    const records: LogRecord[] = [];
    const broadcasts: unknown[] = [];
    setDefaultLogSink((record) => records.push(record));
    const aggregator = createForegroundActivityAggregator();
    const unsubscribe = aggregator.onChange((broadcast) =>
      broadcasts.push(broadcast)
    );
    ingest(aggregator, event("PromptSubmit", { turnId: "turn-settled" }));
    ingest(aggregator, event("TurnCompleted", { turnId: "turn-settled" }));
    vi.advanceTimersByTime(110);
    const snapshotBefore = aggregator.snapshot().activities;
    const broadcastsBefore = broadcasts.length;

    expect(
      ingest(aggregator, event("running", { turnId: "turn-settled" }), {
        turnStartAuthority: "authoritative",
      })
    ).toBe(false);
    vi.advanceTimersByTime(110);
    expect(aggregator.snapshot().activities).toEqual(snapshotBefore);
    expect(broadcasts).toHaveLength(broadcastsBefore);
    expect(
      records.find((record) => record.ctx?.reason === "settled-turn")?.ctx
    ).toMatchObject({ reason: "settled-turn" });
    unsubscribe();
    aggregator.dispose();
  });

  it.each([
    [
      "terminal-then-late-complete",
      ["PromptSubmit", "ToolStart", "TurnCompleted", "ToolComplete"],
    ],
    [
      "complete-then-terminal",
      ["PromptSubmit", "ToolStart", "ToolComplete", "TurnCompleted"],
    ],
  ] as const)("%s 最终收敛到 ready", (_name, sequence) => {
    const aggregator = createForegroundActivityAggregator();
    for (const eventName of sequence) {
      ingest(
        aggregator,
        event(eventName, {
          toolUseId: eventName.startsWith("Tool") ? "tool-1" : undefined,
          turnId: "turn-1",
        })
      );
    }
    expect(statusOf(aggregator)).toBe("ready");
    aggregator.dispose();
  });

  it.each([
    { finish: "ToolComplete", start: "ToolStart" },
    { finish: "InteractionResolved", start: "InteractionRequested" },
    { finish: "SubagentStop", start: "SubagentStart" },
  ] as const)("advisory Stop 后迟到 $finish 不取消候选", ({
    finish,
    start,
  }) => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit"));
    ingest(aggregator, event(start));
    expect(
      ingest(aggregator, event("Stop"), { stopAuthority: "advisory" })
    ).toBe(true);
    expect(statusOf(aggregator)).toBeUndefined();

    expect(ingest(aggregator, event(finish))).toBe(true);
    expect(statusOf(aggregator)).toBeUndefined();
    aggregator.dispose();
  });

  it.each([
    { eventName: "ToolStart", want: "tool" },
    { eventName: "InteractionRequested", want: "waiting" },
    { eventName: "processing", want: "processing" },
    { eventName: "running", want: "processing" },
  ] as const)("advisory Stop 后真实活动 $eventName 取消候选", ({
    eventName,
    want,
  }) => {
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit"));
    expect(
      ingest(aggregator, event("Stop"), { stopAuthority: "advisory" })
    ).toBe(true);
    expect(statusOf(aggregator)).toBeUndefined();

    expect(ingest(aggregator, event(eventName))).toBe(true);
    expect(statusOf(aggregator)).toBe(want);
    aggregator.dispose();
  });

  it("推进 TTL 和广播计时器不会生成 ready", () => {
    vi.useFakeTimers();
    const aggregator = createForegroundActivityAggregator();
    ingest(aggregator, event("PromptSubmit"));

    vi.advanceTimersByTime(HOOK_FRESH_TTL_MS + 1000);

    expect(statusOf(aggregator)).toBeUndefined();
    aggregator.dispose();
  });

  it.each([
    {
      name: "claude 文本回合：advisory Stop 不 ready，idle_prompt 才 ready",
      stopAuthority: "advisory" as const,
      steps: [
        { event: "PromptSubmit", turnId: "p1", want: "processing" },
        { event: "Stop", turnId: "p1", want: undefined },
        { event: "TurnCompleted", turnId: "p1", want: "ready" },
      ],
    },
    {
      name: "claude ExitPlan 后续跑：无 PromptSubmit 的新 turnId 仍能收口",
      stopAuthority: "advisory" as const,
      steps: [
        { event: "PromptSubmit", turnId: "plan", want: "processing" },
        { event: "TurnCompleted", turnId: "plan", want: "ready" },
        {
          event: "InteractionRequested",
          interactionId: "exit-1",
          toolName: "ExitPlanMode",
          want: "waiting",
        },
        {
          event: "InteractionResolved",
          interactionId: "exit-1",
          toolName: "ExitPlanMode",
          want: "processing",
        },
        {
          event: "ToolStart",
          toolUseId: "shell-1",
          turnId: "build",
          want: "tool",
        },
        { event: "TurnCompleted", turnId: "build", want: "ready" },
      ],
    },
    {
      name: "codex 问卷：hook 当工具，transcript Interaction 升 waiting；答完后再 advisory Stop，task_complete 才 ready",
      stopAuthority: "advisory" as const,
      steps: [
        { event: "PromptSubmit", turnId: "t1", want: "processing" },
        {
          event: "ToolStart",
          toolUseId: "q1",
          toolName: "request_user_input",
          turnId: "t1",
          want: "tool",
        },
        {
          event: "InteractionRequested",
          interactionId: "q1",
          toolName: "request_user_input",
          turnId: "t1",
          want: "waiting",
        },
        {
          event: "ToolComplete",
          toolUseId: "q1",
          toolName: "request_user_input",
          turnId: "t1",
          want: "waiting",
        },
        {
          event: "InteractionResolved",
          interactionId: "q1",
          toolName: "request_user_input",
          turnId: "t1",
          want: "processing",
        },
        { event: "Stop", turnId: "t1", want: undefined },
        { event: "TurnCompleted", turnId: "t1", want: "ready" },
      ],
    },
    {
      name: "grok 工具后 advisory Stop 不 ready，updates end_turn 才 ready",
      stopAuthority: "advisory" as const,
      steps: [
        { event: "PromptSubmit", want: "processing" },
        { event: "ToolStart", toolUseId: "r1", want: "tool" },
        { event: "ToolComplete", toolUseId: "r1", want: "processing" },
        { event: "Stop", want: undefined },
        { event: "TurnCompleted", want: "ready" },
      ],
    },
    {
      name: "omp ask 闭环后 agent_end.completed 立即 ready",
      stopAuthority: "authoritative" as const,
      steps: [
        { event: "PromptSubmit", want: "processing" },
        {
          event: "InteractionRequested",
          interactionId: "ask-1",
          toolName: "ask",
          want: "waiting",
        },
        {
          event: "InteractionResolved",
          interactionId: "ask-1",
          toolName: "ask",
          want: "processing",
        },
        { event: "TurnCompleted", want: "ready" },
      ],
    },
    {
      name: "pi 文本回合：权威 agent_settled 直接 ready",
      stopAuthority: "authoritative" as const,
      steps: [
        { event: "PromptSubmit", want: "processing" },
        { event: "Stop", want: "ready" },
      ],
    },
    {
      name: "opencode/kilo：阻塞问卷答完后 session.idle 权威 Stop 直接 ready",
      stopAuthority: "authoritative" as const,
      steps: [
        { event: "PromptSubmit", want: "processing" },
        {
          event: "InteractionRequested",
          interactionId: "q-1",
          toolName: "question",
          want: "waiting",
        },
        {
          event: "InteractionResolved",
          interactionId: "q-1",
          toolName: "question",
          want: "processing",
        },
        { event: "Stop", want: "ready" },
      ],
    },
    {
      name: "amp：awaiting-approval 后 agent.end.done 直接 ready",
      stopAuthority: "none" as const,
      steps: [
        { event: "PromptSubmit", want: "processing" },
        {
          event: "InteractionRequested",
          interactionId: "approve-1",
          toolName: "approval",
          want: "waiting",
        },
        {
          event: "InteractionResolved",
          interactionId: "approve-1",
          toolName: "approval",
          want: "processing",
        },
        { event: "TurnCompleted", want: "ready" },
      ],
    },
  ])("$name", ({ stopAuthority, steps }) => {
    const aggregator = createForegroundActivityAggregator();
    for (const step of steps) {
      const accepted = ingest(
        aggregator,
        {
          agent: "claude",
          event: step.event,
          kind: "agentEvent",
          panelId: "panel-1",
          v: 3,
          windowId: "window-1",
          ...("turnId" in step && step.turnId ? { turnId: step.turnId } : {}),
          ...("toolUseId" in step && step.toolUseId
            ? { toolUseId: step.toolUseId }
            : {}),
          ...("toolName" in step && step.toolName
            ? { toolName: step.toolName }
            : {}),
          ...("interactionId" in step && step.interactionId
            ? {
                interactionId: step.interactionId,
                interactionKind:
                  step.toolName === "ExitPlanMode" ? "permission" : "question",
                interactionOutcome:
                  step.event === "InteractionResolved"
                    ? "completed"
                    : undefined,
              }
            : {}),
        } as AgentHookEventPayload,
        { stopAuthority }
      );
      expect(accepted, step.event).toBe(true);
      expect(statusOf(aggregator), step.event).toBe(step.want);
    }
    aggregator.dispose();
  });
});
