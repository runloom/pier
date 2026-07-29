import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/agent-hooks-install.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent-session.ts";

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
  homeDir = await mkdtemp(join(tmpdir(), "pier-aug-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await loadModule();
  return mod.augIntegration;
}

async function loadModule() {
  return import("../../../src/main/services/agents/integrations/aug.ts");
}

function configPath(): string {
  return join(homeDir, ".augment", "settings.json");
}

function managedScriptPath(): string {
  return join(homeDir, ".augment", "hooks", "pier-agent-status.sh");
}

describe("augIntegration", () => {
  it("id 为 aug", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("aug");
  });

  it("detect(): ~/.augment 目录存在时为 true", async () => {
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 auggie/aug 二进制时即使无 ~/.augment 也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aug-bin-"));
    await writeFile(join(dir, "auggie"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("detect(): PATH 上有 aug 二进制（别名）时也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aug-bin2-"));
    await writeFile(join(dir, "aug"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("Windows 明确不安装：严格 v3 受管 runtime 当前只有 POSIX .sh 实现", async () => {
    const { installAugHooks } = await loadModule();
    await installAugHooks("win32");
    await expect(readFile(configPath(), "utf8")).rejects.toThrow();
    await expect(readFile(managedScriptPath(), "utf8")).rejects.toThrow();
  });

  it("只安装当前官方有状态证据的 5 个事件，command 只引用受管 .sh 文件", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string; timeout?: number }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    for (const evt of ["SessionStart", "Stop", "SessionEnd"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    for (const evt of ["PreToolUse", "PostToolUse"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe(".*");
    }
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.Notification).toBeUndefined();
    expect(hooks.UserPromptSubmit).toBeUndefined();

    expect(hookCommands(installed)).toEqual(
      Array.from({ length: 5 }, () => managedScriptPath())
    );
    const script = await readFile(managedScriptPath(), "utf8");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(MARK);
    expect(script).toContain('"agentEventV3"');
    await expect(
      access(managedScriptPath(), constants.X_OK)
    ).resolves.toBeUndefined();
    // timeout 单位是毫秒（官方 schema），非 droid/claude 家族的秒
    expect(typedHooks.Stop?.[0]?.hooks[0]?.timeout).toBe(5000);
  });

  it("官方载荷：conversation_id 保留会话身份，匿名工具闭环，Stop 按 agent_stop_cause 分流", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const command = (event: string) =>
      hooks[event]?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-aug-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const common = {
      conversation_id: "conv-aug-1",
      workspace_roots: ["/repo"],
    };
    for (const [event, payload] of [
      ["SessionStart", { ...common, hook_event_name: "SessionStart" }],
      [
        "PreToolUse",
        {
          ...common,
          hook_event_name: "PreToolUse",
          is_mcp_tool: false,
          tool_input: { command: "pnpm test" },
          tool_name: "launch-process",
        },
      ],
      [
        "PostToolUse",
        {
          ...common,
          hook_event_name: "PostToolUse",
          is_mcp_tool: false,
          tool_input: { command: "pnpm test" },
          tool_name: "launch-process",
          tool_output: "ok",
        },
      ],
      [
        "Stop",
        {
          ...common,
          agent_stop_cause: "end_turn",
          hook_event_name: "Stop",
        },
      ],
      [
        "Stop",
        {
          ...common,
          agent_stop_cause: "interrupted",
          hook_event_name: "Stop",
        },
      ],
      [
        "Stop",
        {
          ...common,
          agent_stop_cause: "max_iterations",
          hook_event_name: "Stop",
        },
      ],
      [
        "Stop",
        {
          ...common,
          agent_stop_cause: "error",
          hook_event_name: "Stop",
        },
      ],
      ["SessionEnd", { ...common, hook_event_name: "SessionEnd" }],
    ] as const) {
      const result = spawnSync(command(event), [], {
        env: {
          ...process.env,
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
          PATH: ORIGINAL_PATH,
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
      {
        event: "SessionStart",
        nativeEvent: "SessionStart",
        sessionId: "conv-aug-1",
        v: 3,
      },
      {
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        sessionId: "conv-aug-1",
        toolName: "launch-process",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PostToolUse",
        sessionId: "conv-aug-1",
        toolName: "launch-process",
        v: 3,
      },
      {
        event: "Stop",
        nativeEvent: "Stop",
        nativeState: "end_turn",
        v: 3,
      },
      {
        event: "TurnInterrupted",
        nativeEvent: "Stop",
        nativeState: "interrupted",
        v: 3,
      },
      {
        event: "TurnInterrupted",
        nativeEvent: "Stop",
        nativeState: "max_iterations",
        v: 3,
      },
      {
        event: "error",
        nativeEvent: "Stop",
        nativeState: "error",
        v: 3,
      },
      {
        event: "SessionEnd",
        nativeEvent: "SessionEnd",
        sessionId: "conv-aug-1",
        v: 3,
      },
    ]);
    expect(rows[1]).not.toHaveProperty("toolUseId");
    expect(rows[2]).not.toHaveProperty("toolUseId");

    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows.slice(0, 4)) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, integration.runtime);
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual([undefined, "tool", "processing", undefined]);
  }, 30_000);

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
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "aug-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("aug-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
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
    await expect(readFile(managedScriptPath(), "utf8")).rejects.toThrow();
  });

  it("用户命令与 Pier 命令位于同一 matcher 时仍保留用户命令", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "say user-stop" },
                { type: "command", command: managedScriptPath() },
              ],
            },
          ],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toEqual(["say user-stop"]);
  });

  it("升级会清理已移除事件中的旧 inline Pier handler，并保留同 matcher 用户 handler", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              matcher: ".*",
              hooks: [
                { type: "command", command: "user-prompt-hook" },
                {
                  type: "command",
                  command: `pier-hook-gen=9; "\${PIER_AGENT_HOOKS_DIR}/emit" legacy`,
                },
              ],
            },
          ],
        },
      }),
      "utf8"
    );

    const integration = await loadIntegration();
    await integration.install();

    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const promptHooks = (
      installed.hooks as Record<
        string,
        Array<{ hooks: Array<{ command: string }>; matcher?: string }>
      >
    ).UserPromptSubmit;
    expect(promptHooks).toEqual([
      {
        hooks: [{ command: "user-prompt-hook", type: "command" }],
        matcher: ".*",
      },
    ]);
  });

  it("卸载会清理旧 inline Pier handler，并保留同 matcher 用户 handler", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                { type: "command", command: "user-prompt-hook" },
                {
                  type: "command",
                  command: `pier-hook-gen=9; "\${PIER_AGENT_HOOKS_DIR}/emit" legacy`,
                },
              ],
            },
          ],
        },
      }),
      "utf8"
    );

    const integration = await loadIntegration();
    await integration.uninstall();

    expect(
      hookCommands(JSON.parse(await readFile(configPath(), "utf8")))
    ).toEqual(["user-prompt-hook"]);
  });

  it("同路径已有非受管脚本时不覆盖，也不注册为 Pier hook", async () => {
    await mkdir(join(homeDir, ".augment", "hooks"), { recursive: true });
    const custom = "#!/bin/sh\necho user-script\n";
    await writeFile(managedScriptPath(), custom, "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(managedScriptPath(), "utf8")).toBe(custom);
    await expect(readFile(configPath(), "utf8")).rejects.toThrow();
  });

  it("同路径非受管脚本及其用户引用在安装和卸载时均保持不变", async () => {
    await mkdir(join(homeDir, ".augment", "hooks"), { recursive: true });
    const custom = "#!/bin/sh\necho user-script\n";
    const originalConfig = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: managedScriptPath() },
              { type: "command", command: "user-stop-hook" },
            ],
          },
        ],
      },
    });
    await writeFile(managedScriptPath(), custom, "utf8");
    await writeFile(configPath(), originalConfig, "utf8");
    const integration = await loadIntegration();

    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(originalConfig);
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(originalConfig);
    expect(await readFile(managedScriptPath(), "utf8")).toBe(custom);
  });

  it("同路径已有更高世代受管脚本时不改脚本也不改配置", async () => {
    await mkdir(join(homeDir, ".augment", "hooks"), { recursive: true });
    const newerScript = [
      "#!/bin/sh",
      "# pier-agent-status:v11 (managed by Pier)",
      "exit 0",
      "",
    ].join("\n");
    const originalConfig = '{"model":"aug-newer"}';
    await writeFile(managedScriptPath(), newerScript, "utf8");
    await writeFile(configPath(), originalConfig, "utf8");

    const integration = await loadIntegration();
    await integration.install();

    expect(await readFile(managedScriptPath(), "utf8")).toBe(newerScript);
    expect(await readFile(configPath(), "utf8")).toBe(originalConfig);
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("目标键异常时不先清理另一键旧 Pier，配置原字节不变", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    const raw = JSON.stringify({
      hooks: {
        LegacyEvent: [
          {
            hooks: [
              {
                command: `pier-hook-gen=9; "\${PIER_AGENT_HOOKS_DIR}/emit" legacy`,
              },
            ],
          },
        ],
        Stop: { custom: true },
      },
    });
    await writeFile(configPath(), raw, "utf8");
    const integration = await loadIntegration();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await integration.install();
      expect(await readFile(configPath(), "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    const original = '{"model":"aug-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
