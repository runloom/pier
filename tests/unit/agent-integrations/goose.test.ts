import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/agent-hooks-install.ts";
import {
  buildGoosePluginManifest,
  GOOSE_PLUGIN_MARKER_TEXT,
  gooseDetect,
  gooseIntegration,
  goosePluginDir,
  gooseSettingsPath,
  isPierPluginDisabled,
  legacyGooseConfigPath,
  uninstallGooseHooks,
  withoutPierGooseHooks,
  withPierGooseHooks,
} from "../../../src/main/services/agents/integrations/goose.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent-session.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const NATIVE_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
];

describe("buildGoosePluginManifest", () => {
  it("生成 plugin.json 含 name/version/description + 托管 marker", () => {
    const manifest = JSON.parse(buildGoosePluginManifest());
    expect(manifest.name).toBe("pier");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.description).toContain(GOOSE_PLUGIN_MARKER_TEXT);
  });
});

describe("withPierGooseHooks / withoutPierGooseHooks", () => {
  it("为每个 goose HookEvent 事件写入 pier 条目（嵌套 Claude 式 schema）", () => {
    const next = withPierGooseHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of NATIVE_EVENTS) {
      expect(hooks[evt]).toBeDefined();
      expect(hooks[evt]).toHaveLength(1);
    }
  });

  it("command 含正确 agent id + pierEvent + PIER_AGENT_HOOKS_DIR mark", () => {
    const next = withPierGooseHooks({});
    const hooks = next.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const preToolCommand = hooks.PreToolUse?.[0]?.hooks[0]?.command ?? "";
    expect(preToolCommand).toContain('"goose"');
    expect(preToolCommand).toContain(MARK);
    expect(preToolCommand).toContain('"ToolStart"');
    const stopCommand = hooks.Stop?.[0]?.hooks[0]?.command ?? "";
    expect(stopCommand).toContain('"Stop"');
    for (const event of NATIVE_EVENTS) {
      expect(hooks[event]?.[0]?.hooks[0]?.command).toContain('"agentEventV3"');
    }
  });

  it("真实 HookContext 无工具 ID，失败只作匿名 ToolComplete，Stop 保持 advisory", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-goose-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = withPierGooseHooks({}).hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    for (const [event, payload] of [
      ["SessionStart", { event: "SessionStart", session_id: "session-g" }],
      [
        "UserPromptSubmit",
        {
          event: "UserPromptSubmit",
          message: "Fix it",
          session_id: "session-g",
        },
      ],
      [
        "PreToolUse",
        {
          event: "PreToolUse",
          session_id: "session-g",
          tool_input: { command: "false" },
          tool_name: "developer",
        },
      ],
      [
        "PostToolUseFailure",
        {
          event: "PostToolUseFailure",
          session_id: "session-g",
          tool_name: "developer",
          tool_output: "exit 1",
        },
      ],
      ["Stop", { event: "Stop", session_id: "session-g" }],
    ] as const) {
      const result = spawnSync(
        "/bin/sh",
        ["-c", hooks[event]?.[0]?.hooks[0]?.command ?? ""],
        {
          env: {
            ...process.env,
            PIER_AGENT_EVENT_LOG: logPath,
            PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
            PIER_PANEL_ID: "panel-1",
            PIER_WINDOW_ID: "window-1",
          },
          input: JSON.stringify(payload),
        }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[2]).toMatchObject({
      event: "ToolStart",
      toolName: "developer",
      v: 3,
    });
    expect(rows[2]).not.toHaveProperty("toolUseId");
    expect(rows[3]).toMatchObject({
      event: "ToolComplete",
      nativeEvent: "PostToolUseFailure",
      v: 3,
    });
    expect(rows[3]).not.toHaveProperty("toolUseId");
    expect(
      rows.some((row) => row.kind === "agentEvent" && row.event === "error")
    ).toBe(false);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, { stopAuthority: "advisory" });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status)
        statuses.push(activity.status);
    }
    expect(statuses).toEqual(["processing", "tool", "processing"]);
  }, 15_000);

  it("幂等：重复安装事件条目不重复", () => {
    const once = withPierGooseHooks({});
    const twice = withPierGooseHooks(once);
    const hooks = twice.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(1);
  });

  it("保留用户已有的其他条目", () => {
    const user = {
      hooks: {
        PreToolUse: [{ hooks: [{ command: "echo hi", type: "command" }] }],
      },
    };
    const next = withPierGooseHooks(user);
    const hooks = next.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse).toHaveLength(2);
  });

  it("卸载后剔除全部 pier 事件条目（沿用 withoutPierNestedHooks 既有语义：空 hooks 键保留为 {}）", () => {
    const original = { provider: "anthropic" };
    const installed = withPierGooseHooks(original);
    const removed = withoutPierGooseHooks(installed);
    expect(removed.provider).toBe("anthropic");
    expect(removed.hooks).toEqual({});
  });

  it("无 pier 条目时原样返回输入引用", () => {
    const config = { provider: "anthropic" };
    expect(withoutPierGooseHooks(config)).toBe(config);
  });
});

