import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import {
  CURSOR_EVENTS,
  installCursorHooks,
  uninstallCursorHooks,
  withoutPierCursorHooks,
  withPierCursorHooks,
} from "../../../src/main/services/agents/integrations/cursor.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import type { AgentActivity } from "../../../src/shared/contracts/foreground-activity.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const ALL_EVENTS = [
  "sessionStart",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "subagentStart",
  "subagentStop",
  "stop",
  "sessionEnd",
];

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ command: string }>
  >;
  return Object.values(hooks)
    .flat()
    .map((h) => h.command);
}

describe("withPierCursorHooks", () => {
  it("为全部 9 个 cursor hook 事件各注入一条 pier 命令", () => {
    const next = withPierCursorHooks({});
    const hooks = next.hooks as Record<string, Array<{ command: string }>>;
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    expect(Object.keys(hooks).sort()).toEqual([...ALL_EVENTS].sort());
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("不安装 afterAgentResponse——回合尾与 stop 竞态, 会把终态拉回 processing", () => {
    const next = withPierCursorHooks({});
    const hooks = next.hooks as Record<string, unknown>;
    expect(hooks.afterAgentResponse).toBeUndefined();
    expect(
      CURSOR_EVENTS.some((event) => event.nativeEvent === "afterAgentResponse")
    ).toBe(false);
  });

  it("不安装 shell/MCP 闸门事件——无 tool_use_id 无法配对, 拒绝执行时匿名计数滞留", () => {
    const hooks = withPierCursorHooks({}).hooks as Record<string, unknown>;
    for (const nativeEvent of [
      "beforeShellExecution",
      "beforeMCPExecution",
      "afterShellExecution",
      "afterMCPExecution",
    ]) {
      expect(hooks[nativeEvent], nativeEvent).toBeUndefined();
      expect(
        CURSOR_EVENTS.some((event) => event.nativeEvent === nativeEvent),
        nativeEvent
      ).toBe(false);
    }
    // 工具生命周期由带 tool_use_id 的 preToolUse/postToolUse(-Failure) 覆盖
    expect(
      CURSOR_EVENTS.find((event) => event.nativeEvent === "preToolUse")
        ?.pierEvent
    ).toBe("ToolStart");
    const preTool = (
      withPierCursorHooks({}).hooks as Record<
        string,
        Array<{ command: string }>
      >
    ).preToolUse?.[0]?.command;
    expect(preTool).toContain("CreatePlan");
    expect(preTool).toContain("SwitchMode");
    expect(preTool).toContain("InteractionRequested");
    expect(preTool).not.toContain("AskQuestion");
  });

  it("stop / subagentStop 写入 loop_limit: null，避免默认 5 次后停报终态", () => {
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string; loop_limit?: number | null }>
    >;
    expect(hooks.stop?.[0]?.loop_limit).toBeNull();
    expect(hooks.subagentStop?.[0]?.loop_limit).toBeNull();
    expect(hooks.preToolUse?.[0]?.loop_limit).toBeUndefined();
  });

  it("stop 命令按 payload status 分发可信终态, 未知值回落 Stop", () => {
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const stopCommand = hooks.stop?.[0]?.command ?? "";
    expect(stopCommand).toContain('completed) _pier_event="TurnCompleted"');
    expect(stopCommand).toContain('aborted) _pier_event="TurnInterrupted"');
    expect(stopCommand).toContain('error) _pier_event="error"');
    expect(stopCommand).toContain('*) _pier_event="Stop"');
    expect(stopCommand).toContain('"$_pier_event" "stop"');
  });

  it("stop 命令经真实 /bin/sh + emit 执行, 三种 status 与缺省各落正确事件", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-e2e-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const stopCommand = hooks.stop?.[0]?.command ?? "";
    const runStop = (payload: string): void => {
      const result = spawnSync("/bin/sh", ["-c", stopCommand], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(process.env.PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
        },
        input: payload,
      });
      expect(result.status).toBe(0);
    };
    runStop(
      '{"conversation_id":"c1","generation_id":"g1","status":"completed","loop_count":0}'
    );
    runStop('{"conversation_id":"c1","generation_id":"g2","status":"aborted"}');
    runStop('{"conversation_id":"c1","generation_id":"g3","status":"error"}');
    runStop('{"conversation_id":"c1","generation_id":"g4"}');
    const lines = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)))
      .map((entry) => {
        if (entry.kind !== "agentEvent" || entry.v !== 3) {
          throw new Error("expected v3 agent event");
        }
        return entry;
      });
    expect(
      lines.map((entry) => [
        entry.event,
        entry.nativeEvent,
        entry.sessionId,
        entry.turnId,
        entry.v,
      ])
    ).toEqual([
      ["TurnCompleted", "stop", "c1", "g1", 3],
      ["TurnInterrupted", "stop", "c1", "g2", 3],
      ["error", "stop", "c1", "g3", 3],
      ["Stop", "stop", "c1", "g4", 3],
    ]);
  }, 15_000);

  it("Cursor 子智能体重复的父 conversation/generation 不冒充独立子会话身份", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-subagent-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const result = spawnSync(
      "/bin/sh",
      ["-c", hooks.subagentStart?.[0]?.command ?? ""],
      {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(process.env.PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "p1",
          PIER_WINDOW_ID: "w1",
        },
        input: JSON.stringify({
          conversation_id: "parent-conversation-1",
          generation_id: "parent-generation-1",
          hook_event_name: "subagentStart",
          parent_conversation_id: "parent-conversation-1",
          subagent_id: "subagent-1",
          subagent_type: "explore",
          tool_call_id: "call-1",
        }),
      }
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    const event = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    if (event.kind !== "agentEvent") {
      throw new Error("expected agent event");
    }
    expect(event).toMatchObject({
      actorHint: "subagent",
      agentInstanceId: "subagent-1",
      event: "SubagentStart",
      nativeEvent: "subagentStart",
      parentSessionId: "parent-conversation-1",
      toolUseId: "call-1",
      v: 3,
    });
    expect(event).not.toHaveProperty("sessionId");
    expect(event).not.toHaveProperty("turnId");

    const aggregator = createForegroundActivityAggregator();
    aggregator.ingestAgentEvent(
      {
        agent: "cursor",
        event: "PromptSubmit",
        kind: "agentEvent",
        nativeEvent: "beforeSubmitPrompt",
        panelId: "p1",
        sessionId: "parent-conversation-1",
        turnId: "parent-generation-1",
        v: 3,
        windowId: "w1",
      },
      {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      }
    );
    aggregator.ingestAgentEvent(event, {
      evidenceSource: "hook",
      stopAuthority: "advisory",
      turnStartAuthority: "none",
    });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      sessionId: "parent-conversation-1",
      subagentCount: 1,
    } satisfies Partial<AgentActivity>);
  }, 15_000);

  it("Task 派发按 Subagent 生命周期上报：抑制子智能体 generation、会话转挂父级", async () => {
    // 2026-08-29 实证：Task preToolUse 带主 conversation_id + 子智能体
    // generation_id 且从不发 postToolUse；按 ToolStart 记账会抢占主回合，
    // 让真回合的 stop 被 settled-turn 拒收（面板钉死「执行工具中」）。
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-task-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const taskPayload = {
      conversation_id: "main-conversation-1",
      generation_id: "subagent-generation-leak",
      tool_name: "Task",
      tool_use_id: "call-task-1",
    };
    for (const cmd of [
      hooks.preToolUse?.[0]?.command ?? "",
      hooks.postToolUse?.[0]?.command ?? "",
    ]) {
      const result = spawnSync("/bin/sh", ["-c", cmd], {
        env,
        input: JSON.stringify(taskPayload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        agent: "cursor",
        event: "SubagentStart",
        nativeEvent: "preToolUse",
        parentSessionId: "main-conversation-1",
        toolName: "Task",
        toolUseId: "call-task-1",
        v: 3,
      },
      {
        agent: "cursor",
        event: "SubagentStop",
        nativeEvent: "postToolUse",
        parentSessionId: "main-conversation-1",
        toolName: "Task",
        toolUseId: "call-task-1",
        v: 3,
      },
    ]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("sessionId");
      expect(row).not.toHaveProperty("turnId");
    }

    // 聚合器闭环：Task 只计数不改状态，真回合 stop 正常封账。
    const aggregator = createForegroundActivityAggregator();
    const ingestOptions = {
      evidenceSource: "hook",
      stopAuthority: "advisory",
      turnStartAuthority: "none",
    } as const;
    aggregator.ingestAgentEvent(
      {
        agent: "cursor",
        event: "PromptSubmit",
        kind: "agentEvent",
        nativeEvent: "beforeSubmitPrompt",
        panelId: "p1",
        sessionId: "main-conversation-1",
        turnId: "5eb99524-9ef4-48a3-af34-f549d81b70ad",
        v: 3,
        windowId: "w1",
      },
      ingestOptions
    );
    const startRow = rows[0];
    if (startRow?.kind !== "agentEvent") {
      throw new Error("expected agent event");
    }
    aggregator.ingestAgentEvent(
      { ...startRow, panelId: "p1", windowId: "w1" },
      ingestOptions
    );
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "processing",
      subagentCount: 1,
    } satisfies Partial<AgentActivity>);
    aggregator.ingestAgentEvent(
      {
        agent: "cursor",
        event: "TurnCompleted",
        kind: "agentEvent",
        nativeEvent: "stop",
        panelId: "p1",
        sessionId: "main-conversation-1",
        turnId: "5eb99524-9ef4-48a3-af34-f549d81b70ad",
        v: 3,
        windowId: "w1",
      },
      ingestOptions
    );
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      status: "ready",
      subagentCount: 0,
    } satisfies Partial<AgentActivity>);
    aggregator.dispose();
  }, 15_000);

  it("CreatePlan preToolUse 上报 InteractionRequested，普通工具仍 ToolStart", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-plan-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const preTool = hooks.preToolUse?.[0]?.command ?? "";
    const postTool = hooks.postToolUse?.[0]?.command ?? "";
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    for (const [cmd, payload] of [
      [
        preTool,
        {
          conversation_id: "c1",
          generation_id: "g1",
          tool_name: "CreatePlan",
          tool_use_id: "plan-1",
        },
      ],
      [
        postTool,
        {
          conversation_id: "c1",
          generation_id: "g1",
          tool_name: "CreatePlan",
          tool_use_id: "plan-1",
        },
      ],
      [
        preTool,
        {
          conversation_id: "c1",
          generation_id: "g1",
          tool_name: "Shell",
          tool_use_id: "shell-1",
        },
      ],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", cmd], {
        env,
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        agent: "cursor",
        event: "InteractionRequested",
        interactionId: "plan-1",
        interactionKind: "permission",
        toolName: "CreatePlan",
        toolUseId: "plan-1",
        v: 3,
      },
      {
        agent: "cursor",
        event: "InteractionResolved",
        interactionId: "plan-1",
        interactionKind: "permission",
        interactionOutcome: "completed",
        toolName: "CreatePlan",
        v: 3,
      },
      {
        agent: "cursor",
        event: "ToolStart",
        toolName: "Shell",
        toolUseId: "shell-1",
        v: 3,
      },
    ]);
  }, 15_000);

  it("schema 形状：command 直接在定义对象上（非嵌套 hooks 数组）", () => {
    const next = withPierCursorHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ command: string; timeout?: number }>
    >;
    const entry = hooks.sessionStart?.[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.command).toBe("string");
    expect(entry?.timeout).toBe(10);
    expect((entry as { hooks?: unknown })?.hooks).toBeUndefined();
  });

  it("顶层写入 version:1（无已有 version 时）", () => {
    const next = withPierCursorHooks({});
    expect(next.version).toBe(1);
  });

  it("保留已有的 version 值", () => {
    const next = withPierCursorHooks({ version: 1, foo: "bar" });
    expect(next.version).toBe(1);
    expect(next.foo).toBe("bar");
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCursorHooks({});
    const twice = withPierCursorHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      hooks: {
        stop: [{ command: "say done" }],
      },
      version: 1,
    };
    const next = withPierCursorHooks(user);
    const stop = (next.hooks as Record<string, unknown[]>).stop;
    expect(stop).toHaveLength(2);
  });
});

