import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const ORIGINAL_PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-grok-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/grok.ts"
  );
  return mod.grokIntegration;
}

function configPath(): string {
  return join(homeDir, ".grok", "hooks", "pier-status.json");
}

describe("grokIntegration", () => {
  it("id 为 grok", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("grok");
  });

  it("detect(): ~/.grok 目录存在时为 true（无需专用配置文件）", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".grok"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("GROK_HOME 覆盖安装与探测目录，并忽略变量两端空白", async () => {
    const customHome = join(homeDir, "custom-grok-home");
    vi.stubEnv("GROK_HOME", `  ${customHome}  `);
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();

    expect(integration.detect()).toBe(false);
    await mkdir(customHome, { recursive: true });
    expect(integration.detect()).toBe(true);

    await integration.install();
    const installed = JSON.parse(
      await readFile(join(customHome, "hooks", "pier-status.json"), "utf8")
    );
    expect(hookCommands(installed)).toHaveLength(13);
  });

  it("空白 GROK_HOME 回落 HOME/.grok", async () => {
    vi.stubEnv("GROK_HOME", "   ");
    const integration = await loadIntegration();
    await integration.install();
    expect(
      hookCommands(JSON.parse(await readFile(configPath(), "utf8")))
    ).toHaveLength(13);
  });

  it("写入专用文件 ~/.grok/hooks/pier-status.json，13 个事件各一条命令（不含 Notification）", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    // 全部事件省略 matcher（empty/omitted = match all；避免裸 "*" 正则）
    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionDenied",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "PreCompact",
      "PostCompact",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    // 不装 Notification：Turn complete / Background task completed 会假 waiting
    expect(hooks.Notification).toBeUndefined();

    // 所有命令都使用 strict v3；工具命令显式消费 Grok camelCase 身份键。
    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"grok"');
      expect(cmd).toContain('"agentEventV3"');
    }
    for (const event of [
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionDenied",
    ]) {
      const cmd = typedHooks[event]?.[0]?.hooks[0]?.command ?? "";
      expect(cmd).toContain("toolUseId");
      expect(cmd).toContain("toolName");
    }

    // pierEvent 名称核验（本机 ~/.grok/docs/user-guide/10-hooks.md 对照）
    expect(typedHooks.PostToolUseFailure?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
    );
    expect(typedHooks.StopFailure?.[0]?.hooks[0]?.command).toContain('"error"');
    expect(typedHooks.PermissionDenied?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    // plan / ask_user 阻塞工具 → Interaction*（19-plan-mode.md）
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      "exit_plan_mode"
    );
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"InteractionRequested"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"InteractionResolved"'
    );
    expect(typedHooks.SubagentStart?.[0]?.hooks[0]?.command).toContain(
      '"SubagentStart"'
    );
    expect(typedHooks.SubagentStop?.[0]?.hooks[0]?.command).toContain(
      '"SubagentStop"'
    );
    expect(typedHooks.PreCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
    expect(typedHooks.PostCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
  });

  it("exit_plan_mode PreToolUse 上报 InteractionRequested，普通工具仍 ToolStart", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const preTool = hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "";
    const postTool = hooks.PostToolUse?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-grok-plan-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const common = {
      cwd: "/repo",
      permissionMode: "plan",
      sessionId: "grok-plan-1",
      timestamp: "2026-08-05T12:00:00Z",
      workspaceRoot: "/repo",
    };
    for (const [cmd, payload] of [
      [
        preTool,
        {
          ...common,
          hookEventName: "pre_tool_use",
          toolInput: {},
          toolInputTruncated: false,
          toolName: "exit_plan_mode",
          toolUseId: "plan-tool-1",
        },
      ],
      [
        postTool,
        {
          ...common,
          hookEventName: "post_tool_use",
          toolInput: {},
          toolInputTruncated: false,
          toolName: "exit_plan_mode",
          toolResult: "approved",
          toolUseId: "plan-tool-1",
        },
      ],
      [
        preTool,
        {
          ...common,
          hookEventName: "pre_tool_use",
          toolInput: { command: "ls" },
          toolInputTruncated: false,
          toolName: "run_terminal_command",
          toolUseId: "shell-1",
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
        agent: "grok",
        event: "InteractionRequested",
        interactionId: "plan-tool-1",
        interactionKind: "permission",
        toolName: "exit_plan_mode",
        toolUseId: "plan-tool-1",
        v: 3,
      },
      {
        agent: "grok",
        event: "InteractionResolved",
        interactionId: "plan-tool-1",
        interactionKind: "permission",
        interactionOutcome: "completed",
        toolName: "exit_plan_mode",
        v: 3,
      },
      {
        agent: "grok",
        event: "ToolStart",
        toolName: "run_terminal_command",
        toolUseId: "shell-1",
        v: 3,
      },
    ]);
  }, 15_000);

  it("0.2.114 官方载荷：子智能体在父会话启动、子会话停止，并发与重复停止均闭环", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const command = (event: string) =>
      hooks[event]?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-grok-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const common = {
      cwd: "/repo",
      hookEventName: "fixture",
      permissionMode: "default",
      sessionId: "grok-session-1",
      timestamp: "2026-07-29T12:00:00Z",
      workspaceRoot: "/repo",
    };
    for (const [event, payload] of [
      ["SessionStart", { ...common, hookEventName: "session_start" }],
      [
        "UserPromptSubmit",
        {
          ...common,
          hookEventName: "user_prompt_submit",
          prompt: "Fix the parser",
        },
      ],
      [
        "PreToolUse",
        {
          ...common,
          hookEventName: "pre_tool_use",
          toolInput: { command: "pnpm test" },
          toolInputTruncated: false,
          toolName: "run_terminal_command",
          toolUseId: "tool-grok-1",
        },
      ],
      [
        "PostToolUseFailure",
        {
          ...common,
          error: "command_failed",
          hookEventName: "post_tool_use_failure",
          toolInput: { command: "pnpm test" },
          toolInputTruncated: false,
          toolName: "run_terminal_command",
          toolUseId: "tool-grok-1",
        },
      ],
      [
        "PreToolUse",
        {
          ...common,
          hookEventName: "pre_tool_use",
          toolInput: { path: "/repo/.env" },
          toolInputTruncated: false,
          toolName: "read_file",
          toolUseId: "tool-grok-2",
        },
      ],
      [
        "PermissionDenied",
        {
          ...common,
          hookEventName: "permission_denied",
          toolInput: { path: "/repo/.env" },
          toolInputTruncated: false,
          toolName: "read_file",
          toolUseId: "tool-grok-2",
        },
      ],
      [
        "SubagentStart",
        {
          ...common,
          hookEventName: "subagent_start",
          subagentId: "subagent-grok-1",
          subagentType: "explore",
        },
      ],
      [
        "SubagentStart",
        {
          ...common,
          hookEventName: "subagent_start",
          subagentId: "subagent-grok-2",
          subagentType: "explore",
        },
      ],
      [
        "SubagentStop",
        {
          ...common,
          hookEventName: "subagent_stop",
          phase: "gate",
          sessionId: "subagent-grok-1",
          subagentId: "subagent-grok-1",
          subagentType: "explore",
        },
      ],
      [
        "SubagentStop",
        {
          ...common,
          hookEventName: "subagent_stop",
          phase: "gate",
          sessionId: "subagent-grok-1",
          subagentId: "subagent-grok-1",
          subagentType: "explore",
        },
      ],
      [
        "SubagentStop",
        {
          ...common,
          hookEventName: "subagent_stop",
          phase: "gate",
          sessionId: "subagent-grok-2",
          subagentId: "subagent-grok-2",
          subagentType: "explore",
        },
      ],
      [
        "Stop",
        {
          ...common,
          backgroundTasks: [],
          hookEventName: "stop",
          reason: "end_turn",
          sessionCrons: [],
        },
      ],
      [
        "StopFailure",
        {
          ...common,
          error: "rate_limit",
          errorDetails: "capacity unavailable",
          hookEventName: "stop_failure",
          lastAssistantMessage: "Please retry later.",
        },
      ],
      [
        "SessionEnd",
        {
          ...common,
          hookEventName: "session_end",
          reason: "channel_closed",
        },
      ],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", command(event)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(ORIGINAL_PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      { event: "SessionStart", sessionId: "grok-session-1", v: 3 },
      { event: "PromptSubmit", sessionId: "grok-session-1", v: 3 },
      {
        event: "ToolStart",
        toolName: "run_terminal_command",
        toolUseId: "tool-grok-1",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PostToolUseFailure",
        toolName: "run_terminal_command",
        toolUseId: "tool-grok-1",
        v: 3,
      },
      {
        event: "ToolStart",
        toolName: "read_file",
        toolUseId: "tool-grok-2",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PermissionDenied",
        toolName: "read_file",
        toolUseId: "tool-grok-2",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-grok-1",
        agentType: "explore",
        event: "SubagentStart",
        parentSessionId: "grok-session-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-grok-2",
        agentType: "explore",
        event: "SubagentStart",
        parentSessionId: "grok-session-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-grok-1",
        agentType: "explore",
        event: "SubagentStop",
        sessionId: "subagent-grok-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-grok-1",
        agentType: "explore",
        event: "SubagentStop",
        sessionId: "subagent-grok-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-grok-2",
        agentType: "explore",
        event: "SubagentStop",
        sessionId: "subagent-grok-2",
        v: 3,
      },
      { event: "Stop", nativeState: "end_turn", v: 3 },
      { event: "error", nativeState: "rate_limit", v: 3 },
      { event: "SessionEnd", nativeState: "channel_closed", v: 3 },
    ]);

    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows.slice(0, 6)) {
      if (row.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: integration.runtime.stopAuthority,
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual([
      undefined,
      "processing",
      "tool",
      "processing",
      "tool",
      "processing",
    ]);

    const lifecycleAggregator = createForegroundActivityAggregator();
    const lifecycleRows = rows.filter(
      (row) =>
        row.kind === "agentEvent" &&
        (row.event === "SessionStart" ||
          row.event === "PromptSubmit" ||
          row.event === "SubagentStart" ||
          row.event === "SubagentStop")
    );
    const counts: number[] = [];
    const accepted: boolean[] = [];
    for (const row of lifecycleRows) {
      if (row.kind !== "agentEvent") {
        continue;
      }
      accepted.push(
        lifecycleAggregator.ingestAgentEvent(row, {
          evidenceSource: "hook",
          stopAuthority: integration.runtime.stopAuthority,
          turnStartAuthority: "none",
        })
      );
      const activity = lifecycleAggregator.snapshot().activities[0];
      if (activity?.kind === "agent") {
        counts.push(activity.subagentCount);
      }
    }
    expect(accepted).toEqual([true, true, true, true, true, false, true]);
    expect(counts).toEqual([0, 1, 2, 1, 1, 0]);
  }, 15_000);

  it("幂等：重复安装不产生重复条目", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const once = JSON.parse(await readFile(configPath(), "utf8"));
    await integration.install();
    const twice = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("重复安装第二次不改变文件字节", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const afterFirst = await readFile(configPath(), "utf8");
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(afterFirst);
  });

  it("卸载后专用文件的 hooks 变为空对象（条目全清）", async () => {
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
    expect(cleaned.hooks).toEqual({});
  });

  it("已损坏的专用文件不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".grok", "hooks"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".grok", "hooks"), { recursive: true });
    const original = '{"hooks":{}}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
