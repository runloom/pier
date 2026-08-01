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
      { stopAuthority: "advisory" }
    );
    aggregator.ingestAgentEvent(event, { stopAuthority: "advisory" });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      sessionId: "parent-conversation-1",
      subagentCount: 1,
    } satisfies Partial<AgentActivity>);
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
