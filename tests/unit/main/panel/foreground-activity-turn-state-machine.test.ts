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
});
