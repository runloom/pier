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
  homeDir = await mkdtemp(join(tmpdir(), "pier-command-code-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/command-code.ts"
  );
  return mod.commandCodeIntegration;
}

function configPath(): string {
  return join(homeDir, ".commandcode", "settings.json");
}

describe("commandCodeIntegration", () => {
  it("capability 为 coarse，id 为 command-code", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("coarse");
    expect(integration.id).toBe("command-code");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".commandcode"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("装 4 个事件（SessionStart/PreToolUse/PostToolUse/Stop），工具事件 matcher 为 .*", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.Stop).toHaveLength(1);
    expect(Object.keys(hooks).sort()).toEqual(
      ["PostToolUse", "PreToolUse", "SessionStart", "Stop"].sort()
    );

    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;
    expect(typedHooks.PreToolUse?.[0]?.matcher).toBe(".*");
    expect(typedHooks.PostToolUse?.[0]?.matcher).toBe(".*");
    expect(typedHooks.Stop?.[0]?.matcher).toBeUndefined();
    expect(typedHooks.SessionStart?.[0]?.matcher).toBeUndefined();

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"command-code"');
    }

    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolStart"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.Stop?.[0]?.hooks[0]?.command).toContain('"Stop"');
    expect(typedHooks.SessionStart?.[0]?.hooks[0]?.command).toContain(
      '"SessionStart"'
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
    await mkdir(join(homeDir, ".commandcode"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "cc-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("cc-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".commandcode"), { recursive: true });
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
      (cleaned.hooks as Record<string, unknown>).PreToolUse
    ).toBeUndefined();
  });

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".commandcode"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".commandcode"), { recursive: true });
    const original = '{"model":"cc-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
