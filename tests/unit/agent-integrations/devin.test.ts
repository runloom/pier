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
import { stripJsonComments } from "../../../src/main/services/agents/integrations/devin.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

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
  homeDir = await mkdtemp(join(tmpdir(), "pier-devin-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/devin.ts"
  );
  return mod.devinIntegration;
}

function configPath(): string {
  return join(homeDir, ".config", "devin", "config.json");
}

describe("stripJsonComments", () => {
  it("剥离行注释与块注释", () => {
    const input = [
      "{",
      "  // leading comment",
      '  "a": 1, /* inline block */',
      '  "b": 2 // trailing',
      "}",
    ].join("\n");
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({ a: 1, b: 2 });
  });

  it("不误剥字符串字面量内的 // 与 /* */ 序列", () => {
    const input =
      '{"url": "https://example.com", "note": "a /* not a comment */ b"}';
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({
      url: "https://example.com",
      note: "a /* not a comment */ b",
    });
  });

  it("正确处理字符串内的转义引号，不提前判定字符串结束", () => {
    const input = String.raw`{"note": "a \" // still string", "b": 2}`;
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed).toEqual({ note: 'a " // still string', b: 2 });
  });

  it("多行块注释保持结构完整", () => {
    const input = ["{", "/*", "multi", "line", "*/", '"a": 1', "}"].join("\n");
    const parsed = JSON.parse(stripJsonComments(input));
    expect(parsed).toEqual({ a: 1 });
  });
});