describe("goosePluginDir / gooseSettingsPath", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("插件目录固定在 ~/.agents/plugins/pier", () => {
    const HOME = "/tmp/pier-goose-home";
    process.env.HOME = HOME;
    expect(goosePluginDir()).toBe(join(HOME, ".agents", "plugins", "pier"));
  });

  it("settings 路径为 ~/.config/goose/settings.json", () => {
    const HOME = "/tmp/pier-goose-home2";
    process.env.HOME = HOME;
    expect(gooseSettingsPath()).toBe(
      join(HOME, ".config", "goose", "settings.json")
    );
  });
});

describe("isPierPluginDisabled", () => {
  it("settings.json 不存在时视为未禁用", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-settings-"));
    expect(await isPierPluginDisabled(join(dir, "settings.json"))).toBe(false);
  });

  it("disabledPlugins 含 pier 时返回 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(
      path,
      JSON.stringify({ disabledPlugins: ["pier"] }),
      "utf8"
    );
    expect(await isPierPluginDisabled(path)).toBe(true);
  });

  it("disabledPlugins 不含 pier 时返回 false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(
      path,
      JSON.stringify({ disabledPlugins: ["other"] }),
      "utf8"
    );
    expect(await isPierPluginDisabled(path)).toBe(false);
  });
});

describe("gooseDetect", () => {
  it("detect 仅依赖 PATH 上的 goose 命令", () => {
    expect(typeof gooseDetect()).toBe("boolean");
  });
});