describe("withoutPierCursorHooks", () => {
  it("只移除 pier 条目，保留用户 hook", () => {
    const user = {
      hooks: {
        stop: [{ command: "say done" }],
      },
      version: 1,
    };
    const cleaned = withoutPierCursorHooks(withPierCursorHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).sessionStart
    ).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { stop: [{ command: "say done" }] } };
    expect(withoutPierCursorHooks(user)).toBe(user);
  });

  it("清掉遗留 PIER_AGENT_HOOK_PORT curl（含已废弃的 shell 闸门事件）", () => {
    const legacyPort =
      '[ -n "$PIER_AGENT_HOOK_PORT" ] && [ -n "$PIER_PANEL_ID" ] && curl -fsS -m 2 -X POST "http://127.0.0.1:$PIER_AGENT_HOOK_PORT/agent-event" || true';
    const dirty = {
      hooks: {
        beforeShellExecution: [{ command: legacyPort, timeout: 10 }],
        preToolUse: [
          { command: legacyPort, timeout: 10 },
          { command: "echo user-owned", timeout: 10 },
        ],
      },
      version: 1,
    };
    const cleaned = withoutPierCursorHooks(dirty);
    const hooks = cleaned.hooks as Record<string, Array<{ command: string }>>;
    expect(hooks.beforeShellExecution).toBeUndefined();
    expect(hooks.preToolUse?.map((e) => e.command)).toEqual([
      "echo user-owned",
    ]);
  });
});

