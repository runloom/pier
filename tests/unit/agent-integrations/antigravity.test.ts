import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  PIER_HOOK_COMMAND_GENERATION,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import {
  antigravityIntegration,
  installAntigravityHooks,
  uninstallAntigravityHooks,
  withoutPierAntigravityHooks,
  withPierAntigravityHooks,
} from "../../../src/main/services/agents/integrations/antigravity.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const PIER_HOOK_NAME = "pier-agent-status";
const ALL_EVENTS = ["PreInvocation", "Stop"];
const HIGHER_HOOK_GENERATION = PIER_HOOK_COMMAND_GENERATION + 1;

interface AntigravityHandler {
  command: string;
  timeout?: number;
  type: "command";
}

function pierHookDefinition(
  settings: Record<string, unknown>
): Record<string, AntigravityHandler[]> {
  return (settings[PIER_HOOK_NAME] ?? {}) as Record<
    string,
    AntigravityHandler[]
  >;
}

function hookCommands(settings: Record<string, unknown>): string[] {
  return Object.values(pierHookDefinition(settings))
    .flat()
    .map((handler) => handler.command);
}

describe("withPierAntigravityHooks", () => {
  it("按官方命名 hook 顶层结构只注入 2 个有状态证据的事件", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(next.hooks).toBeUndefined();
    for (const evt of ALL_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(hooks[evt]?.[0]).toMatchObject({
        timeout: 5,
        type: "command",
      });
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("CRITICAL: 绝不安装 PreToolUse 键（Antigravity 用它做权限阻塞判定, cmux#4768）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(Object.keys(hooks)).not.toContain("PreToolUse");
    expect(hooks.PreToolUse).toBeUndefined();
  });

  it("不安装 PostInvocation（与 Stop 语义重叠，避免双 Stop）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(hooks.PostInvocation).toBeUndefined();
  });

  it("不安装 Notification（无确证信源支撑 PermissionRequest 映射）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(hooks.Notification).toBeUndefined();
  });

  it("不安装 PostToolUse（官方载荷不足以证明工具生命周期）", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(hooks.PostToolUse).toBeUndefined();
  });

  it("PreInvocation 只表示 processing，Stop 命令按 fullyIdle/error 精确分支", () => {
    const next = withPierAntigravityHooks({});
    const hooks = pierHookDefinition(next);
    expect(hooks.PreInvocation?.[0]?.command).toContain('"processing"');
    expect(hooks.Stop?.[0]?.command).toContain('"Stop"');
    expect(hooks.Stop?.[0]?.command).toContain('"error"');
    expect(hooks.Stop?.[0]?.command).toContain('"agentEventV3"');
  });

  it("官方 camelCase 载荷：写入严格 v3 事件并返回合法 hook JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-antigravity-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = pierHookDefinition(withPierAntigravityHooks({}));
    const command = (event: string) => hooks[event]?.[0]?.command ?? "";
    const outputs: string[] = [];
    for (const [event, payload] of [
      [
        "PreInvocation",
        {
          conversationId: "conversation-a",
          hook_event_name: "PreInvocation",
          invocationNum: 2,
        },
      ],
      [
        "Stop",
        {
          conversationId: "conversation-a",
          fullyIdle: false,
          hook_event_name: "Stop",
          terminationReason: "tool_pending",
        },
      ],
      [
        "Stop",
        {
          conversationId: "conversation-a",
          fullyIdle: true,
          hook_event_name: "Stop",
          terminationReason: "completed",
        },
      ],
      [
        "Stop",
        {
          conversationId: "conversation-a",
          error: "model crashed",
          fullyIdle: true,
          hook_event_name: "Stop",
          terminationReason: "error",
        },
      ],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", command(event)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(process.env.PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
      outputs.push(result.stdout.toString().trim());
    }
    expect(outputs[0]).toBe("{}");
    expect(outputs.slice(1)).toEqual([
      '{"decision":""}',
      '{"decision":""}',
      '{"decision":""}',
    ]);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        event: "processing",
        nativeEvent: "PreInvocation",
        sessionId: "conversation-a",
        v: 3,
      },
      {
        event: "processing",
        nativeEvent: "Stop.active",
        nativeState: "tool_pending",
      },
      {
        event: "Stop",
        nativeEvent: "Stop.fullyIdle",
        nativeState: "completed",
      },
      {
        event: "error",
        nativeEvent: "Stop.error",
        nativeState: "model crashed",
      },
    ]);
    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "advisory",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual(["processing", "processing", undefined, "error"]);
  }, 15_000);

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierAntigravityHooks({});
    const twice = withPierAntigravityHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户命名 hook、顶层配置，以及用户自建的 PreToolUse 条目", () => {
    const user = {
      model: "antigravity-1",
      "user-hook": {
        PreToolUse: [
          { type: "command", command: "user-permission-gate", timeout: 12 },
        ],
        PostInvocation: [{ type: "command", command: "say done", timeout: 12 }],
      },
    };
    const next = withPierAntigravityHooks(user);
    expect(next.model).toBe("antigravity-1");
    expect(next["user-hook"]).toEqual(user["user-hook"]);
  });

  it("同名 hook 已被用户占用时不覆盖", () => {
    const user = {
      [PIER_HOOK_NAME]: {
        Stop: [{ type: "command", command: "user-stop", timeout: 12 }],
      },
    };
    expect(withPierAntigravityHooks(user)).toBe(user);
  });
});