describe("install/uninstallGooseHooks (文件 IO)", () => {
  afterEach(() => {
    vi.doUnmock("../../../src/main/services/agents/integrations/shared.ts");
    vi.resetModules();
  });

  async function withDetectTrue() {
    vi.resetModules();
    vi.doMock(
      "../../../src/main/services/agents/integrations/shared.ts",
      async () => {
        const actual = await vi.importActual<
          typeof import("../../../src/main/services/agents/integrations/shared.ts")
        >("../../../src/main/services/agents/integrations/shared.ts");
        return { ...actual, commandExistsOnPath: () => true };
      }
    );
    return await import(
      "../../../src/main/services/agents/integrations/goose.ts"
    );
  }

  it("detect 为真时部署 plugin.json + hooks/hooks.json", async () => {
    const mod = await withDetectTrue();
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    await mod.installGooseHooks(pluginDir, settingsPath);
    const manifest = JSON.parse(
      await readFile(join(pluginDir, "plugin.json"), "utf8")
    );
    expect(manifest.name).toBe("pier");
    const hooksJson = JSON.parse(
      await readFile(join(pluginDir, "hooks", "hooks.json"), "utf8")
    );
    expect(hooksJson.hooks.SessionStart).toHaveLength(1);
    expect(hooksJson.hooks.PostToolUseFailure).toHaveLength(1);
  });

  it("卸载：删除托管插件目录", async () => {
    const mod = await withDetectTrue();
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    await mod.installGooseHooks(pluginDir, settingsPath);
    await mod.uninstallGooseHooks(pluginDir);
    await expect(
      readFile(join(pluginDir, "plugin.json"), "utf8")
    ).rejects.toThrow();
  });

  it("detect 为假时（goose 不在 PATH）install 不写入任何文件", async () => {
    vi.resetModules();
    vi.doMock(
      "../../../src/main/services/agents/integrations/shared.ts",
      async () => {
        const actual = await vi.importActual<
          typeof import("../../../src/main/services/agents/integrations/shared.ts")
        >("../../../src/main/services/agents/integrations/shared.ts");
        return { ...actual, commandExistsOnPath: () => false };
      }
    );
    const mod = await import(
      "../../../src/main/services/agents/integrations/goose.ts"
    );
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-nodetect-"));
    const pluginDir = join(dir, "plugins", "pier");
    await mod.installGooseHooks(pluginDir, join(dir, "settings.json"));
    await expect(
      readFile(join(pluginDir, "plugin.json"), "utf8")
    ).rejects.toThrow();
  });

  it("幂等：重复安装第二次不改变插件文件内容", async () => {
    const mod = await withDetectTrue();
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    await mod.installGooseHooks(pluginDir, settingsPath);
    const firstManifest = await readFile(
      join(pluginDir, "plugin.json"),
      "utf8"
    );
    const firstHooks = await readFile(
      join(pluginDir, "hooks", "hooks.json"),
      "utf8"
    );
    await mod.installGooseHooks(pluginDir, settingsPath);
    expect(await readFile(join(pluginDir, "plugin.json"), "utf8")).toBe(
      firstManifest
    );
    expect(await readFile(join(pluginDir, "hooks", "hooks.json"), "utf8")).toBe(
      firstHooks
    );
  });

  it("disabledPlugins 含 pier 时 install 跳过, 不部署插件文件", async () => {
    const mod = await withDetectTrue();
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify({ disabledPlugins: ["pier"] }),
      "utf8"
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await mod.installGooseHooks(pluginDir, settingsPath);
    await expect(
      readFile(join(pluginDir, "plugin.json"), "utf8")
    ).rejects.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("非托管同名 plugin.json 不覆盖, 不写 hooks, 发出告警", async () => {
    const mod = await withDetectTrue();
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    await mkdir(pluginDir, { recursive: true });
    const unmanaged = JSON.stringify({ name: "pier", version: "9.9.9" });
    await writeFile(join(pluginDir, "plugin.json"), unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await mod.installGooseHooks(pluginDir, settingsPath);
    expect(await readFile(join(pluginDir, "plugin.json"), "utf8")).toBe(
      unmanaged
    );
    await expect(
      readFile(join(pluginDir, "hooks", "hooks.json"), "utf8")
    ).rejects.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("磁盘更高世代 manifest 时不降级 hooks.json", async () => {
    const mod = await withDetectTrue();
    const { pierManagedPluginMarker, PIER_MANAGED_PLUGIN_GENERATION } =
      await import(
        "../../../src/main/services/agents/integrations/managed-plugin-file.ts"
      );
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    const settingsPath = join(dir, "settings.json");
    const hooksDir = join(pluginDir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    const high = PIER_MANAGED_PLUGIN_GENERATION + 2;
    const highManifest = `${JSON.stringify(
      {
        description: `Pier hooks (${pierManagedPluginMarker(high)})`,
        name: "pier",
        version: "9.9.9",
      },
      null,
      2
    )}\n`;
    await writeFile(join(pluginDir, "plugin.json"), highManifest, "utf8");
    const highHooks = `${JSON.stringify(
      {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `_pier_hook_gen=pier-hook-gen=${high}; echo high-gen; [ -x "\${PIER_AGENT_HOOKS_DIR}/emit" ] && true || true`,
                },
              ],
            },
          ],
        },
      },
      null,
      2
    )}\n`;
    await writeFile(join(hooksDir, "hooks.json"), highHooks, "utf8");
    await mod.installGooseHooks(pluginDir, settingsPath);
    expect(await readFile(join(pluginDir, "plugin.json"), "utf8")).toBe(
      highManifest
    );
    expect(await readFile(join(hooksDir, "hooks.json"), "utf8")).toBe(
      highHooks
    );
  });

  it("卸载非托管插件目录不删除, 发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    await mkdir(pluginDir, { recursive: true });
    const unmanaged = JSON.stringify({ name: "pier", version: "9.9.9" });
    await writeFile(join(pluginDir, "plugin.json"), unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await uninstallGooseHooks(pluginDir);
    expect(await readFile(join(pluginDir, "plugin.json"), "utf8")).toBe(
      unmanaged
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载不存在的插件目录是零副作用 no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-io-test-"));
    const pluginDir = join(dir, "plugins", "pier");
    await expect(uninstallGooseHooks(pluginDir)).resolves.toBeUndefined();
  });
});

describe("旧 config.yaml 遗留清理", () => {
  it("cleanupLegacyGooseConfig 移除旧实现写入的顶层 hooks: pier marker 块", async () => {
    const { cleanupLegacyGooseConfig } = await import(
      "../../../src/main/services/agents/integrations/goose.ts"
    );
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-legacy-"));
    const legacyPath = join(dir, "config.yaml");
    const legacy =
      "# >>> pier-agent-status:goose (managed by Pier; do not edit) >>>\nhooks:\n  pre_tool_use: 'x'\n# <<< pier-agent-status:goose <<<\nprovider: anthropic\n";
    await writeFile(legacyPath, legacy, "utf8");
    await cleanupLegacyGooseConfig(legacyPath);
    const cleaned = await readFile(legacyPath, "utf8");
    expect(cleaned).toBe("provider: anthropic\n");
  });

  it("无遗留块时零写入", async () => {
    const { cleanupLegacyGooseConfig } = await import(
      "../../../src/main/services/agents/integrations/goose.ts"
    );
    const dir = await mkdtemp(join(tmpdir(), "pier-goose-legacy-"));
    const legacyPath = join(dir, "config.yaml");
    await writeFile(legacyPath, "provider: anthropic\n", "utf8");
    await cleanupLegacyGooseConfig(legacyPath);
    expect(await readFile(legacyPath, "utf8")).toBe("provider: anthropic\n");
  });

  it("install 也会触发遗留清理（通过 installGooseHooks 端到端验证真实路径不受影响, 此处仅验证函数导出可用）", async () => {
    const { cleanupLegacyGooseConfig } = await import(
      "../../../src/main/services/agents/integrations/goose.ts"
    );
    expect(typeof cleanupLegacyGooseConfig).toBe("function");
  });
});

describe("gooseIntegration 契约", () => {
  it("id 为 goose", () => {
    expect(gooseIntegration.id).toBe("goose");
  });
});

describe("legacyGooseConfigPath", () => {
  it("路径为 ~/.config/goose/config.yaml", () => {
    expect(legacyGooseConfigPath()).toContain(
      join(".config", "goose", "config.yaml")
    );
  });
});
