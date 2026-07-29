import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/agent-hooks-install.ts";
import {
  installGeminiHooks,
  uninstallGeminiHooks,
  withoutPierGeminiHooks,
  withPierGeminiHooks,
} from "../../../src/main/services/agents/integrations/gemini.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent-session.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

const GEMINI_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "BeforeAgent",
  "AfterAgent",
  "PreCompress",
  "BeforeTool",
  "AfterTool",
];

function hookMatchers(settings: Record<string, unknown>) {
  const hooks = (settings.hooks ?? {}) as Record<
    string,
    Array<{
      hooks: Array<{ command: string; timeout?: number }>;
      matcher?: string;
    }>
  >;
  return hooks;
}

function hookCommands(settings: Record<string, unknown>): string[] {
  const hooks = hookMatchers(settings);
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks.map((h) => h.command));
}

function allHookEntries(
  settings: Record<string, unknown>
): Array<{ command: string; timeout?: number }> {
  const hooks = hookMatchers(settings);
  return Object.values(hooks)
    .flat()
    .flatMap((m) => m.hooks);
}

describe("withPierGeminiHooks", () => {
  it("只为 7 个有完整状态语义的 Gemini hook 键注入命令", () => {
    const next = withPierGeminiHooks({});
    const hooks = next.hooks as Record<string, unknown[]>;
    for (const evt of GEMINI_EVENTS) {
      expect(hooks[evt], evt).toHaveLength(1);
    }
    for (const cmd of hookCommands(next)) {
      expect(cmd).toContain(MARK);
    }
  });

  it("BeforeTool / AfterTool 对 ask_user 也只报告普通工具生命周期", () => {
    const next = withPierGeminiHooks({});
    const hooks = hookMatchers(next);
    expect(hooks.BeforeTool?.map((entry) => entry.matcher)).toEqual([
      undefined,
    ]);
    expect(hooks.AfterTool?.map((entry) => entry.matcher)).toEqual([undefined]);
  });

  it("所有注入的 hook 条目 timeout 字段严格等于 10000（毫秒陷阱）", () => {
    const next = withPierGeminiHooks({});
    const entries = allHookEntries(next);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.timeout).toBe(10_000);
    }
  });

  it("不安装缺少请求 ID 与结果事件的 Notification waiting", () => {
    const next = withPierGeminiHooks({});
    const hooks = hookMatchers(next);
    const keys = Object.keys(hooks);
    expect(keys).toHaveLength(GEMINI_EVENTS.length);
    expect(keys.sort()).toEqual([...GEMINI_EVENTS].sort());
    expect(hooks.Notification).toBeUndefined();
    expect(hookCommands(next).join("\n")).not.toContain(
      '"InteractionRequested"'
    );
    // PreCompress → processing（压缩期间保持活跃状态）
    const preCompress = hooks.PreCompress ?? [];
    expect(preCompress).toHaveLength(1);
    expect(preCompress[0]?.matcher).toBeUndefined();
    const compressCmds = preCompress.flatMap((m) =>
      m.hooks.map((h) => h.command)
    );
    expect(compressCmds[0]).toContain('"processing"');
  });

  it("真实 ask_user 输入只形成普通工具生命周期，不伪造 waiting", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-gemini-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const hooks = hookMatchers(withPierGeminiHooks({}));
    const commandFor = (nativeEvent: string) =>
      hooks[nativeEvent]?.[0]?.hooks[0]?.command ?? "";
    const env = {
      ...process.env,
      PIER_AGENT_EVENT_LOG: logPath,
      PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
      PIER_PANEL_ID: "p1",
      PIER_WINDOW_ID: "w1",
    };
    const run = (nativeEvent: string, payload: Record<string, unknown>) => {
      const result = spawnSync("/bin/sh", ["-c", commandFor(nativeEvent)], {
        env,
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    };

    run("BeforeTool", {
      cwd: "/workspace",
      hook_event_name: "BeforeTool",
      session_id: "session-1",
      timestamp: "2026-07-29T00:00:00Z",
      tool_input: {
        questions: [{ question: "Continue?", type: "choice" }],
      },
      tool_name: "ask_user",
      transcript_path: "/tmp/gemini-transcript.json",
    });
    run("AfterTool", {
      cwd: "/workspace",
      hook_event_name: "AfterTool",
      session_id: "session-1",
      timestamp: "2026-07-29T00:00:01Z",
      tool_input: {
        questions: [{ question: "Continue?", type: "choice" }],
      },
      tool_name: "ask_user",
      tool_response: {
        llmContent: "User dismissed ask_user dialog without answering.",
        returnDisplay: "User dismissed dialog",
      },
      transcript_path: "/tmp/gemini-transcript.json",
    });

    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      {
        event: "ToolStart",
        nativeEvent: "BeforeTool",
        sessionId: "session-1",
        toolName: "ask_user",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "AfterTool",
        sessionId: "session-1",
        toolName: "ask_user",
        v: 3,
      },
    ]);
  }, 15_000);

  it("幂等：重复安装不产生重复条目", () => {
    const once = withPierGeminiHooks({});
    const twice = withPierGeminiHooks(once);
    expect(hookCommands(twice)).toHaveLength(hookCommands(once).length);
  });

  it("保留用户已有的无关 hook 与顶层配置", () => {
    const user = {
      contextFileName: "GEMINI.md",
      hooks: {
        AfterAgent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const next = withPierGeminiHooks(user);
    expect(next.contextFileName).toBe("GEMINI.md");
    const afterAgent = (next.hooks as Record<string, unknown[]>).AfterAgent;
    expect(afterAgent).toHaveLength(2);
  });
});

describe("withoutPierGeminiHooks", () => {
  it("只移除 pier 条目, 保留用户 hook", () => {
    const user = {
      hooks: {
        AfterAgent: [{ hooks: [{ type: "command", command: "say done" }] }],
      },
    };
    const cleaned = withoutPierGeminiHooks(withPierGeminiHooks(user));
    const cmds = hookCommands(cleaned);
    expect(cmds).toEqual(["say done"]);
    expect(
      (cleaned.hooks as Record<string, unknown>).SessionStart
    ).toBeUndefined();
  });
});

describe("install/uninstallGeminiHooks (文件 IO)", () => {
  it("往不存在的 settings.json 安装并可卸载还原", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await installGeminiHooks(path);
    const installed = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(installed).length).toBeGreaterThan(0);
    await uninstallGeminiHooks(path);
    const cleaned = JSON.parse(await readFile(path, "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await writeFile(path, "{ not json", "utf8");
    await installGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe("{ not json");
  });

  it("目标键异常时不先清理另一键旧 Pier，整文件字节不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-shape-test-"));
    const path = join(dir, "settings.json");
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
        AfterAgent: { custom: true },
      },
    });
    await writeFile(path, raw, "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await installGeminiHooks(path);
      expect(await readFile(path, "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("无变化不落盘（启动期关→卸载对齐防护）", () => {
  it("卸载对无 pier hook 的文件保持字节原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    const original = '{"contextFileName":"GEMINI.md"}';
    await writeFile(path, original, "utf8");
    await uninstallGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  it("重复安装第二次不改变文件内容", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-gemini-hook-test-"));
    const path = join(dir, "settings.json");
    await installGeminiHooks(path);
    const afterFirst = await readFile(path, "utf8");
    await installGeminiHooks(path);
    expect(await readFile(path, "utf8")).toBe(afterFirst);
  });
});
