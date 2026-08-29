import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOmpExtensionSource,
  installOmpExtension,
  OMP_EVENT_MAP,
  OMP_FA_ERROR_REACHABILITY,
  OMP_MARKER,
  ompDetect,
  ompExtensionPath,
  ompHome,
  ompIntegration,
  uninstallOmpExtension,
} from "../../../src/main/services/agents/integrations/omp.ts";
import { resolveAgentEventIngestOptions } from "../../../src/main/services/agents/integrations/runtime/event-authority.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";

const NATIVE_EVENTS = [
  "session_start",
  "agent_start",
  "before_agent_start",
  "tool_execution_start",
  "tool_execution_end",
  "tool_approval_requested",
  "tool_approval_resolved",
  "agent_end",
  "session_stop",
  "session_shutdown",
];

describe("buildOmpExtensionSource", () => {
  it("含 marker、三个 PIER_ 环境变量守卫、无顶层 import 声明", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain(OMP_MARKER);
    // JSONL 通路的三个环境变量（HTTP 时代 PORT/TOKEN 已删）
    expect(src).toContain("PIER_AGENT_EVENT_LOG");
    expect(src).toContain("PIER_PANEL_ID");
    expect(src).toContain("PIER_WINDOW_ID");
    expect(src).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(src).not.toContain("PIER_AGENT_HOOK_TOKEN");
    // 无顶层 ImportDeclaration（electron-vite 模板字面量扫描陷阱豁免）；
    // await import() 是 CallExpression, 允许在函数体内。
    for (const line of src.split("\n")) {
      expect(line.trimStart().startsWith("import ")).toBe(false);
    }
    // 运行时 process.getBuiltinModule 同步 append：非 ImportDeclaration,
    // 保 JSONL 文件序（同毫秒事件在未 await 的异步 append 下乱序）,
    // 且宿主退出前最后的 session_shutdown 必落盘。
    expect(src).toContain('process.getBuiltinModule("node:fs")');
    expect(src).toContain("appendFileSync");
    expect(src).not.toContain('await import("node:fs/promises")');
    expect(src).not.toContain('require("node:fs/promises")');
    // HTTP 通路已删
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("/agent-event");
  });

  it("按固定提交中的公开扩展事件注册，不虚构子智能体生命周期", () => {
    const src = buildOmpExtensionSource();
    expect(OMP_EVENT_MAP).toEqual([
      { nativeEvent: "session_start", pierEvent: "SessionStart" },
      {
        nativeEvent: "agent_start",
        pierEvent: "processing",
        turnStartAuthority: "authoritative",
      },
      { nativeEvent: "before_agent_start", pierEvent: "PromptSubmit" },
      { nativeEvent: "tool_execution_start", pierEvent: "ToolStart" },
      {
        nativeEvent: "tool_execution_start.ask",
        pierEvent: "InteractionRequested",
      },
      { nativeEvent: "tool_execution_end", pierEvent: "ToolComplete" },
      {
        nativeEvent: "tool_execution_end.ask",
        pierEvent: "InteractionResolved",
      },
      {
        nativeEvent: "tool_approval_requested",
        pierEvent: "InteractionRequested",
      },
      {
        nativeEvent: "tool_approval_resolved",
        pierEvent: "InteractionResolved",
      },
      {
        nativeEvent: "agent_end.willContinue",
        pierEvent: "processing",
        turnStartAuthority: "authoritative",
      },
      { nativeEvent: "agent_end.toolUseDeferred", pierEvent: "processing" },
      { nativeEvent: "agent_end.completed", pierEvent: "TurnCompleted" },
      { nativeEvent: "agent_end.error", pierEvent: "error" },
      { nativeEvent: "agent_end.aborted", pierEvent: "TurnInterrupted" },
      { nativeEvent: "session_stop", pierEvent: "Stop" },
      { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
    ]);
    for (const evt of NATIVE_EVENTS) {
      expect(
        src.match(new RegExp(`pi\\.on\\("${evt}"`, "g")),
        evt
      ).toHaveLength(1);
    }
    expect(src).not.toContain("SubagentStart");
    expect(src).not.toContain("SubagentStop");
    expect(src).not.toContain("pierInstanceCount");
    expect(src).not.toContain('pi.on("turn_start"');
    expect(src).not.toContain('pi.on("turn_end"');
  });

  it("Ev5: agent_end 的最后 assistant stopReason 可达全局错误", () => {
    expect(OMP_FA_ERROR_REACHABILITY).toBe("native");
    expect(OMP_EVENT_MAP).toContainEqual({
      nativeEvent: "agent_end.error",
      pierEvent: "error",
    });
    expect(
      OMP_EVENT_MAP.find((e) => e.nativeEvent === "session_stop")?.pierEvent
    ).toBe("Stop");
  });

  it("agent 字段为 omp", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain('agent: "omp"');
  });

  it("不按 ctx.hasUI 猜测主从角色", () => {
    const src = buildOmpExtensionSource();
    expect(src).not.toContain("pierInstanceCount");
    expect(src).not.toContain("hasUI === true");
    expect(src).not.toContain("actorHint");
  });
});

