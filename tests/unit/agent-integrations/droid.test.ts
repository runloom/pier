import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIER_HOOK_COMMAND_GENERATION } from "../../../src/main/services/agents/hooks-install.ts";
import { droidIntegration } from "../../../src/main/services/agents/integrations/droid.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const HIGHER_HOOK_GENERATION = PIER_HOOK_COMMAND_GENERATION + 1;

function hookCommands(settings: Record<string, unknown>): string[] {
  // flat（hooks.json 顶层事件键）与 wrapped（settings.json `hooks` 记录）
  // 两形态的 command 一并收集；空 `hooks` 键是对象不是数组，天然跳过。
  const entryGroups: unknown[] = [
    ...Object.values((settings.hooks ?? {}) as Record<string, unknown>),
    ...Object.entries(settings)
      .filter(([key]) => key !== "hooks")
      .map(([, value]) => value),
  ];
  return entryGroups
    .filter(
      (entries): entries is Array<{ hooks: Array<{ command: string }> }> =>
        Array.isArray(entries)
    )
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-droid-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/droid.ts"
  );
  return mod.droidIntegration;
}

function configPath(): string {
  return join(homeDir, ".factory", "hooks.json");
}

function settingsPath(): string {
  return join(homeDir, ".factory", "settings.json");
}

