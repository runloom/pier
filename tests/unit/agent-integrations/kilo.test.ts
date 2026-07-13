import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARK = "PIER_AGENT_EVENT_LOG";
/** 顶层 ImportDeclaration 探测（行首 import——electron-vite 扫描陷阱）。 */
const TOP_LEVEL_IMPORT_RE = /^import\s/m;

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

  it("同步 JSONL（pierAppend → appendFileSync, 异步退化分支）", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    // 同步写路径
    expect(source).toContain("appendFileSync");
    expect(source).toContain('process.getBuiltinModule("node:fs")');
    expect(source).toContain("pierAppend(log, line)");
    // 旧 Node 异步退化
    expect(source).toContain('import("node:fs/promises")');
    // 无 HTTP
    expect(source).not.toContain("/agent-event");
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("fetch(");
    // 无顶层 import 声明（electron-vite 模板字面量扫描陷阱）
    expect(source).not.toMatch(TOP_LEVEL_IMPORT_RE);
  });

  it("env 守卫覆盖三个必需变量（LOG/PANEL_ID/WINDOW_ID）", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain(`process.env.${MARK}`);
    expect(source).toContain("process.env.PIER_PANEL_ID");
    expect(source).toContain("process.env.PIER_WINDOW_ID");
    expect(source).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(source).not.toContain("PIER_AGENT_HOOK_TOKEN");
  });

  it("最佳 effort：try/catch 吞异常, 不干扰 agent 本体", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("catch");
    expect(source).not.toContain("AbortController");
    expect(source).not.toContain("1500");
  });

  it("JSONL 行字段：v/kind/agent/event/panelId/windowId/pid/ts", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("v: 2");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "kilo"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("nativeEvent,");
    expect(source).toContain("nativeState");
    expect(source).toContain('actorHint: "subagent"');
    expect(source).toContain("parentSessionId");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
    expect(source).toContain("pid: process.pid");
    expect(source).toContain("ts: Date.now() * 1_000_000");
  });

  it("事件映射齐全：session.created/idle/error/deleted/status, permission.asked/replied, tool.execute", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain('"session.created") return "SessionStart"');
    expect(source).toContain('"session.idle") return "Stop"');
    expect(source).toContain('"session.error") return "error"');
    expect(source).toContain('"session.deleted") return "SessionEnd"');
    // session.status: busy/retry→running（TURN_RESET）, idle→Stop
    expect(source).toContain('"session.status"');
    expect(source).toContain('"busy"');
    expect(source).toContain('"retry"');
    expect(source).toContain('return "running"');
    expect(source).toContain('"permission.asked") return "PermissionRequest"');
    expect(source).toContain('"permission.replied") return "processing"');
    expect(source).not.toContain("permission.updated");
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain(
      'pierEmit("ToolStart", "tool.execute.before", args)'
    );
    expect(source).toContain(
      'pierEmit("ToolComplete", "tool.execute.after", args)'
    );
    expect(source).toContain("value.info || value.session || value.thread");
    expect(source).toContain("toolUseId");
  });

  it("不装 PromptSubmit：command.executed payload 未确认, session.status(busy/retry) 已提供 TURN_RESET", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).not.toContain("PromptSubmit");
    expect(source).not.toContain("message.updated");
  });

  it("不合成 SessionStart：session.created 提供真实信号, 工厂体无合成 emit", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    // mapPierEvent 内 session.created→SessionStart 是正确的数据映射,
    // 但 server 工厂体不应有显式 pierEmit("SessionStart") 合成调用。
    const serverStart = source.indexOf("const server = async () => {");
    const serverBody = source.slice(
      serverStart,
      source.indexOf("export default")
    );
    expect(serverBody).not.toContain('pierEmit("SessionStart")');
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