describe("生成源码行为（临时文件动态加载 + 假 pi 触发）", () => {
  const ORIG = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panelId: process.env.PIER_PANEL_ID,
    windowId: process.env.PIER_WINDOW_ID,
  };

  afterEach(() => {
    restoreEnv("PIER_AGENT_EVENT_LOG", ORIG.log);
    restoreEnv("PIER_PANEL_ID", ORIG.panelId);
    restoreEnv("PIER_WINDOW_ID", ORIG.windowId);
  });

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  interface OmpEventCtx {
    hasUI: boolean;
    sessionManager?: {
      getLastUserMessage?: () => string;
      getMessages?: () => Array<{ role?: string; content?: string }>;
      getSessionFile?: () => string | undefined;
      getSessionId?: () => string;
    };
  }
  type OmpHandler = (event: unknown, ctx: OmpEventCtx) => void;
  type OmpExtensionFactory = (pi: {
    on: (name: string, handler: OmpHandler) => void;
  }) => void;

  /** 假 pi：on 收集 handlers, fire 模拟宿主派发；未订阅事件静默无操作。 */
  function createFakePi() {
    const handlers = new Map<string, OmpHandler[]>();
    return {
      pi: {
        on(name: string, handler: OmpHandler): void {
          const list = handlers.get(name);
          if (list) {
            list.push(handler);
          } else {
            handlers.set(name, [handler]);
          }
        },
      },
      fire(name: string, ctx: OmpEventCtx, event: unknown = {}): void {
        for (const handler of handlers.get(name) ?? []) {
          handler(event, ctx);
        }
      },
    };
  }

  /**
   * 求值生成源码, 一次求值 = 一个全新模块实例（pierInstanceCount 归零）,
   * 模拟一个新的 omp 宿主进程；三个 PIER_ 环境变量指向唯一临时 JSONL。
   *
   * 不写临时文件走 import()：vitest 模块运行器解析不了仓库根外的文件,
   * jsdom 池的 vm 上下文又未接通动态 import 回调, 原生 import() 同样不可用。
   * 生成源码同步化后不含任何 import, 把模块边界 export default 换成
   * module.exports 即可用 new Function 直接求值——被测逻辑一字未改。
   */
  async function loadFreshExtension(): Promise<{
    factory: OmpExtensionFactory;
    logPath: string;
  }> {
    const source = buildOmpExtensionSource();
    // 钉住替换点唯一：若未来注释/字符串里再出现同 token, replace 只改首处,
    // 漏改的第二处会让 new Function 语法错误且排查成本高——先显式失败。
    const exportTokenCount =
      source.match(/export default function/g)?.length ?? 0;
    if (exportTokenCount !== 1) {
      throw new Error(
        `生成源码应恰含一处 export default function, 实际 ${exportTokenCount} 处`
      );
    }
    const cjsSource = source.replace(
      "export default function",
      "module.exports = function"
    );
    const moduleShim: { exports: OmpExtensionFactory | undefined } = {
      exports: undefined,
    };
    const evaluate = new Function("module", cjsSource) as (
      shim: typeof moduleShim
    ) => void;
    evaluate(moduleShim);
    if (typeof moduleShim.exports !== "function") {
      throw new Error("生成源码未导出扩展工厂函数");
    }
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-ext-"));
    const logPath = join(dir, "events.jsonl");
    process.env.PIER_AGENT_EVENT_LOG = logPath;
    process.env.PIER_PANEL_ID = "panel-1";
    process.env.PIER_WINDOW_ID = "window-1";
    return { factory: moduleShim.exports, logPath };
  }

  async function readEmittedRecords(
    logPath: string
  ): Promise<Record<string, unknown>[]> {
    const raw = await readFile(logPath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function eventsOf(records: Record<string, unknown>[]): unknown[] {
    return records.map((record) => record.event);
  }

  it("真实事件载荷形成严格 v3 闭环：willContinue 续处理，正常 agent_end 落 TurnCompleted", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp" },
    };
    main.fire("session_start", ctx, { type: "session_start" });
    main.fire("before_agent_start", ctx, {
      prompt: "Run the checks",
      type: "before_agent_start",
    });
    main.fire("tool_execution_start", ctx, {
      args: { command: "pnpm test" },
      toolCallId: "tool-1",
      toolName: "bash",
      type: "tool_execution_start",
    });
    main.fire("tool_execution_end", ctx, {
      isError: true,
      result: { content: "one test failed" },
      toolCallId: "tool-1",
      toolName: "bash",
      type: "tool_execution_end",
    });
    main.fire("tool_approval_requested", ctx, {
      approvalMode: "ask",
      sessionId: "session-omp",
      toolCallId: "approval-1",
      toolName: "write",
      type: "tool_approval_requested",
    });
    main.fire("tool_approval_resolved", ctx, {
      approved: false,
      sessionId: "session-omp",
      toolCallId: "approval-1",
      toolName: "write",
      type: "tool_approval_resolved",
    });
    // 正常回合结束（willContinue=false）必须发出 TurnCompleted，不能静默。
    main.fire("agent_end", ctx, {
      type: "agent_end",
      willContinue: false,
    });
    main.fire("before_agent_start", ctx, {
      prompt: "continue",
      type: "before_agent_start",
    });
    main.fire("agent_end", ctx, {
      type: "agent_end",
      willContinue: true,
    });
    main.fire("session_stop", ctx, { type: "session_stop" });
    const records = await readEmittedRecords(logPath);
    expect(eventsOf(records)).toEqual([
      "SessionStart",
      "PromptSubmit",
      "ToolStart",
      "ToolComplete",
      "InteractionRequested",
      "InteractionResolved",
      "TurnCompleted",
      "PromptSubmit",
      "processing",
      "Stop",
    ]);
    expect(records[2]).toMatchObject({
      event: "ToolStart",
      toolName: "bash",
      toolUseId: "tool-1",
      v: 3,
    });
    expect(records[3]).toMatchObject({
      event: "ToolComplete",
      nativeState: "error",
      toolUseId: "tool-1",
      v: 3,
    });
    expect(records[4]).toMatchObject({
      event: "InteractionRequested",
      interactionId: "approval-1",
      interactionKind: "permission",
      toolUseId: "approval-1",
    });
    expect(records[5]).toMatchObject({
      event: "InteractionResolved",
      interactionId: "approval-1",
      interactionKind: "permission",
      interactionOutcome: "rejected",
      nativeState: "rejected",
      toolUseId: "approval-1",
    });
    expect(records[6]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "agent_end.completed",
      nativeState: "completed",
      v: 3,
    });
    expect(records.some((record) => record.event === "error")).toBe(false);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(parsed, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual([
      "processing",
      "tool",
      "processing",
      "waiting",
      "processing",
      "ready",
      "processing",
      "processing",
      "ready",
    ]);
  });

  it("abort 封账后静默续跑（steer drain / IRC 唤醒）经 agent_start 重开，不冻在 ready", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp" },
    };
    main.fire("before_agent_start", ctx, {
      prompt: "verify moshi full-duplex speech",
      type: "before_agent_start",
    });
    main.fire("tool_execution_start", ctx, {
      toolCallId: "call-1",
      toolName: "web_search",
      type: "tool_execution_start",
    });
    // 用户 esc 中断当前 LLM 调用：omp 发 agent_end(aborted)。
    main.fire("agent_end", ctx, {
      messages: [{ role: "assistant", stopReason: "aborted" }],
      type: "agent_end",
    });
    // omp 的 steer/follow-up drain 与 IRC 唤醒直接开新 loop，
    // 不经过 before_agent_start——真实事故里面板封账后继续工作
    // 37 分钟仍显示「等待输入」。
    main.fire("agent_start", ctx, { type: "agent_start" });
    main.fire("tool_execution_start", ctx, {
      toolCallId: "call-2",
      toolName: "read",
      type: "tool_execution_start",
    });
    const records = await readEmittedRecords(logPath);
    expect(eventsOf(records)).toEqual([
      "PromptSubmit",
      "ToolStart",
      "TurnInterrupted",
      "processing",
      "ToolStart",
    ]);
    expect(records[3]).toMatchObject({
      event: "processing",
      nativeEvent: "agent_start",
      nativeState: "loop_start",
    });

    const aggregator = createForegroundActivityAggregator();
    let status: string | undefined;
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(
        parsed,
        resolveAgentEventIngestOptions({
          evidenceSource: "hook",
          event: parsed,
          runtime: ompIntegration.runtime,
        })
      );
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        status = activity.status;
      }
    }
    // 修复前：TurnInterrupted 封账后续跑 ToolStart 被 sealed-turn 拒绝，
    // 状态永远冻在 ready（谎报「等待输入」）。
    expect(status).toBe("tool");
  });

  it("toolUse 让位（后台工具挂起）落 processing，不落 TurnCompleted", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp" },
    };
    main.fire("before_agent_start", ctx, {
      prompt: "research desktop companions",
      type: "before_agent_start",
    });
    // loop 以 stopReason=toolUse settle：后台任务未完，TUI 未回提示符；
    // 任务完成后的续跑不带 before_agent_start。
    main.fire("agent_end", ctx, {
      messages: [{ role: "assistant", stopReason: "toolUse" }],
      type: "agent_end",
    });
    const records = await readEmittedRecords(logPath);
    expect(records[1]).toMatchObject({
      event: "processing",
      nativeEvent: "agent_end.toolUseDeferred",
      nativeState: "tool_use_deferred",
    });

    const aggregator = createForegroundActivityAggregator();
    let status: string | undefined;
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(
        parsed,
        resolveAgentEventIngestOptions({
          evidenceSource: "hook",
          event: parsed,
          runtime: ompIntegration.runtime,
        })
      );
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        status = activity.status;
      }
    }
    // 修复前落 TurnCompleted → ready，谎报「等待输入」。
    expect(status).toBe("processing");
  });

  it("ask 问卷走 InteractionRequested，不标成 ToolStart", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp" },
    };
    main.fire("before_agent_start", ctx, {
      prompt: "clean untracked",
      type: "before_agent_start",
    });
    main.fire("tool_execution_start", ctx, {
      intent: "Clarifying destructive cleanup scope",
      toolCallId: "call-ask-1",
      toolName: "ask",
      type: "tool_execution_start",
    });
    main.fire("tool_execution_end", ctx, {
      toolCallId: "call-ask-1",
      toolName: "ask",
      type: "tool_execution_end",
    });
    const records = await readEmittedRecords(logPath);
    expect(records).toMatchObject([
      { event: "PromptSubmit" },
      {
        event: "InteractionRequested",
        interactionId: "call-ask-1",
        interactionKind: "question",
        nativeEvent: "tool_execution_start.ask",
        toolName: "ask",
        toolUseId: "call-ask-1",
      },
      {
        event: "InteractionResolved",
        interactionId: "call-ask-1",
        interactionKind: "question",
        interactionOutcome: "completed",
        nativeEvent: "tool_execution_end.ask",
        toolName: "ask",
        toolUseId: "call-ask-1",
      },
    ]);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(parsed, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual(["processing", "waiting", "processing"]);
  });

  it("裁掉 ask toolCallId 的签名段后仍能进 waiting", async () => {
    const signedId =
      "call-03435de8-1557-4d10-b08f-e49c075729b1-0|K8TGf/h4nJMapPL8yM3t44JgGgk3TKEOI+jwKkoboyPoTTTb3qGLC3+8gxvAK1DM96zSbuGQwFAy5vs/5oMz/SIIxyEPUyabg33AkqAeL35VVtH4FOmWeTq2BqBolwQtzTZB8LIpjT21VOkwqa5vfiBNucbgZEBzgygMDAXFe+NW6AlFVX7Q3XZAgWBJRoR9UvnTIBEoug84EvXwJhXySOKLhuRKdFqoFRzaD7nZhdJBOULdabd2prc/NlU2iLaSMLoYp6g8AX0fGj3Jg5MMOtd8FTMnF0XYeH+JvS/+mQ2Yax8MoPwkE5Q9pO4gRJZQ9yUpzRmkhBKOk6FOLlxEqb5q2BNj4RkH7XFKbGcdlmpY43FSk5amhaAyNHfl0+uYghhTU8d/UA==";
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp" },
    };
    main.fire("before_agent_start", ctx, {
      prompt: "Is 1+1 equal to 2?",
      type: "before_agent_start",
    });
    main.fire("tool_execution_start", ctx, {
      toolCallId: signedId,
      toolName: "ask",
      type: "tool_execution_start",
    });
    const records = await readEmittedRecords(logPath);
    const requested = records[1];
    expect(requested).toMatchObject({
      event: "InteractionRequested",
      interactionId: "call-03435de8-1557-4d10-b08f-e49c075729b1-0",
      toolUseId: "call-03435de8-1557-4d10-b08f-e49c075729b1-0",
    });
    expect(agentHookEventSchema.safeParse(requested).success).toBe(true);
    const aggregator = createForegroundActivityAggregator();
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(parsed, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
    }
    expect(
      (aggregator.snapshot().activities[0] as { status?: string }).status
    ).toBe("waiting");
  });

  it.each([
    {
      expectedEvent: "error",
      expectedNativeEvent: "agent_end.error",
      expectedStatus: "error",
      stopReason: "error",
    },
    {
      expectedEvent: "TurnInterrupted",
      expectedNativeEvent: "agent_end.aborted",
      expectedStatus: "ready",
      stopReason: "aborted",
    },
  ] as const)("真实顺序 session_stop → agent_end($stopReason) 最终为 $expectedEvent", async ({
    expectedEvent,
    expectedNativeEvent,
    expectedStatus,
    stopReason,
  }) => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: { getSessionId: () => "session-omp-terminal" },
    };
    main.fire("before_agent_start", ctx, {
      prompt: "Run the checks",
      type: "before_agent_start",
    });
    main.fire("session_stop", ctx, { type: "session_stop" });
    main.fire("agent_end", ctx, {
      messages: [
        { content: "request", role: "user" },
        {
          content: "terminal",
          errorMessage: "provider stopped",
          role: "assistant",
          stopReason,
        },
      ],
      type: "agent_end",
    });

    const records = await readEmittedRecords(logPath);
    expect(records).toMatchObject([
      { event: "PromptSubmit", v: 3 },
      { event: "Stop", nativeEvent: "session_stop", v: 3 },
      {
        event: expectedEvent,
        nativeEvent: expectedNativeEvent,
        nativeState: stopReason,
        v: 3,
      },
    ]);
    const aggregator = createForegroundActivityAggregator();
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(parsed, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
    }
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: expectedStatus,
    });
  });

  it("从 ctx.sessionManager.getSessionId 写入 sessionId 供重启 resume", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const sessionId = "019f7021-45c3-7000-aa01-d23a7bd03bc0";
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: {
        getSessionFile: () =>
          `/Users/dev/.omp/agent/sessions/-ABC-pier/2026-07-17T12-50-56-579Z_${sessionId}.jsonl`,
        getSessionId: () => sessionId,
      },
    };
    // omp 宿主 session_start 载荷只有 type，sessionId 在 ctx.sessionManager。
    main.fire("session_start", ctx, { type: "session_start" });
    main.fire("before_agent_start", ctx, { type: "before_agent_start" });
    const records = await readEmittedRecords(logPath);
    expect(records).toEqual([
      expect.objectContaining({
        event: "SessionStart",
        sessionId,
      }),
      expect.objectContaining({
        event: "PromptSubmit",
        sessionId,
      }),
    ]);
  });

  it("PromptSubmit 从 event.prompt 写入 promptSnippet", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = { hasUI: true };
    main.fire("before_agent_start", ctx, {
      prompt: "帮我分析下当前未提交的修改",
      type: "before_agent_start",
    });
    const records = await readEmittedRecords(logPath);
    expect(records).toEqual([
      expect.objectContaining({
        event: "PromptSubmit",
        promptSnippet: "帮我分析下当前未提交的修改",
      }),
    ]);
  });

  it("PromptSubmit 可从 sessionManager.getLastUserMessage 取文案", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: {
        getLastUserMessage: () => "fix the flaky test",
        getSessionId: () => "sess-1",
      },
    };
    main.fire("before_agent_start", ctx, { type: "before_agent_start" });
    const records = await readEmittedRecords(logPath);
    expect(records[0]).toMatchObject({
      event: "PromptSubmit",
      promptSnippet: "fix the flaky test",
      sessionId: "sess-1",
    });
  });

  it("PIER_ 环境变量缺失时静默 no-op；恢复后按 emit 调用时读取生效", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = { hasUI: true };
    delete process.env.PIER_PANEL_ID;
    // 守卫拦截且写入是同步路径 → fire 返回后即可断言文件不存在。
    main.fire("session_start", ctx);
    await expect(readFile(logPath, "utf8")).rejects.toThrow();
    // 恢复后生效, 且被拦截的 SessionStart 不会补写（若守卫失效, 它会先于
    // PromptSubmit 出现在文件里）。
    process.env.PIER_PANEL_ID = "panel-1";
    main.fire("before_agent_start", ctx);
    expect(eventsOf(await readEmittedRecords(logPath))).toEqual([
      "PromptSubmit",
    ]);
  });
});

