import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  it("capability 为 full，id 为 cline", async () => {
    const { clineIntegration } = await loadIntegration();
    expect(clineIntegration.capability).toBe("full");
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

  it("clineHooksDir 指向 ~/Documents/Cline/Rules/Hooks", async () => {
    const { clineHooksDir } = await loadIntegration();
    expect(clineHooksDir()).toBe(
      join(homeDir, "Documents", "Cline", "Rules", "Hooks")
    );
  });
});

describe("buildClineHookScript", () => {
  it("含 shebang + 托管 marker + payload sessionId 抽取 + pier 命令", async () => {
    const { buildClineHookScript, CLINE_HOOK_MARKER } = await loadIntegration();
    const script = buildClineHookScript("Stop");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(CLINE_HOOK_MARKER);
    expect(script).toContain("session_id");
    expect(script).toContain("sessionId");
    expect(script).toContain(MARK);
    expect(script).toContain('"cline"');
    expect(script).toContain('"Stop"');
  });
});

describe("install/uninstallClineHooks (文件 IO)", () => {
  it("8 个事件各写一个可执行文件, 文件名精确匹配事件名", async () => {
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
      "TaskCancel",
      "TaskComplete",
      "PreCompact",
    ]);
    for (const name of CLINE_EVENT_FILE_NAMES) {
      const path = join(dir, name);
      const content = await readFile(path, "utf8");
      expect(content).toContain(MARK);
      expect(await isExecutable(path)).toBe(true);
    }
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
      ["TaskCancel", "Stop"],
      ["TaskComplete", "Stop"],
      ["PreCompact", "processing"],
    ];
    for (const [file, pierEvent] of expectations) {
      const content = await readFile(join(dir, file), "utf8");
      expect(content, file).toContain(`"${pierEvent}"`);
    }
  });

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
    const unmanaged = "#!/bin/sh\necho custom\n";
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
});
