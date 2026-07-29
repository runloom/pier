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
import { agentHookEventSchema } from "../../../src/shared/contracts/agent-session.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-cline-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  return await import(
    "../../../src/main/services/agents/integrations/cline.ts"
  );
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

describe("clineIntegration 契约", () => {
  it("id 为 cline", async () => {
    const { clineIntegration } = await loadIntegration();
    expect(clineIntegration.id).toBe("cline");
  });

  it("detect(): ~/Documents/Cline 存在时为 true", async () => {
    const { clineIntegration } = await loadIntegration();
    expect(clineIntegration.detect()).toBe(false);
    await mkdir(join(homeDir, "Documents", "Cline"), { recursive: true });
    expect(clineIntegration.detect()).toBe(true);
  });

  it("detect(): ~/.cline 存在时也为 true", async () => {
    const { clineIntegration } = await loadIntegration();
    await mkdir(join(homeDir, ".cline"), { recursive: true });
    expect(clineIntegration.detect()).toBe(true);
  });

  it("clineHooksDir 指向默认终端链路 ~/.cline/hooks", async () => {
    const { clineHooksDir } = await loadIntegration();
    expect(clineHooksDir()).toBe(join(homeDir, ".cline", "hooks"));
  });

  it("detect(): PATH 上有 cline 命令时无需预先存在配置目录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-bin-"));
    await writeFile(join(dir, "cline"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { clineIntegration } = await loadIntegration();
    expect(clineIntegration.detect()).toBe(true);
  });
});

describe("buildClineHookScript", () => {
  it("含 shebang + 托管 marker + payload sessionId 抽取 + pier 命令", async () => {
    const { buildClineHookScript, CLINE_HOOK_MARKER } = await loadIntegration();
    const script = buildClineHookScript("Stop");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(CLINE_HOOK_MARKER);
    expect(script).toContain("extract-stdin-meta");
    expect(script).toContain(MARK);
    expect(script).toContain('"cline"');
    expect(script).toContain('"Stop"');
    expect(script).toContain('"agentEventV3"');
  });
});