describe("ompHome", () => {
  const ORIG = process.env.PI_CODING_AGENT_DIR;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = ORIG;
    }
  });

  it("默认 ~/.omp/agent", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    expect(ompHome()).toContain(join(".omp", "agent"));
  });

  it("PI_CODING_AGENT_DIR 设置时跟随该路径", () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/omp-home";
    expect(ompHome()).toBe("/custom/omp-home");
  });

  it("不读已废除的 OMP_HOME", () => {
    const origOmpHome = process.env.OMP_HOME;
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.OMP_HOME = "/custom/omp-home";
    expect(ompHome()).toContain(join(".omp", "agent"));
    expect(ompHome()).not.toBe("/custom/omp-home");
    if (origOmpHome === undefined) {
      delete process.env.OMP_HOME;
    } else {
      process.env.OMP_HOME = origOmpHome;
    }
  });
});

describe("ompExtensionPath", () => {
  it("落在 <home>/extensions/pier-agent-status.ts", () => {
    expect(ompExtensionPath()).toContain(
      join("extensions", "pier-agent-status.ts")
    );
  });
});

describe("ompDetect", () => {
  it("返回布尔值", () => {
    expect(typeof ompDetect()).toBe("boolean");
  });

  it("home 目录存在时为真", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-detect-"));
    const origHome = process.env.HOME;
    const origOverride = process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    process.env.HOME = dir;
    await mkdir(join(dir, ".omp", "agent"), { recursive: true });
    vi.resetModules();
    const mod = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(mod.ompDetect()).toBe(true);
    process.env.HOME = origHome;
    if (origOverride === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = origOverride;
    }
    vi.resetModules();
  });
});