describe("withoutPierAntigravityHooks", () => {
  it("只移除 Pier 命名 hook，保留用户命名 hook", () => {
    const user = {
      "user-hook": {
        PreToolUse: [
          { type: "command", command: "user-permission-gate", timeout: 12 },
        ],
      },
    };
    const cleaned = withoutPierAntigravityHooks(withPierAntigravityHooks(user));
    expect(cleaned[PIER_HOOK_NAME]).toBeUndefined();
    expect(cleaned["user-hook"]).toEqual(user["user-hook"]);
  });

  it("保留误加在 Pier 命名定义内的用户 handler，只移除 Pier handler", () => {
    const installed = withPierAntigravityHooks({});
    const definition = pierHookDefinition(installed);
    definition.Stop?.push({
      command: "say user-stop",
      timeout: 12,
      type: "command",
    });
    const cleaned = withoutPierAntigravityHooks(installed);
    expect(pierHookDefinition(cleaned)).toEqual({
      Stop: [{ command: "say user-stop", timeout: 12, type: "command" }],
    });
  });

  it("升级时只清理旧错误嵌套结构中的 Pier 条目", () => {
    const legacy = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "user-stop" },
              { type: "command", command: `\${${MARK}}/emit legacy` },
            ],
          },
        ],
      },
    };
    const upgraded = withPierAntigravityHooks(legacy);
    const legacyStop = (
      upgraded.hooks as {
        Stop: Array<{ hooks: Array<{ command: string }> }>;
      }
    ).Stop;
    expect(legacyStop).toEqual([
      { hooks: [{ type: "command", command: "user-stop" }] },
    ]);
    expect(hookCommands(upgraded)).toHaveLength(2);
  });
});

describe("install/uninstallAntigravityHooks (文件 IO)", () => {
  it("往不存在的 hooks.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await installAntigravityHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    expect(installed.hooks).toBeUndefined();
    await uninstallAntigravityHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
    expect(cleaned[PIER_HOOK_NAME]).toBeUndefined();
  });

  it("已损坏的 hooks.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await writeFile(path, "{ not json", "utf8");
    await installAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("更高世代 Pier 命名 hook 存在时安装不改写文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    const original = JSON.stringify({
      model: "antigravity-newer",
      [PIER_HOOK_NAME]: {
        Stop: [
          {
            command: `pier-hook-gen=${HIGHER_HOOK_GENERATION}; "\${PIER_AGENT_HOOKS_DIR}/emit" newer`,
            timeout: 5,
            type: "command",
          },
        ],
      },
    });
    await writeFile(path, original, "utf8");

    await installAntigravityHooks(path);

    expect(await readFile(path, "utf8")).toBe(original);
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    const original = '{"model":"antigravity-1"}';
    await writeFile(path, original, "utf8");
    await uninstallAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "hooks.json");
    await installAntigravityHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installAntigravityHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});

describe("antigravityIntegration.detect()", () => {
  it("返回 boolean（目录/PATH 状态由运行环境决定，此处仅冒烟测试）", () => {
    expect(typeof antigravityIntegration.detect()).toBe("boolean");
  });

  it("integration 元信息符合 spec", () => {
    expect(antigravityIntegration.id).toBe("antigravity");
  });

  it("识别官方 agy 命令", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-agy-path-"));
    await writeFile(join(dir, "agy"), "", "utf8");
    const previousPath = process.env.PATH;
    process.env.PATH = dir;
    try {
      expect(antigravityIntegration.detect()).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
