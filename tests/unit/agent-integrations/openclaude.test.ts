import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_HOOK_PORT";

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
  homeDir = await mkdtemp(join(tmpdir(), "pier-openclaude-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/openclaude.ts"
  );
  return mod.openclaudeIntegration;
}

function configPath(): string {
  return join(homeDir, ".openclaude", "settings.json");
}

describe("openclaudeIntegration", () => {
  it("capability 为 full，id 为 openclaude", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("openclaude");
  });

  it("detect(): 配置存在时为 true", async () => {
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    const { mkdir, writeFile: wf } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await wf(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("为全部 13 个事件各注入一条 pier 命令，无 matcher", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;
    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PermissionRequest",
      "PermissionDenied",
      "PreCompact",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ];
    interface Matcher {
      hooks: Array<{ command: string }>;
      matcher?: string;
    }
    const typedHooks = hooks as unknown as Record<string, Matcher[]>;
    for (const evt of expectedEvents) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    expect(hooks.Notification).toBeUndefined();
    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain("$PIER_PANEL_ID");
      expect(cmd).toContain("$PIER_WINDOW_ID");
      expect(cmd).toContain('\\"agent\\":\\"openclaude\\"');
    }
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
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "opus",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("opus");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
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

  it("已损坏的 settings.json 不被覆盖(安装静默放弃)", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".openclaude"), { recursive: true });
    const original = '{"model":"opus"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