describe("install/uninstallOmpExtension (文件 IO)", () => {
  let dir: string;
  let extPath: string;

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    vi.resetModules();
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "pier-omp-io-test-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    extPath = join(dir, "extensions", "pier-agent-status.ts");
  }

  it("detect 为真时安装写入 marker 全文件, 卸载删除该文件", async () => {
    await setup();
    await installOmpExtension(extPath);
    const installed = await readFile(extPath, "utf8");
    expect(installed).toContain(OMP_MARKER);
    await uninstallOmpExtension(extPath);
    await expect(readFile(extPath, "utf8")).rejects.toThrow();
  });

  it("重复安装第二次不改变文件内容（幂等）", async () => {
    await setup();
    await installOmpExtension(extPath);
    const afterFirst = await readFile(extPath, "utf8");
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(afterFirst);
  });

  it("非托管文件（无 marker）不覆盖, 跳过并 warn", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign =
      "// not managed by pier\nexport default function Foo() {}\n";
    await writeFile(extPath, foreign, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uninstall 对非托管文件不删除", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign = "// not managed by pier\n";
    await writeFile(extPath, foreign, "utf8");
    await uninstallOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
  });

  it("uninstall 对不存在的文件零副作用（不抛异常）", async () => {
    await setup();
    await expect(uninstallOmpExtension(extPath)).resolves.toBeUndefined();
  });

  it("自定义 PI_CODING_AGENT_DIR 且路径上无 pi 插件时跟随并安装", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-follow-env-"));
    const origDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/omp.ts"
      );
      expect(mod.ompHome()).toBe(dir);
      await mod.installOmpExtension();
      const installed = await readFile(mod.ompExtensionPath(), "utf8");
      expect(installed).toContain(mod.OMP_MARKER);
      expect(installed).toContain('agent: "omp"');
    } finally {
      if (origDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = origDir;
      }
      vi.resetModules();
    }
  });

  it("pi 已占用同一 pier-agent-status.ts 时跳过并 warn，不改写", async () => {
    await setup();
    const { buildPiExtensionSource } = await import(
      "../../../src/main/services/agents/integrations/pi.ts"
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const piSource = buildPiExtensionSource();
    await writeFile(extPath, piSource, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(piSource);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("detect 为假时（无 home 目录、无 omp 命令）install 不写入任何文件", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pier-omp-nodetect-"));
    delete process.env.PI_CODING_AGENT_DIR;
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = emptyDir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/omp.ts"
      );
      const missingPath = join(
        emptyDir,
        ".omp",
        "agent",
        "extensions",
        "pier-agent-status.ts"
      );
      expect(mod.ompDetect()).toBe(false);
      await mod.installOmpExtension(missingPath);
      await expect(readFile(missingPath, "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      vi.resetModules();
    }
  });
});

describe("ompIntegration 契约", () => {
  it("id 为 omp", async () => {
    const { ompIntegration } = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(ompIntegration.id).toBe("omp");
  });
});