describe("devinIntegration", () => {
  it("id 为 devin", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("devin");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("只安装 7 个可闭环状态事件，全部无 matcher", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "PostCompaction",
      "SessionEnd",
      "PreToolUse",
      "PostToolUse",
    ];
    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    expect(hooks.PermissionRequest).toBeUndefined();
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;
    for (const evt of expectedEvents) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"devin"');
    }

    expect(typedHooks.PostCompaction?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
    expect(typedHooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      '"PromptSubmit"'
    );
  });

  it("官方载荷：session_id 与 prompt_id 分层，匿名工具失败仅闭合工具，权限请求不伪造等待", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const command = (event: string) =>
      hooks[event]?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-devin-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    for (const [event, payload] of [
      [
        "SessionStart",
        {
          hook_event_name: "SessionStart",
          session_id: "devin-session-1",
          source: "startup",
        },
      ],
      [
        "UserPromptSubmit",
        {
          hook_event_name: "UserPromptSubmit",
          prompt: "Fix the parser",
          prompt_id: "prompt-1",
          session_id: "devin-session-1",
        },
      ],
      [
        "PreToolUse",
        {
          hook_event_name: "PreToolUse",
          prompt_id: "prompt-1",
          session_id: "devin-session-1",
          tool_input: { command: "pnpm test" },
          tool_name: "exec",
        },
      ],
      [
        "PostToolUse",
        {
          hook_event_name: "PostToolUse",
          prompt_id: "prompt-1",
          session_id: "devin-session-1",
          tool_input: { command: "pnpm test" },
          tool_name: "exec",
          tool_response: {
            error: "tests failed",
            output: "",
            success: false,
          },
        },
      ],
      [
        "Stop",
        {
          hook_event_name: "Stop",
          prompt_id: "prompt-1",
          session_id: "devin-session-1",
          stop_hook_active: false,
        },
      ],
      [
        "SessionEnd",
        {
          hook_event_name: "SessionEnd",
          prompt_id: "prompt-1",
          reason: "exit",
          session_id: "devin-session-1",
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
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        event: "SessionStart",
        nativeEvent: "SessionStart",
        sessionId: "devin-session-1",
        v: 3,
      },
      {
        event: "PromptSubmit",
        nativeEvent: "UserPromptSubmit",
        sessionId: "devin-session-1",
        turnId: "prompt-1",
        v: 3,
      },
      {
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        sessionId: "devin-session-1",
        toolName: "exec",
        turnId: "prompt-1",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PostToolUse",
        sessionId: "devin-session-1",
        toolName: "exec",
        turnId: "prompt-1",
        v: 3,
      },
      {
        event: "Stop",
        nativeEvent: "Stop",
        sessionId: "devin-session-1",
        turnId: "prompt-1",
        v: 3,
      },
      {
        event: "SessionEnd",
        nativeEvent: "SessionEnd",
        sessionId: "devin-session-1",
        turnId: "prompt-1",
        v: 3,
      },
    ]);
    expect(rows[2]).not.toHaveProperty("toolUseId");
    expect(rows[3]).not.toHaveProperty("toolUseId");
    expect(
      integration.runtime.emittedMappings.some(
        ({ nativeEvent }) => nativeEvent === "PermissionRequest"
      )
    ).toBe(false);

    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows.slice(0, 5)) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, integration.runtime);
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual([
      undefined,
      "processing",
      "tool",
      "processing",
      undefined,
    ]);
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
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "devin-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("devin-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("安装先清理所有旧 Pier 事件，并保留同 matcher 的用户 handler", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          PermissionRequest: [
            {
              matcher: "legacy",
              hooks: [
                { type: "command", command: "user-permission" },
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
    const hooks = installed.hooks as Record<
      string,
      Array<{
        hooks: Array<{ command: string }>;
        matcher?: string;
      }>
    >;
    expect(hooks.PermissionRequest).toEqual([
      {
        hooks: [{ command: "user-permission", type: "command" }],
        matcher: "legacy",
      },
    ]);
    expect(
      hookCommands(installed).filter((command) => command.includes(MARK))
    ).toHaveLength(7);
  });

  it("更高世代 Pier hook 存在时安装不改写 JSONC", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    const original = [
      "{",
      "  // installed by a newer Pier",
      '  "hooks": {',
      `    "Stop": [{ "hooks": [{ "type": "command", "command": "pier-hook-gen=11; \${PIER_AGENT_HOOKS_DIR}/emit" }] }],`,
      "  },",
      "}",
      "",
    ].join("\n");
    await writeFile(configPath(), original, "utf8");

    const integration = await loadIntegration();
    await integration.install();

    expect(await readFile(configPath(), "utf8")).toBe(original);
  });

  it("安装与卸载均保留 JSONC 注释和未知字段的原始格式", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    const original = [
      "{",
      "  // keep this account note",
      '  "model": "devin-1",',
      '  "unknown": { "enabled": true },',
      '  "hooks": {',
      "    // keep this user hook note",
      '    "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }],',
      "  },",
      "}",
      "",
    ].join("\n");
    await writeFile(configPath(), original, "utf8");

    const integration = await loadIntegration();
    await integration.install();
    const installed = await readFile(configPath(), "utf8");
    expect(installed).toContain("pier-hook-gen=10");
    expect(installed).toContain("// keep this account note");
    expect(installed).toContain("// keep this user hook note");
    expect(installed).toContain('"unknown": { "enabled": true }');

    await integration.uninstall();
    const uninstalled = await readFile(configPath(), "utf8");
    expect(uninstalled).toContain("// keep this account note");
    expect(uninstalled).toContain("// keep this user hook note");
    expect(uninstalled).toContain('"unknown": { "enabled": true }');
    expect(uninstalled).toContain('"command": "say done"');
    expect(uninstalled).not.toContain("pier-hook-gen=");
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
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

  it("带注释的合法 JSONC 能正常安装且保留注释", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(
      configPath(),
      ["{", "  // user config", '  "model": "devin-1" /* pinned */', "}"].join(
        "\n"
      ),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const raw = await readFile(configPath(), "utf8");
    const installed = JSON.parse(stripJsonComments(raw));
    expect(raw).toContain("// user config");
    expect(raw).toContain("/* pinned */");
    expect(installed.model).toBe("devin-1");
    expect(hookCommands(installed).length).toBeGreaterThan(0);
  });

  it("真正损坏（非法 JSON，剥注释后仍不可解析）的配置不被覆盖", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    await writeFile(configPath(), "{ not json // comment", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json // comment");
  });

  it("目标键异常时不先清理另一键旧 Pier，JSONC 原字节不变", async () => {
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
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
    await mkdir(join(homeDir, ".config", "devin"), { recursive: true });
    const original = '{"model":"devin-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
