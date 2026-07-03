import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_HOOKS_DIR";

interface AutohandEntry {
  command: string;
  enabled?: boolean;
  event: string;
  timeout?: number;
}

function hookEntries(settings: Record<string, unknown>): AutohandEntry[] {
  const hooks = settings.hooks as { hooks?: AutohandEntry[] } | undefined;
  return Array.isArray(hooks?.hooks) ? hooks.hooks : [];
}

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-autohand-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/autohand.ts"
  );
  return mod.autohandIntegration;
}

function configPath(): string {
  return join(homeDir, ".autohand", "config.json");
}

describe("autohandIntegration", () => {
  it("capability 为 full，id 为 autohand", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("autohand");
  });

  it("detect(): ~/.autohand 目录存在时为 true", async () => {
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 autohand 二进制时即使无目录也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-autohand-bin-"));
    await writeFile(join(dir, "autohand"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("事件表齐全：8 个事件各一条命令，kebab 命名，enabled 恒为 true", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const entries = hookEntries(installed);

    const expectedEvents = [
      "session-start",
      "session-end",
      "session-error",
      "pre-prompt",
      "stop",
      "permission-request",
      "pre-tool",
      "post-tool",
    ];
    expect(entries).toHaveLength(expectedEvents.length);
    const byEvent = new Map(entries.map((e) => [e.event, e]));
    for (const evt of expectedEvents) {
      expect(byEvent.has(evt), evt).toBe(true);
      expect(byEvent.get(evt)?.enabled).toBe(true);
    }
    // post-response 别名不重复安装
    expect(byEvent.has("post-response")).toBe(false);

    for (const entry of entries) {
      expect(entry.command).toContain(MARK);
      expect(entry.command).toContain('"autohand"');
    }
    // pierEvent 名称核验
    expect(byEvent.get("session-start")?.command).toContain('"SessionStart"');
    expect(byEvent.get("session-end")?.command).toContain('"SessionEnd"');
    expect(byEvent.get("session-error")?.command).toContain('"error"');
    expect(byEvent.get("pre-prompt")?.command).toContain('"PromptSubmit"');
    expect(byEvent.get("stop")?.command).toContain('"Stop"');
    expect(byEvent.get("permission-request")?.command).toContain(
      '"PermissionRequest"'
    );
    expect(byEvent.get("pre-tool")?.command).toContain('"ToolStart"');
    expect(byEvent.get("post-tool")?.command).toContain('"ToolComplete"');
  });

  it("幂等：重复安装不产生重复条目", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const once = JSON.parse(await readFile(configPath(), "utf8"));
    await integration.install();
    const twice = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookEntries(twice)).toHaveLength(hookEntries(once).length);
  });

  it("重复安装第二次不改变文件字节", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const afterFirst = await readFile(configPath(), "utf8");
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(afterFirst);
  });

  it("保留用户已有的无关 hook 与顶层配置", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "autohand-1",
        hooks: {
          enabled: true,
          hooks: [{ event: "stop", command: "say done", enabled: true }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("autohand-1");
    const entries = hookEntries(installed);
    expect(entries.some((e) => e.command === "say done")).toBe(true);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          enabled: true,
          hooks: [{ event: "stop", command: "say done", enabled: true }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookEntries(cleaned)).toEqual([
      { event: "stop", command: "say done", enabled: true },
    ]);
  });

  it("已损坏的 config.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    const original = '{"model":"autohand-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
