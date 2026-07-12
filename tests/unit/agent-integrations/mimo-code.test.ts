import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMimoCodePluginSource,
  installMimoCodeHooks,
  MIMO_CODE_PLUGIN_MARKER_TEXT,
  mimoCodeIntegration,
  mimoCodePluginPath,
  uninstallMimoCodeHooks,
} from "../../../src/main/services/agents/integrations/mimo-code.ts";

const MARK = "PIER_AGENT_EVENT_LOG";

describe("buildMimoCodePluginSource", () => {
  const source = buildMimoCodePluginSource();

  it("含托管 marker", () => {
    expect(source).toContain(MIMO_CODE_PLUGIN_MARKER_TEXT);
    expect(source).toContain("managed by Pier");
  });

  it("同步优先写 JSONL（pierAppend: getBuiltinModule + appendFileSync, 异步退化）", () => {
    // 同步优先分支
    expect(source).toContain("process.getBuiltinModule");
    expect(source).toContain("appendFileSync");
    // 异步退化分支保留（旧 Node 宿主）
    expect(source).toContain('import("node:fs/promises")');
    expect(source).toContain("appendFile");
    // 无顶层 import 声明
    for (const line of source.split("\n")) {
      expect(line.trimStart().startsWith("import ")).toBe(false);
    }
    expect(source).not.toContain("/agent-event");
    expect(source).not.toContain("Authorization");
    expect(source).not.toContain("fetch(");
  });

  it("env 守卫覆盖三个必需变量（LOG/PANEL_ID/WINDOW_ID）", () => {
    expect(source).toContain(`process.env.${MARK}`);
    expect(source).toContain("process.env.PIER_PANEL_ID");
    expect(source).toContain("process.env.PIER_WINDOW_ID");
    expect(source).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(source).not.toContain("PIER_AGENT_HOOK_TOKEN");
  });

  it("最佳 effort：try/catch 吞异常, 不干扰 agent 本体", () => {
    expect(source).toContain("catch");
    expect(source).not.toContain("AbortController");
    expect(source).not.toContain("1500");
  });

  it("JSONL 行字段：v/kind/agent/event/panelId/windowId/pid/ts, agent 为 mimo-code", () => {
    expect(source).toContain("v: 1");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "mimo-code"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
    expect(source).toContain("pid: process.pid");
    expect(source).toContain("ts: Date.now() * 1_000_000");
  });

  it("事件映射齐全（与 opencode 同一套家族事件表）", () => {
    expect(source).toContain('"session.created") return "SessionStart"');
    expect(source).toContain('"session.idle") return "Stop"');
    expect(source).toContain('"session.error") return "error"');
    expect(source).toContain('command === "prompt.submit" ? "PromptSubmit"');
    expect(source).toContain(
      '"permission.updated") return "PermissionRequest"'
    );
    expect(source).toContain('"permission.replied") return "processing"');
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain('emitPierEvent("ToolStart", args)');
    expect(source).toContain('emitPierEvent("ToolComplete", args)');
    expect(source).toContain('event.type === "session.deleted"');
    expect(source).toContain("value.info || value.session || value.thread");
    expect(source).toContain("toolUseId");
  });

  it("无加载合成 SessionStart：factory 体到 return 之间无独立 emit（真实 session.created 覆盖）", () => {
    const factoryStart = source.indexOf("export const PierAgentStatus");
    const returnStatement = source.indexOf("return {", factoryStart);
    expect(factoryStart).toBeGreaterThanOrEqual(0);
    expect(returnStatement).toBeGreaterThan(factoryStart);
    const factoryPrelude = source.slice(factoryStart, returnStatement);
    expect(factoryPrelude).not.toContain("emitPierEvent(");
  });
});

