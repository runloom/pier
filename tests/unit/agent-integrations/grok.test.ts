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

  it("写入专用文件 ~/.grok/hooks/pier-status.json，14 个事件各一条命令", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;

    // 生命周期/非工具事件：无 matcher
    for (const evt of [
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
      "StopFailure",
      "Notification",
      "SubagentStart",
      "SubagentStop",
      "PreCompact",
      "PostCompact",
      "SessionEnd",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    // 工具事件：matcher "*"（官方文档 line 147 明确 matcher 测试 tool name）
    for (const evt of [
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionDenied",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe("*");
    }

    // 所有命令包含 agentId
    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"grok"');
    }

    // pierEvent 名称核验（本机 ~/.grok/docs/user-guide/10-hooks.md 对照）
    expect(typedHooks.PostToolUseFailure?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
    );
    expect(typedHooks.StopFailure?.[0]?.hooks[0]?.command).toContain('"error"');
    expect(typedHooks.Notification?.[0]?.hooks[0]?.command).toContain(
      '"PermissionRequest"'
    );
    expect(typedHooks.PermissionDenied?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
    expect(typedHooks.SubagentStart?.[0]?.hooks[0]?.command).toContain(
      '"SubagentStart"'
    );
    expect(typedHooks.SubagentStop?.[0]?.hooks[0]?.command).toContain(
      '"SubagentStop"'
    );
    expect(typedHooks.PreCompact?.[0]?.hooks[0]?.command).toContain(
      '"processing"'
    );
    expect(typedHooks.PostCompact?.[0]?.hooks[0]?.command).toContain(
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