describe("install/uninstallClineHooks (文件 IO)", () => {
  it("只为当前 SDK 文件式配置支持的 9 个事件写可执行文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    const { installClineHooks, CLINE_EVENT_FILE_NAMES } =
      await loadIntegration();
    await installClineHooks(dir);
    expect(CLINE_EVENT_FILE_NAMES).toEqual([
      "TaskStart",
      "TaskResume",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "TaskComplete",
      "TaskCancel",
      "TaskError",
      "SessionShutdown",
    ]);
    for (const name of CLINE_EVENT_FILE_NAMES) {
      const path = join(dir, name);
      const content = await readFile(path, "utf8");
      expect(content).toContain(MARK);
      expect(await isExecutable(path)).toBe(true);
    }
  });

  it("Windows 明确不安装：无可在当前链路验证的原生严格 v3 runtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-win-"));
    const { buildClineHookScript, installClineHooks } = await loadIntegration();
    await installClineHooks(dir, "win32");
    await expect(
      readFile(join(dir, "TaskStart.ps1"), "utf8")
    ).rejects.toThrow();
    await expect(readFile(join(dir, "TaskStart"), "utf8")).rejects.toThrow();
    expect(() =>
      buildClineHookScript("SessionStart", "TaskStart", "win32")
    ).toThrow(/unsupported/i);
  });

  it("事件名到 pier 事件的映射正确", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    const { installClineHooks } = await loadIntegration();
    await installClineHooks(dir);
    const expectations: [string, string][] = [
      ["TaskStart", "SessionStart"],
      ["TaskResume", "running"],
      ["UserPromptSubmit", "PromptSubmit"],
      ["PreToolUse", "ToolStart"],
      ["PostToolUse", "ToolComplete"],
      ["TaskComplete", "TurnCompleted"],
      ["TaskCancel", "TurnInterrupted"],
      ["TaskError", "error"],
      ["SessionShutdown", "SessionEnd"],
    ];
    for (const [file, pierEvent] of expectations) {
      const content = await readFile(join(dir, file), "utf8");
      expect(content, file).toContain(`"${pierEvent}"`);
    }
  });

  it("真实嵌套 tool_call 输入保留任务、智能体与工具身份并形成严格 v3 事实", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cline-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const { buildClineHookScript } = await loadIntegration();
    const script = buildClineHookScript("ToolStart", "PreToolUse");
    const result = spawnSync("/bin/sh", ["-c", script], {
      env: {
        ...process.env,
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
        PIER_PANEL_ID: "p1",
        PIER_WINDOW_ID: "w1",
      },
      input: JSON.stringify({
        agent_id: "agent-2",
        parent_agent_id: "agent-1",
        sessionContext: { rootSessionId: "root-session-1" },
        taskId: "task-1",
        tool_call: {
          id: "tool-1",
          input: { command: "pwd" },
          name: "execute_command",
        },
      }),
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toBe("");
    const row = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    if (row.kind !== "agentEvent" || row.v !== 3) {
      throw new Error("expected v3 agent event");
    }
    expect(row).toMatchObject({
      agent: "cline",
      agentInstanceId: "agent-2",
      event: "ToolStart",
      nativeEvent: "PreToolUse",
      sessionId: "task-1",
      toolName: "execute_command",
      toolUseId: "tool-1",
      v: 3,
    });
    expect(row.parentSessionId).toBeUndefined();
  }, 15_000);

  it("卸载删除全部托管文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    const { installClineHooks, uninstallClineHooks } = await loadIntegration();
    await installClineHooks(dir);
    await uninstallClineHooks(dir);
    await expect(readFile(join(dir, "Stop"), "utf8")).rejects.toThrow();
    await expect(readFile(join(dir, "TaskCancel"), "utf8")).rejects.toThrow();
  });

  it("幂等：重复安装文件字节不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    const { installClineHooks } = await loadIntegration();
    await installClineHooks(dir);
    const first = await readFile(join(dir, "TaskCancel"), "utf8");
    await installClineHooks(dir);
    expect(await readFile(join(dir, "TaskCancel"), "utf8")).toBe(first);
  });

  it("已存在非托管同名文件绝不覆盖, 发出告警, 其余文件仍正常安装", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    await mkdir(dir, { recursive: true });
    const unmanaged = "#!/bin/sh\necho custom\n";
    await writeFile(join(dir, "TaskCancel"), unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const { installClineHooks } = await loadIntegration();
    await installClineHooks(dir);
    expect(await readFile(join(dir, "TaskCancel"), "utf8")).toBe(unmanaged);
    expect(await readFile(join(dir, "Stop"), "utf8").catch(() => null)).toBe(
      null
    );
    const other = await readFile(join(dir, "TaskStart"), "utf8");
    expect(other).toContain(MARK);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载非托管同名文件不删除, 发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-"));
    await mkdir(dir, { recursive: true });
    const unmanaged =
      "#!/bin/sh\n# This custom hook is managed by Pier's platform team.\necho custom\n";
    await writeFile(join(dir, "TaskCancel"), unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const { uninstallClineHooks } = await loadIntegration();
    await uninstallClineHooks(dir);
    expect(await readFile(join(dir, "TaskCancel"), "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("未安装时卸载零写入/无报错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-cline-hooks-empty-"));
    const { uninstallClineHooks } = await loadIntegration();
    await expect(uninstallClineHooks(dir)).resolves.not.toThrow();
  });

  it("升级只清理历史错误目录中的 Pier 文件，保留用户同目录文件", async () => {
    const legacyDir = join(homeDir, "Documents", "Cline", "Rules", "Hooks");
    await mkdir(legacyDir, { recursive: true });
    const { buildClineHookScript, clineIntegration } = await loadIntegration();
    await writeFile(
      join(legacyDir, "TaskStart"),
      buildClineHookScript("SessionStart", "TaskStart"),
      "utf8"
    );
    const userScript = "#!/bin/sh\necho user\n";
    await writeFile(join(legacyDir, "TaskCancel"), userScript, "utf8");

    await clineIntegration.install();

    await expect(
      readFile(join(legacyDir, "TaskStart"), "utf8")
    ).rejects.toThrow();
    expect(await readFile(join(legacyDir, "TaskCancel"), "utf8")).toBe(
      userScript
    );
  });

  it.each([
    "install",
    "uninstall",
  ] as const)("%s 会清理历史受管 PreCompact，同时保留用户同名脚本", async (operation) => {
    const legacyDir = join(homeDir, "Documents", "Cline", "Rules", "Hooks");
    await mkdir(legacyDir, { recursive: true });
    const { buildClineHookScript, clineIntegration } = await loadIntegration();
    await writeFile(
      join(legacyDir, "PreCompact"),
      buildClineHookScript("processing", "PreCompact"),
      "utf8"
    );
    const userScript = "# custom user PreCompact hook\n";
    await writeFile(join(legacyDir, "PreCompact.ps1"), userScript, "utf8");

    await clineIntegration[operation]();

    await expect(
      readFile(join(legacyDir, "PreCompact"), "utf8")
    ).rejects.toThrow();
    expect(await readFile(join(legacyDir, "PreCompact.ps1"), "utf8")).toBe(
      userScript
    );
  });
});