describe("mimoCodePluginPath", () => {
  const originalHome = process.env.HOME;
  const originalMimoHome = process.env.MIMOCODE_HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalMimoHome === undefined) {
      delete process.env.MIMOCODE_HOME;
    } else {
      process.env.MIMOCODE_HOME = originalMimoHome;
    }
  });

  it("默认走 XDG ~/.config/mimocode/plugins/mimo-code-agent-status.js", () => {
    const HOME = "/tmp/pier-mimocode-home";
    delete process.env.MIMOCODE_HOME;
    process.env.HOME = HOME;
    expect(mimoCodePluginPath()).toBe(
      join(HOME, ".config", "mimocode", "plugins", "mimo-code-agent-status.js")
    );
  });

  it("MIMOCODE_HOME 设置时走 $MIMOCODE_HOME/config/plugins/...", () => {
    process.env.MIMOCODE_HOME = "/opt/mimocode-home";
    expect(mimoCodePluginPath()).toBe(
      join(
        "/opt/mimocode-home",
        "config",
        "plugins",
        "mimo-code-agent-status.js"
      )
    );
  });
});

describe("install/uninstallMimoCodeHooks (文件 IO)", () => {
  let dir: string;
  let pluginPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-mimocode-test-"));
    pluginPath = join(dir, "config", "plugins", "mimo-code-agent-status.js");
  });

  it("往不存在的插件路径安装, 内容含 marker", async () => {
    await installMimoCodeHooks(pluginPath);
    const content = await readFile(pluginPath, "utf8");
    expect(content).toContain(MIMO_CODE_PLUGIN_MARKER_TEXT);
  });

  it("无需 config 注册步骤：opencode 家族自动加载 plugins/ 目录下所有文件", async () => {
    await installMimoCodeHooks(pluginPath);
    const content = await readFile(pluginPath, "utf8");
    expect(content).toContain("PierAgentStatus");
  });

  it("卸载后文件删除", async () => {
    await installMimoCodeHooks(pluginPath);
    await uninstallMimoCodeHooks(pluginPath);
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("幂等：重复安装第二次不改变文件内容", async () => {
    await installMimoCodeHooks(pluginPath);
    const first = await readFile(pluginPath, "utf8");
    await installMimoCodeHooks(pluginPath);
    const second = await readFile(pluginPath, "utf8");
    expect(second).toBe(first);
  });

  it("非托管同名文件不覆盖, 发出告警", async () => {
    await mkdir(join(dir, "config", "plugins"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installMimoCodeHooks(pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载非托管文件也不删除, 发出告警", async () => {
    await mkdir(join(dir, "config", "plugins"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await uninstallMimoCodeHooks(pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载不存在的文件是零副作用 no-op", async () => {
    await expect(uninstallMimoCodeHooks(pluginPath)).resolves.toBeUndefined();
  });
});

describe("mimoCodeIntegration 契约", () => {
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalMimoHome = process.env.MIMOCODE_HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    if (originalMimoHome === undefined) {
      delete process.env.MIMOCODE_HOME;
    } else {
      process.env.MIMOCODE_HOME = originalMimoHome;
    }
  });

  it("capability 为 full, id 为 mimo-code", () => {
    expect(mimoCodeIntegration.capability).toBe("full");
    expect(mimoCodeIntegration.id).toBe("mimo-code");
  });

  it("detect：配置目录和命令都不存在 → false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-mimocode-detect-"));
    delete process.env.MIMOCODE_HOME;
    process.env.HOME = dir;
    process.env.PATH = "";
    expect(mimoCodeIntegration.detect()).toBe(false);
  });

  it("detect：~/.config/mimocode 目录存在 → true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-mimocode-detect2-"));
    await mkdir(join(dir, ".config", "mimocode"), { recursive: true });
    delete process.env.MIMOCODE_HOME;
    process.env.HOME = dir;
    process.env.PATH = "";
    expect(mimoCodeIntegration.detect()).toBe(true);
  });

  it("detect：mimo-code 命令在 PATH 上 → true", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "pier-mimocode-detect-path-home-")
    );
    const binDir = await mkdtemp(
      join(tmpdir(), "pier-mimocode-detect-path-bin-")
    );
    await writeFile(join(binDir, "mimo-code"), "#!/bin/sh\n", {
      mode: 0o755,
    });
    delete process.env.MIMOCODE_HOME;
    process.env.HOME = homeDir;
    process.env.PATH = binDir;
    expect(mimoCodeIntegration.detect()).toBe(true);
  });
});
