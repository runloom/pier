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
  homeDir = await mkdtemp(join(tmpdir(), "pier-qwen-code-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/qwen-code.ts"
  );
  return mod.qwenCodeIntegration;
}

function configPath(): string {
  return join(homeDir, ".qwen", "settings.json");
}

describe("qwenCodeIntegration", () => {
  it("id 为 qwen-code", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("qwen-code");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".qwen"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("只安装 12 个有确定状态语义的当前官方事件", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;
    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "StopFailure",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "PostCompact",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    // 不是 "Error"（官方文档零命中该名，真名是 StopFailure）
    expect(hooks.Error).toBeUndefined();
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.PermissionDenied).toBeUndefined();
    expect(hooks.Notification).toBeUndefined();

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"qwen-code"');
    }

    expect(typedHooks.StopFailure?.[0]?.hooks[0]?.command).toContain('"error"');
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolStart"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.PostToolUseFailure?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      '"PromptSubmit"'
    );
    expect(typedHooks.PreCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
    expect(typedHooks.PostCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
  });

  it("官方载荷：工具与子智能体具名闭环，权限请求不伪造等待，工具失败保持局部", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const command = (event: string) =>
      hooks[event]?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-qwen-code-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const common = {
      cwd: "/repo",
      session_id: "qwen-session-1",
      transcript_path: "/tmp/qwen-session-1.jsonl",
    };
    for (const [event, payload] of [
      ["SessionStart", { ...common, hook_event_name: "SessionStart" }],
      [
        "UserPromptSubmit",
        {
          ...common,
          hook_event_name: "UserPromptSubmit",
          prompt: "Fix the parser",
        },
      ],
      [
        "PreToolUse",
        {
          ...common,
          hook_event_name: "PreToolUse",
          tool_input: { command: "pnpm test" },
          tool_name: "Bash",
          tool_use_id: "tool-qwen-1",
        },
      ],
      [
        "PostToolUseFailure",
        {
          ...common,
          error: "tests failed",
          hook_event_name: "PostToolUseFailure",
          is_interrupt: false,
          tool_input: { command: "pnpm test" },
          tool_name: "Bash",
          tool_use_id: "tool-qwen-1",
        },
      ],
      [
        "SubagentStart",
        {
          ...common,
          agent_id: "subagent-qwen-1",
          agent_type: "Explorer",
          hook_event_name: "SubagentStart",
        },
      ],
      [
        "SubagentStop",
        {
          ...common,
          agent_id: "subagent-qwen-1",
          agent_transcript_path: "/tmp/subagent-qwen-1.jsonl",
          agent_type: "Explorer",
          hook_event_name: "SubagentStop",
          stop_hook_active: false,
        },
      ],
      ["Stop", { ...common, hook_event_name: "Stop" }],
      [
        "StopFailure",
        {
          ...common,
          error: "rate_limit",
          error_details: "try later",
          hook_event_name: "StopFailure",
        },
      ],
      ["SessionEnd", { ...common, hook_event_name: "SessionEnd" }],
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
      { event: "SessionStart", sessionId: "qwen-session-1", v: 3 },
      { event: "PromptSubmit", sessionId: "qwen-session-1", v: 3 },
      {
        event: "ToolStart",
        toolName: "Bash",
        toolUseId: "tool-qwen-1",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PostToolUseFailure",
        toolName: "Bash",
        toolUseId: "tool-qwen-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-qwen-1",
        agentType: "Explorer",
        event: "SubagentStart",
        parentSessionId: "qwen-session-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-qwen-1",
        agentType: "Explorer",
        event: "SubagentStop",
        parentSessionId: "qwen-session-1",
        v: 3,
      },
      { event: "Stop", v: 3 },
      { event: "error", nativeState: "rate_limit", v: 3 },
      { event: "SessionEnd", v: 3 },
    ]);

    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows.slice(0, 4)) {
      if (row.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(row, integration.runtime);
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual([undefined, "processing", "tool", "processing"]);
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

  it("保留用户已有的无关 hook 与顶层配置", async () => {
    await mkdir(join(homeDir, ".qwen"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "qwen-max",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("qwen-max");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".qwen"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".qwen"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".qwen"), { recursive: true });
    const original = '{"model":"qwen-max"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
