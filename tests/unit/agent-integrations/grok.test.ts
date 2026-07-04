import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  homeDir = await mkdtemp(join(tmpdir(), "pier-grok-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/grok.ts"
  );
  return mod.grokIntegration;
}

function configPath(): string {
  return join(homeDir, ".grok", "hooks", "pier-status.json");
}

describe("grokIntegration", () => {
  it("capability 为 full，id 为 grok", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("grok");
  });

  it("detect(): ~/.grok 目录存在时为 true（无需专用配置文件）", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".grok"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("写入专用文件 ~/.grok/hooks/pier-status.json，7 个事件各一条命令", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    for (const evt of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe("*");
    }
    expect(hooks.Notification).toBeUndefined();

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"grok"');
    }

    expect(typedHooks.PostToolUseFailure?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
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

  it("卸载后专用文件的 hooks 变为空对象（条目全清）", async () => {
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookCommands(cleaned)).toHaveLength(0);
    expect(cleaned.hooks).toEqual({});
  });

  it("已损坏的专用文件不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".grok", "hooks"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".grok", "hooks"), { recursive: true });
    const original = '{"hooks":{}}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
