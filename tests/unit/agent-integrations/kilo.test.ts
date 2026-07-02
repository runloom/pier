import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_HOOK_PORT";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-kilo-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  return await import("../../../src/main/services/agents/integrations/kilo.ts");
}

describe("buildKiloPluginSource", () => {
  it("含托管 marker", async () => {
    const { buildKiloPluginSource, KILO_PLUGIN_MARKER_TEXT } =
      await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain(KILO_PLUGIN_MARKER_TEXT);
    expect(source).toContain("managed by Pier");
  });

  it("导出形状为 export default { id, server }（官方真实形状, 非顶层 event 直挂）", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("export default { id:");
    expect(source).toContain("server }");
    expect(source).toContain("const server = async () => {");
  });

  it("POST 目标为 /agent-event, 携带 Authorization Bearer 头", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("/agent-event");
    expect(source).toContain("Authorization");
    expect(source).toContain("Bearer");
  });

  it("env 守卫覆盖全部四个必需变量（PORT/TOKEN/PANEL_ID/WINDOW_ID）", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain(`process.env.${MARK}`);
    expect(source).toContain("process.env.PIER_AGENT_HOOK_TOKEN");
    expect(source).toContain("process.env.PIER_PANEL_ID");
    expect(source).toContain("process.env.PIER_WINDOW_ID");
  });

  it("fire-and-forget：1.5s 超时 + 吞异常", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("1500");
    expect(source).toContain("catch");
    expect(source).toContain("AbortController");
  });

  it("body 五字段 schema：v/agent/event/panelId/windowId", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("v: 1");
    expect(source).toContain('agent: "kilo"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
  });

  it("事件映射齐全：session.created/idle/error/deleted, permission.asked/replied（非 permission.updated）, tool.execute", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain('"session.created") return "SessionStart"');
    expect(source).toContain('"session.idle") return "Stop"');
    expect(source).toContain('"session.error") return "error"');
    expect(source).toContain('"session.deleted") return "SessionEnd"');
    expect(source).toContain('"permission.asked") return "PermissionRequest"');
    expect(source).toContain('"permission.replied") return "processing"');
    expect(source).not.toContain("permission.updated");
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain('emitPierEvent("ToolStart")');
    expect(source).toContain('emitPierEvent("ToolComplete")');
  });

  it("不装 PromptSubmit：官方事件表未明确 message.updated 可区分用户提交, 宁缺毋滥", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).not.toContain("PromptSubmit");
    expect(source).not.toContain("message.updated");
  });

  it("加载即 emit SessionStart：server 工厂体开头, 先于 event 订阅返回", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    const serverStart = source.indexOf("const server = async () => {");
    const loadEmit = source.indexOf('await emitPierEvent("SessionStart");');
    const returnStatement = source.indexOf("return {", serverStart);
    expect(serverStart).toBeGreaterThanOrEqual(0);
    expect(loadEmit).toBeGreaterThan(serverStart);
    expect(loadEmit).toBeLessThan(returnStatement);
  });
});

describe("kiloPluginPath", () => {
  it("路径固定在 ~/.config/kilo/plugin/pier-agent-status.ts", async () => {
    const { kiloPluginPath, KILO_PLUGIN_FILE_NAME } = await loadIntegration();
    expect(kiloPluginPath()).toBe(
      join(homeDir, ".config", "kilo", "plugin", KILO_PLUGIN_FILE_NAME)
    );
    expect(KILO_PLUGIN_FILE_NAME).toBe("pier-agent-status.ts");
  });
});

describe("install/uninstallKiloHooks (文件 IO, 目录自动加载无需 config 注册)", () => {
  it("安装：部署插件文件, 无需任何 config 写入", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    const { installKiloHooks, KILO_PLUGIN_MARKER_TEXT } =
      await loadIntegration();
    await installKiloHooks(pluginPath);
    const content = await readFile(pluginPath, "utf8");
    expect(content).toContain(KILO_PLUGIN_MARKER_TEXT);
  });

  it("卸载：删除托管插件文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    const { installKiloHooks, uninstallKiloHooks } = await loadIntegration();
    await installKiloHooks(pluginPath);
    await uninstallKiloHooks(pluginPath);
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("幂等：重复安装内容不变", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    const { installKiloHooks } = await loadIntegration();
    await installKiloHooks(pluginPath);
    const first = await readFile(pluginPath, "utf8");
    await installKiloHooks(pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(first);
  });

  it("非托管同名插件文件不覆盖, 发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    await mkdir(join(dir, "plugin"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const { installKiloHooks } = await loadIntegration();
    await installKiloHooks(pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载非托管插件文件不删除, 发出告警", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    await mkdir(join(dir, "plugin"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const { uninstallKiloHooks } = await loadIntegration();
    await uninstallKiloHooks(pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("未安装时卸载零写入/无报错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-test-"));
    const pluginPath = join(dir, "plugin", "pier-agent-status.ts");
    const { uninstallKiloHooks } = await loadIntegration();
    await expect(uninstallKiloHooks(pluginPath)).resolves.not.toThrow();
  });
});

describe("kiloIntegration 契约", () => {
  it("capability 为 full, id 为 kilo", async () => {
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.capability).toBe("full");
    expect(kiloIntegration.id).toBe("kilo");
  });

  it("detect：~/.config/kilo / ~/.kilocode / PATH 均无时为 false", async () => {
    vi.stubEnv("PATH", "");
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(false);
  });

  it("detect：~/.config/kilo 存在 → true", async () => {
    await mkdir(join(homeDir, ".config", "kilo"), { recursive: true });
    vi.stubEnv("PATH", "");
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(true);
  });

  it("detect：~/.kilocode 存在 → true", async () => {
    await mkdir(join(homeDir, ".kilocode"), { recursive: true });
    vi.stubEnv("PATH", "");
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(true);
  });

  it("detect：commandExistsOnPath 兜底——PATH 上有 kilo 二进制时即使无目录也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-bin-"));
    await writeFile(join(dir, "kilo"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(true);
  });
});
