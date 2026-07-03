import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { droidIntegration } from "../../../src/main/services/agents/integrations/droid.ts";

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
  homeDir = await mkdtemp(join(tmpdir(), "pier-droid-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/droid.ts"
  );
  return mod.droidIntegration;
}

function configPath(): string {
  return join(homeDir, ".factory", "settings.json");
}

describe("droidIntegration", () => {
  it("capability 为 full，id 为 droid", async () => {
    const integration = await loadIntegration();
    expect(integration.capability).toBe("full");
    expect(integration.id).toBe("droid");
  });

  it("detect(): 配置存在时为 true", async () => {
    // PATH 置空，隔离本机真实安装的 droid 二进制（commandExistsOnPath 兜底
    // 分支），确保这里只验证「配置文件存在」这一条件。
    vi.stubEnv("PATH", "");
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(configPath(), "{}", "utf8");
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 droid 二进制时即使无配置也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-droid-bin-"));
    await writeFile(join(dir, "droid"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("事件表齐全：7 个事件各一条命令，工具事件 matcher 为 *，不装 SubagentStop/Notification/PermissionRequest", async () => {
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
      "SessionEnd",
      "UserPromptSubmit",
      "Stop",
      "PreCompact",
    ]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBeUndefined();
    }
    for (const evt of ["PreToolUse", "PostToolUse"]) {
      expect(hooks[evt], evt).toHaveLength(1);
      expect(typedHooks[evt]?.[0]?.matcher).toBe("*");
    }
    expect(hooks.SubagentStop).toBeUndefined();
    expect(hooks.Notification).toBeUndefined();
    expect(hooks.PermissionRequest).toBeUndefined();

    for (const cmd of hookCommands(installed)) {
      expect(cmd).toContain(MARK);
      expect(cmd).toContain('"droid"');
    }
    // pierEvent 名称核验
    expect(typedHooks.Stop?.[0]?.hooks[0]?.command).toContain('"Stop"');
    expect(typedHooks.PreToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolStart"'
    );
    expect(typedHooks.PostToolUse?.[0]?.hooks[0]?.command).toContain(
      '"ToolComplete"'
    );
    expect(typedHooks.UserPromptSubmit?.[0]?.hooks[0]?.command).toContain(
      '"PromptSubmit"'
    );
    expect(typedHooks.SessionStart?.[0]?.hooks[0]?.command).toContain(
      '"SessionStart"'
    );
    expect(typedHooks.SessionEnd?.[0]?.hooks[0]?.command).toContain(
      '"SessionEnd"'
    );
    expect(typedHooks.PreCompact?.[0]?.hooks[0]?.command).toContain(
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

  it("保留用户已有的无关 hook 与顶层配置", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "droid-1",
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("droid-1");
    const stop = (installed.hooks as Record<string, unknown[]>).Stop;
    expect(stop).toHaveLength(2);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
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
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".factory"), { recursive: true });
    const original = '{"model":"droid-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});

describe("droid 遗留 HTTP hooks 处理（LEGACY_HOOK_MARK 删除后不再自动清理）", () => {
  it("install 保留旧 hooks.json 的 HTTP-format 条目为用户配置, settings.json 正常写入新 JSONL 条目", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-droid-legacy-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const factoryDir = join(home, ".factory");
      await mkdir(factoryDir, { recursive: true });
      const legacy = {
        hooks: {
          Stop: [
            { hooks: [{ type: "command", command: "say done" }] },
            {
              hooks: [
                {
                  type: "command",
                  command: 'x PIER_AGENT_HOOK_PORT curl "$PIER_PANEL_ID"',
                },
              ],
            },
          ],
        },
      };
      await writeFile(
        join(factoryDir, "hooks.json"),
        JSON.stringify(legacy),
        "utf8"
      );
      await droidIntegration.install();
      // LEGACY_HOOK_MARK 删除后，旧 HTTP 条目已无法被识别为 pier-managed，
      // 因此保持原样——作为用户配置对待。这是干净 cutover 的一次性代价。
      const cleaned = JSON.parse(
        await readFile(join(factoryDir, "hooks.json"), "utf8")
      );
      expect(JSON.stringify(cleaned)).toContain("PIER_AGENT_HOOK_PORT");
      // 新路径 (settings.json) 正常写入 JSONL 通路条目
      const fresh = JSON.parse(
        await readFile(join(factoryDir, "settings.json"), "utf8")
      );
      expect(JSON.stringify(fresh)).toContain(MARK);
    } finally {
      process.env.HOME = prevHome;
    }
  });
});
