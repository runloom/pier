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
  CLAUDE_IDLE_PROMPT_THRESHOLD_MS,
  installClaudeHooks,
  uninstallClaudeHooks,
  withoutPierClaudeHooks,
  withPierClaudeHooks,
} from "../../../src/main/services/agents/integrations/claude.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";

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

function hookCommand(
  settings: Record<string, unknown>,
  nativeEvent: string
): string {
  const hooks = settings.hooks as Record<
    string,
    Array<{ hooks: Array<{ command: string }> }>
  >;
  return hooks[nativeEvent]?.[0]?.hooks?.[0]?.command ?? "";
}

describe("withPierClaudeHooks", () => {
  it("只为有可信状态语义的 Claude hook 事件注入命令", () => {
    const next = withPierClaudeHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "PostCompact",
      "Stop",
      "StopFailure",
      "Notification",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    // idle_prompt 是唯一装入的 Notification matcher（自报空闲 → ready）。
    const notification = hooks.Notification?.[0] as
      | { matcher?: string }
      | undefined;
    expect(notification?.matcher).toBe("idle_prompt");
    expect(hookCommand(next, "Notification")).toContain("TurnCompleted");
    expect(hookCommand(next, "Notification")).toContain(
      "Notification.idle_prompt"
    );
    // 最佳实践：不写全局 idle 阈值（取消主路径 = host Esc）。
    expect(next.messageIdleNotifThresholdMs).toBeUndefined();
    // 这些事件都没有覆盖所有结果的稳定请求→结果闭环。
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.Elicitation).toBeUndefined();
    expect(hooks.ElicitationResult).toBeUndefined();
    // PermissionDenied 是自动权限模式分类器，不是人工拒绝结果。
    expect(hooks.PermissionDenied).toBeUndefined();
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("保留用户显式配置的 messageIdleNotifThresholdMs", () => {
    const next = withPierClaudeHooks({
      messageIdleNotifThresholdMs: 12_000,
    });
    expect(next.messageIdleNotifThresholdMs).toBe(12_000);
  });

  it("清除历史 Pier idle 阈值，不压低 Claude 默认 60s", () => {
    expect(
      withPierClaudeHooks({ messageIdleNotifThresholdMs: 60_000 })
        .messageIdleNotifThresholdMs
    ).toBe(60_000);
    expect(
      withPierClaudeHooks({ messageIdleNotifThresholdMs: 2500 })
        .messageIdleNotifThresholdMs
    ).toBeUndefined();
    expect(
      withPierClaudeHooks({
        messageIdleNotifThresholdMs: CLAUDE_IDLE_PROMPT_THRESHOLD_MS,
      }).messageIdleNotifThresholdMs
    ).toBeUndefined();
  });

  it("Grok 兼容加载 Pier Claude hooks 时静默跳过，原生 Claude 仍发事件", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-claude-origin-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const settings = withPierClaudeHooks({});
    const baseEnv = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };

    for (const command of hookCommands(settings)) {
      const result = spawnSync("/bin/sh", ["-c", command], {
        env: {
          ...baseEnv,
          GROK_HOOK_EVENT: '{"hookEventName":"compatibility_probe"}',
        },
        input: "{}",
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    expect(await readFile(logPath, "utf8").catch(() => "")).toBe("");

    const nativeEnv: NodeJS.ProcessEnv = {
      ...baseEnv,
      GROK_HOOK_EVENT: undefined,
    };
    const nativeResult = spawnSync(
      "/bin/sh",
      ["-c", hookCommand(settings, "SessionStart")],
      {
        env: nativeEnv,
        input: JSON.stringify({
          hook_event_name: "SessionStart",
          session_id: "claude-native-session",
        }),
      }
    );
    expect(nativeResult.status, nativeResult.stderr.toString()).toBe(0);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        agent: "claude",
        event: "SessionStart",
        sessionId: "claude-native-session",
        v: 3,
      },
    ]);
  }, 15_000);

  it("真实 PreToolUse 只开始工具，不伪造 waiting 解除", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-claude-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const settings = withPierClaudeHooks({});
    const env = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const run = (nativeEvent: string, payload: Record<string, unknown>) => {
      const result = spawnSync(
        "/bin/sh",
        ["-c", hookCommand(settings, nativeEvent)],
        {
          env,
          input: JSON.stringify(payload),
        }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
    };

    run("PreToolUse", {
      hook_event_name: "PreToolUse",
      prompt_id: "prompt-1",
      session_id: "session-1",
      tool_name: "Bash",
      tool_use_id: "tool-1",
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
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        toolName: "Bash",
        toolUseId: "tool-1",
        turnId: "prompt-1",
        v: 3,
      },
    ]);
  }, 15_000);

  it("不安装缺少完整结果闭环的权限与提问 waiting", () => {
    const hooks = withPierClaudeHooks({}).hooks as Record<string, unknown>;
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.Elicitation).toBeUndefined();
    expect(hooks.ElicitationResult).toBeUndefined();
  });

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierClaudeHooks({});
    const twice = withPierClaudeHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      model: "opus",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const next = withPierClaudeHooks(user);
    expect(next.model).toBe("opus");
    const stop = (next.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });
});

describe("withoutPierClaudeHooks", () => {
  it("只移除 pier 条目, 保留用户 hook", () => {
    const user = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierClaudeHooks(withPierClaudeHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });

  it("清除 Pier 写入的 messageIdleNotifThresholdMs，保留用户显式阈值", () => {
    // Claude 默认 60s 不是 Pier 写入，保留
    const claudeDefault = withoutPierClaudeHooks(
      withPierClaudeHooks({ messageIdleNotifThresholdMs: 60_000 })
    );
    expect(claudeDefault.messageIdleNotifThresholdMs).toBe(60_000);

    const historical = withoutPierClaudeHooks({
      messageIdleNotifThresholdMs: 2500,
    });
    expect(historical.messageIdleNotifThresholdMs).toBeUndefined();

    const pier800 = withoutPierClaudeHooks({
      messageIdleNotifThresholdMs: CLAUDE_IDLE_PROMPT_THRESHOLD_MS,
    });
    expect(pier800.messageIdleNotifThresholdMs).toBeUndefined();

    const kept = withoutPierClaudeHooks({
      messageIdleNotifThresholdMs: 12_000,
    });
    expect(kept.messageIdleNotifThresholdMs).toBe(12_000);
  });
});

describe("install/uninstallClaudeHooks (文件 IO)", () => {
  it("往不存在的 settings.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await installClaudeHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallClaudeHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ not json", "utf8");
    await installClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it.each([
    '{"hooks":"user-value"}',
    '{"hooks":{"Stop":{"custom":true}}}',
    JSON.stringify({
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
    }),
  ])("合法 JSON 的异常 hooks shape 安装时保持字节不变：%s", async (raw) => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-shape-test-"));
    const path = join(dir, "settings.json");
    await writeFile(path, raw, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await installClaudeHooks(path);
      expect(await readFile(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    const original = '{"model":"opus"}';
    await writeFile(path, original, "utf8");
    await uninstallClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hook-test-"));
    const path = join(dir, "settings.json");
    await installClaudeHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installClaudeHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