describe("droidIntegration", () => {
  it("id 为 droid", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("droid");
  });

  it("detect(): 官方 hooks.json 存在时为 true", async () => {
    // PATH 置空，隔离本机真实安装的 droid 二进制（commandExistsOnPath 兜底
    // 分支），确保这里只验证「配置文件存在」这一条件。
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 droid 二进制时即使无配置也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-droid-bin-"));
    await writeFile(join(dir, "droid"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("只安装可形成完整状态事实的官方事件（flat 顶层事件键）", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    // 官方规范：独立 hooks.json 事件键直接在顶层；`hooks` 包裹仅用于
    // settings.json。droid 0.213.0 实测 wrapped 独立文件整份被忽略。
    const hooks = installed as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    // 无 matcher 事件
    for (const evt of [
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "Stop",
      "PreCompact",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    // 工具事件使用全匹配正则。
    for (const evt of ["PreToolUse", "PostToolUse"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe(".*");
    }
    // 取消不发 Stop 只发 Notification（官方文档）；按 notification_type
    // 在命令内分发：idle_prompt（binary 唯一发射点=用户取消）→
    // TurnInterrupted，其余请求型通知落 processing。matcher 对
    // Notification 不过滤（droid 不传匹配值），条目不带 matcher。
    expect(hooks.Notification, "Notification").toHaveLength(1);
    expect(typedHooks.Notification?.[0]?.matcher).toBeUndefined();
    const notificationCommand =
      typedHooks.Notification?.[0]?.hooks[0]?.command ?? "";
    expect(notificationCommand).toContain("notification_type");
    expect(notificationCommand).toContain(
      'idle_prompt) _pier_event="TurnInterrupted"'
    );
    expect(notificationCommand).toContain('*) _pier_event="processing"');
    expect(hooks.StopFailure).toBeUndefined();
    // 官方只有 SubagentStop，没有可建立身份与开始边界的 SubagentStart；
    // 单边停止事件不能形成完整子智能体状态事实，因此不安装。
    expect(hooks.SubagentStop).toBeUndefined();
    // Droid hook 只有请求通知，没有可配对 ID 与结果事件。
    expect(hooks.PermissionRequest).toBeUndefined();
    // 子会话锚点：SessionStart 提取 calling_session_id 作 parentSessionId。
    expect(typedHooks.SessionStart?.[0]?.hooks[0]?.command).toContain(
      "calling_session_id"
    );

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"droid"');
      expect(cmd).toContain('"agentEventV3"');
    }
    // pierEvent 名称核验：官方 Stop 只在主 agent 完成回复（回合终态）时
    // 发射，取消不发 Stop 只发 Notification → 可信终态直接映射
    // TurnCompleted（copilot agentStop 同款），不经 advisory pier Stop。
    expect(typedHooks.Stop?.[0]?.hooks[0]?.command).toContain(
      '"TurnCompleted"'
    );
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolStart"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      '"PromptSubmit"'
    );
    expect(typedHooks.SessionStart?.[0]?.hooks[0]?.command).toContain(
      '"SessionStart"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
    );
    expect(typedHooks.PreCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
  });

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
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "droid-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("droid-1");
    // 用户 wrapped 条目原样保留；Pier 条目改写 flat 顶层（官方规范）。
    const wrappedStop = (
      installed.hooks as Record<
        string,
        Array<{ hooks: Array<{ command: string }> }>
      >
    ).Stop;
    expect(wrappedStop).toHaveLength(1);
    expect(wrappedStop?.[0]?.hooks[0]?.command).toBe("say done");
    const flatStop = installed.Stop as unknown[];
    expect(flatStop).toHaveLength(1);
  });

  it("迁移：旧 wrapped Pier 条目清理进 flat 顶层，用户 wrapped 条目保留", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    // 旧安装器把 wrapped 结构误写进独立 hooks.json——droid 整份忽略。
    // 第三方（如 orca）的 wrapped 用户条目同样死于该形态，但只清理 Pier
    // 自己的条目，用户条目原样保留。
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "orca-user-stop" }] },
            {
              hooks: [
                {
                  type: "command",
                  command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy`,
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
    const wrappedStop = installed.hooks.Stop;
    expect(wrappedStop).toHaveLength(1);
    expect(wrappedStop[0].hooks[0].command).toBe("orca-user-stop");
    expect(installed.Stop).toHaveLength(1);
    expect(installed.Stop[0].hooks[0].command).toContain(MARK);
    // 卸载：flat Pier 条目移除，wrapped 用户条目保留。
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(cleaned.Stop).toBeUndefined();
    expect(cleaned.hooks.Stop).toHaveLength(1);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
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

  it("用户命令与 Pier 命令位于同一 matcher 时仍保留用户命令", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "say user-stop" },
                {
                  type: "command",
                  command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy`,
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
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toEqual(["say user-stop"]);
  });

  it("已损坏的 hooks.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    const original = '{"model":"droid-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});

describe("droid 从 settings.json fallback 迁移到官方 hooks.json", () => {
  it("canonical 目标键异常时两处配置都原字节不变，不清 fallback 旧 Pier", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    const canonical = JSON.stringify({
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
    const fallback = JSON.stringify({
      hooks: {
        LegacyEvent: [
          {
            hooks: [
              {
                command: `pier-hook-gen=9; "\${PIER_AGENT_HOOKS_DIR}/emit" fallback`,
              },
            ],
          },
        ],
      },
    });
    await writeFile(configPath(), canonical, "utf8");
    await writeFile(settingsPath(), fallback, "utf8");
    const integration = await loadIntegration();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await integration.install();
      expect(await readFile(configPath(), "utf8")).toBe(canonical);
      expect(await readFile(settingsPath(), "utf8")).toBe(fallback);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("fallback 合并不覆盖 canonical 同名非数组用户值", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    // canonical 已有 flat 顶层同名非数组用户值 + wrapped 旧 Pier 条目
    //（触发 fallback 迁移合并）。
    await writeFile(
      configPath(),
      JSON.stringify({
        Custom: { user: true },
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy`,
                },
              ],
            },
          ],
        },
      }),
      "utf8"
    );
    await writeFile(
      settingsPath(),
      JSON.stringify({
        hooks: { Custom: [{ hooks: [{ command: "fallback-user" }] }] },
      }),
      "utf8"
    );
    const integration = await loadIntegration();

    await integration.install();

    const canonical = JSON.parse(await readFile(configPath(), "utf8"));
    // canonical 同名非数组用户值所有权优先，不被 fallback 覆盖。
    expect(canonical.Custom).toEqual({ user: true });
    // wrapped 旧 Pier 条目仍被迁移清理进 flat 顶层。
    const flatStop = canonical.Stop as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(flatStop).toHaveLength(1);
    expect(flatStop[0]?.hooks[0]?.command).toContain(MARK);
  });

  it("hooks.json 不存在时把 settings 用户 hooks 合并进新文件 flat 顶层，避免 fallback 被遮蔽", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(
      settingsPath(),
      JSON.stringify({
        model: "droid-1",
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "settings-user-stop" }] },
          ],
          // Pier 不安装的事件也迁移——flat 顶层键 droid 都会读取。
          SubagentStop: [
            {
              hooks: [{ type: "command", command: "settings-user-subagent" }],
            },
          ],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const canonical = JSON.parse(await readFile(configPath(), "utf8"));
    const settings = JSON.parse(await readFile(settingsPath(), "utf8"));
    // 合并目标是 flat 顶层事件键（droid 唯一读取形态），不是死掉的 wrapped
    // 记录——新文件一旦存在 settings fallback 即被遮蔽，只有落对位置用户
    // hook 才继续生效。
    const flatStop = canonical.Stop as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(
      flatStop.some((entry) => entry.hooks[0]?.command === "settings-user-stop")
    ).toBe(true);
    expect(
      flatStop.some((entry) => entry.hooks[0]?.command.includes(MARK))
    ).toBe(true);
    const flatSubagent = canonical.SubagentStop as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(flatSubagent).toHaveLength(1);
    expect(flatSubagent[0]?.hooks[0]?.command).toBe("settings-user-subagent");
    // 不得把用户 hooks 写进 wrapped 记录（droid 忽略该形态）。
    expect(canonical.hooks).toBeUndefined();
    expect(hookCommands(settings)).toEqual(
      expect.arrayContaining(["settings-user-stop", "settings-user-subagent"])
    );
    // 卸载：flat Pier 条目移除，迁移进来的用户条目继续保留（不再被遮蔽）。
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    const cleanedStop = cleaned.Stop as Array<{
      hooks: Array<{ command: string }>;
    }>;
    expect(cleanedStop).toHaveLength(1);
    expect(cleanedStop[0]?.hooks[0]?.command).toBe("settings-user-stop");
    expect(cleaned.SubagentStop).toHaveLength(1);
  });

  it("hooks.json 不存在且 settings.json 损坏时不创建会遮蔽 fallback 的新文件", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(settingsPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    await expect(readFile(configPath(), "utf8")).rejects.toThrow();
    expect(await readFile(settingsPath(), "utf8")).toBe("{ not json");
  });

  it("fallback 含更高世代 Pier hook 时不创建 hooks.json，也不清理 fallback", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    const original = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "settings-user-stop" },
              {
                type: "command",
                command: `pier-hook-gen=${HIGHER_HOOK_GENERATION}; "\${PIER_AGENT_HOOKS_DIR}/emit" newer`,
              },
            ],
          },
        ],
      },
    });
    await writeFile(settingsPath(), original, "utf8");

    const integration = await loadIntegration();
    await integration.install();

    await expect(readFile(configPath(), "utf8")).rejects.toThrow();
    expect(await readFile(settingsPath(), "utf8")).toBe(original);
  });

  it("hooks.json 含更高世代 Pier hook 时不改两处配置", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    const canonical = JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `pier-hook-gen=${HIGHER_HOOK_GENERATION}; "\${PIER_AGENT_HOOKS_DIR}/emit" newer`,
              },
            ],
          },
        ],
      },
    });
    const fallback = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "settings-user-stop" }] }],
      },
    });
    await writeFile(configPath(), canonical, "utf8");
    await writeFile(settingsPath(), fallback, "utf8");

    const integration = await loadIntegration();
    await integration.install();

    expect(await readFile(configPath(), "utf8")).toBe(canonical);
    expect(await readFile(settingsPath(), "utf8")).toBe(fallback);
  });

  it("install 把 Pier 写入 hooks.json，并只清理 settings.json 中的旧 Pier 条目", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-droid-legacy-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const factoryDir = join(home, ".factory");
      await mkdir(factoryDir, { recursive: true });
      const legacySettings = {
        model: "droid-1",
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "say done" }] },
            {
              hooks: [
                {
                  type: "command",
                  command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy`,
                },
              ],
            },
          ],
        },
      };
      await writeFile(
        join(factoryDir, "settings.json"),
        JSON.stringify(legacySettings),
        "utf8"
      );
      await writeFile(
        join(factoryDir, "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionEnd: [
              { hooks: [{ type: "command", command: "user-cleanup" }] },
            ],
          },
        }),
        "utf8"
      );
      await droidIntegration.install();
      const canonical = JSON.parse(
        await readFile(join(factoryDir, "hooks.json"), "utf8")
      );
      expect(JSON.stringify(canonical)).toContain(MARK);
      expect(JSON.stringify(canonical)).toContain("user-cleanup");
      const cleanedSettings = JSON.parse(
        await readFile(join(factoryDir, "settings.json"), "utf8")
      );
      expect(cleanedSettings.model).toBe("droid-1");
      expect(JSON.stringify(cleanedSettings)).toContain("say done");
      expect(JSON.stringify(cleanedSettings)).not.toContain(MARK);
    } finally {
      process.env.HOME = prevHome;
    }
  });

  it("uninstall 同时清理两处 Pier 条目，不删除任一处用户 hook", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(
      settingsPath(),
      JSON.stringify({
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "settings-user-hook" }] },
            {
              hooks: [
                {
                  type: "command",
                  command: `pier-hook-gen=1; "\${${MARK}}/emit" legacy`,
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
    await integration.uninstall();
    const canonical = JSON.parse(await readFile(configPath(), "utf8"));
    const settings = JSON.parse(await readFile(settingsPath(), "utf8"));
    expect(JSON.stringify(canonical)).not.toContain(MARK);
    expect(JSON.stringify(settings)).not.toContain(MARK);
    expect(JSON.stringify(settings)).toContain("settings-user-hook");
  });
});
