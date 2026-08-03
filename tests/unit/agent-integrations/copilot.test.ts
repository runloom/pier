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
  installCopilotHooks,
  uninstallCopilotHooks,
  withoutPierCopilotHooks,
  withPierCopilotHooks,
} from "../../../src/main/services/agents/integrations/copilot.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import type { AgentActivity } from "../../../src/shared/contracts/foreground-activity.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const ALL_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "agentStop",
  "preCompact",
  "subagentStart",
  "subagentStop",
  "errorOccurred",
];

interface CopilotHookEntry {
  bash: string;
  matcher?: string;
}

function hookEntries(settings: Record<string, unknown>) {
  return (settings.hooks ?? {}) as Record<string, CopilotHookEntry[]>;
}

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = hookEntries(settings);
  return Object.values(hooks)
    .flat()
    .map((h) => h.bash);
}

describe("withPierCopilotHooks", () => {
  it("只为已核验的 Copilot hook 事实注入命令", () => {
    const next = withPierCopilotHooks({});
    const hooks = hookEntries(next);
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    expect(hooks.permissionRequest).toBeUndefined();
    expect(hooks.notification).toBeUndefined();
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"agentEventV3"');
    }
  });

  it("不安装只有请求通知、没有 ID 与结果事件的 waiting", () => {
    const hooks = hookEntries(withPierCopilotHooks({}));
    expect(hooks.notification).toBeUndefined();
  });

  it("schema 形状：bash 字段 + timeoutSec + type:command", () => {
    const next = withPierCopilotHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ bash: string; timeoutSec?: number; type?: string }>
    >;
    const entry = hooks.sessionStart?.[0];
    expect(entry).toBeDefined();
    expect(typeof entry?.bash).toBe("string");
    expect(entry?.timeoutSec).toBe(5);
    expect(entry?.type).toBe("command");
    expect((entry as { command?: unknown })?.command).toBeUndefined();
    expect((entry as { timeout?: unknown })?.timeout).toBeUndefined();
  });

  it("顶层写入 version:1（无已有 version 时）", () => {
    const next = withPierCopilotHooks({});
    expect(next.version).toBe(1);
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierCopilotHooks({});
    const twice = withPierCopilotHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      hooks: {
        agentStop: [{ bash: "say done", type: "command" }],
      },
    };
    const next = withPierCopilotHooks(user);
    const stop = (next.hooks as Record<string, unknown[]>).agentStop;
    expect(stop).toHaveLength(2);
  });

  it("真实工具失败与 errorOccurred 输入形成严格 v3 事实", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-copilot-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = hookEntries(withPierCopilotHooks({}));
    const commandFor = (nativeEvent: string, matcher?: string) =>
      hooks[nativeEvent]?.find((entry) => entry.matcher === matcher)?.bash ??
      "";
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const run = (
      nativeEvent: string,
      payload: Record<string, unknown>,
      matcher?: string
    ) => {
      const result = spawnSync(
        "/bin/sh",
        ["-c", commandFor(nativeEvent, matcher)],
        { env, input: JSON.stringify(payload) }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(result.stdout.toString()).toBe("");
    };

    run("postToolUseFailure", {
      cwd: "/workspace",
      error: "exit 1",
      sessionId: "session-1",
      timestamp: "2026-07-29T00:00:02Z",
      toolName: "shell",
    });
    run("errorOccurred", {
      cwd: "/workspace",
      error: { message: "retrying", name: "ModelError" },
      errorContext: "model_call",
      recoverable: true,
      sessionId: "session-1",
      timestamp: "2026-07-29T00:00:03Z",
    });
    run("errorOccurred", {
      cwd: "/workspace",
      error: { message: "fatal", name: "SystemError" },
      errorContext: "system",
      recoverable: false,
      sessionId: "session-1",
      timestamp: "2026-07-29T00:00:04Z",
    });

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = agentHookEventSchema.parse(JSON.parse(line));
        if (event.kind !== "agentEvent") {
          throw new Error("expected agent event");
        }
        return event;
      });
    expect(rows).toMatchObject([
      {
        event: "ToolComplete",
        nativeEvent: "postToolUseFailure",
        sessionId: "session-1",
        toolName: "shell",
        v: 3,
      },
      {
        event: "processing",
        nativeEvent: "errorOccurred",
        nativeState: "true",
        sessionId: "session-1",
        v: 3,
      },
      {
        event: "error",
        nativeEvent: "errorOccurred",
        nativeState: "false",
        sessionId: "session-1",
        v: 3,
      },
    ]);
  }, 15_000);

  it("官方子智能体形状只保留父会话作用域，匿名并发可由首次出现的 agentId 逐一关闭", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-copilot-subagent-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = hookEntries(withPierCopilotHooks({}));
    const env = {
      ...process.env,
      PATH: pathForHookSpawn(process.env.PATH),
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const run = (
      nativeEvent: "subagentStart" | "subagentStop",
      payload: object
    ) => {
      const result = spawnSync(
        "/bin/sh",
        ["-c", hooks[nativeEvent]?.[0]?.bash ?? ""],
        { env, input: JSON.stringify(payload) }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
    };
    run("subagentStart", {
      agentName: "research",
      sessionId: "parent-session",
    });
    run("subagentStart", {
      agentName: "review",
      sessionId: "parent-session",
    });
    run("subagentStop", {
      agentId: "worker-1",
      agentName: "research",
      sessionId: "parent-session",
    });
    run("subagentStop", {
      agentId: "worker-2",
      agentName: "review",
      sessionId: "parent-session",
    });

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const event = agentHookEventSchema.parse(JSON.parse(line));
        if (event.kind !== "agentEvent") {
          throw new Error("expected agent event");
        }
        return event;
      });
    expect(rows.slice(0, 2)).toMatchObject([
      {
        actorHint: "subagent",
        agentType: "research",
        event: "SubagentStart",
        parentSessionId: "parent-session",
      },
      {
        actorHint: "subagent",
        agentType: "review",
        event: "SubagentStart",
        parentSessionId: "parent-session",
      },
    ]);
    for (const row of rows.slice(0, 2)) {
      expect(row).not.toHaveProperty("sessionId");
      expect(row).not.toHaveProperty("agentInstanceId");
    }
    expect(rows.slice(2)).toMatchObject([
      {
        agentInstanceId: "worker-1",
        event: "SubagentStop",
        parentSessionId: "parent-session",
      },
      {
        agentInstanceId: "worker-2",
        event: "SubagentStop",
        parentSessionId: "parent-session",
      },
    ]);

    const aggregator = createForegroundActivityAggregator();
    aggregator.ingestAgentEvent(
      {
        agent: "copilot",
        event: "PromptSubmit",
        kind: "agentEvent",
        nativeEvent: "userPromptSubmitted",
        panelId: "p1",
        sessionId: "parent-session",
        v: 3,
        windowId: "w1",
      },
      {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      }
    );
    const counts: number[] = [];
    for (const row of rows) {
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      });
      counts.push(
        (aggregator.snapshot().activities[0] as AgentActivity).subagentCount
      );
    }
    expect(counts).toEqual([1, 2, 1, 0]);
  }, 15_000);
});

describe("withoutPierCopilotHooks", () => {
  it("只移除 pier 条目，保留用户 hook", () => {
    const user = {
      hooks: {
        agentStop: [{ bash: "say done", type: "command" }],
      },
    };
    const cleaned = withoutPierCopilotHooks(withPierCopilotHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).sessionStart
    ).toBeUndefined();
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const user = { hooks: { agentStop: [{ bash: "say done" }] } };
    expect(withoutPierCopilotHooks(user)).toBe(user);
  });
});

describe("install/uninstallCopilotHooks (文件 IO)", () => {
  it("往不存在的 pier.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await installCopilotHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallCopilotHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 pier.json 不被覆盖（安装静默放弃）", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await writeFile(path, "{ not json", "utf8");
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("disableAllHooks=true 时不写入，且发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    const original = JSON.stringify({ disableAllHooks: true });
    await writeFile(path, original, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("无变化不落盘", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    const original = '{"version":1}';
    await writeFile(path, original, "utf8");
    await uninstallCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-copilot-test-"));
    const path = join(dir, "pier.json");
    await installCopilotHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installCopilotHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
