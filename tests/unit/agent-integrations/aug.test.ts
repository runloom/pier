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
  homeDir = await mkdtemp(join(tmpdir(), "pier-aug-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/aug.ts"
  );
  return mod.augIntegration;
}

function configPath(): string {
  return join(homeDir, ".augment", "settings.json");
}

describe("augIntegration", () => {
  it("capability 为 full，id 为 aug", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("aug");
  });

  it("detect(): ~/.augment 目录存在时为 true", async () => {
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 auggie/aug 二进制时即使无 ~/.augment 也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aug-bin-"));
    await writeFile(join(dir, "auggie"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("detect(): PATH 上有 aug 二进制（别名）时也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-aug-bin2-"));
    await writeFile(join(dir, "aug"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("事件表齐全：6 个事件各一条命令，工具事件 matcher 为 .*，含 UserPromptSubmit", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;

    interface Matcher {
      hooks: Array<{ command: string; timeout?: number }>;
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
    for (const evt of ["PreToolUse", "PostToolUse"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe(".*");
    }
    expect(hooks.PermissionRequest).toBeUndefined();

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"aug"');
    }
    // pierEvent 名称核验
    expect(typedHooks.Stop?.[0]?.hooks[0]?.command).toContain('"Stop"');
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolStart"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.SessionStart?.[0]?.hooks[0]?.command).toContain(
      '"SessionStart"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
    );
    // timeout 单位是毫秒（官方 schema），非 droid/claude 家族的秒
    expect(typedHooks.Stop?.[0]?.hooks[0]?.timeout).toBe(5000);
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
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "aug-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("aug-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
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
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".augment"), { recursive: true });
    const original = '{"model":"aug-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