describe("cursor pier hooks under Grok compat load", () => {
  it("GROK_HOOK_EVENT 存在时跳过 emit（避免 agent=cursor 双写）", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-grok-guard-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierCursorHooks({}).hooks as Record<
      string,
      Array<{ command: string }>
    >;
    const preTool = hooks.preToolUse?.[0]?.command ?? "";
    expect(preTool).toContain("GROK_HOOK_EVENT");
    const result = spawnSync("/bin/sh", ["-c", preTool], {
      env: {
        ...process.env,
        PATH: pathForHookSpawn(process.env.PATH),
        GROK_HOOK_EVENT: '{"hookEventName":"PreToolUse"}',
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "p1",
        PIER_WINDOW_ID: "w1",
      },
      input: "{}",
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    expect(await readFile(logPath, "utf8").catch(() => "")).toBe("");
  });
});

describe("install/uninstallCursorHooks (文件 IO)", () => {
  it("往不存在的 hooks.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await installCursorHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(installed.version).toBe(1);
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallCursorHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("重装剔除上一版遗留的 pier 事件条目（如 afterAgentResponse）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    const legacy = {
      hooks: {
        afterAgentResponse: [
          {
            command: `[ -x "\${${MARK}}/emit" ] && "\${${MARK}}/emit" legacy || true`,
            timeout: 10,
          },
        ],
        stop: [{ command: "say done" }],
      },
      version: 1,
    };
    await writeFile(path, JSON.stringify(legacy), "utf8");
    await installCursorHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(installed.hooks.afterAgentResponse).toBeUndefined();
    expect(
      installed.hooks.stop.map((entry: { command: string }) => entry.command)
    ).toContain("say done");
  });

  it("已损坏的 hooks.json 不被覆盖（安装静默放弃）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, "{ not json", "utf8");
    await installCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it.each([
    '{"hooks":"user-value"}',
    '{"hooks":{"stop":{"custom":true}}}',
    '{"hooks":{},"version":"user-version"}',
  ])("合法 JSON 的异常 Cursor shape 安装时保持字节不变：%s", async (raw) => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-shape-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, raw, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await installCursorHooks(path);
      expect(await readFile(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("无变化不落盘", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    const original = '{"version":1}';
    await writeFile(path, original, "utf8");
    await uninstallCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cursor-test-"));
    const path = join(dir, "hooks.json");
    await installCursorHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCursorHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
