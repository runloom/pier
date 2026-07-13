import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentHookEventSchema } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectsForAcceptedAgentEvent } from "../../../src/main/services/agents/agent-event-effects.ts";
import {
  buildOpencodePluginSource,
  installOpencodeHooks,
  OPENCODE_PLUGIN_FILE_NAME,
  OPENCODE_PLUGIN_MARKER_TEXT,
  opencodeConfigPath,
  opencodeIntegration,
  opencodePluginPath,
  uninstallOpencodeHooks,
  withoutPierOpencodePlugin,
} from "../../../src/main/services/agents/integrations/opencode.ts";

const MARK = "PIER_AGENT_EVENT_LOG";
const LEGACY_FILE = "opencode-agent-status.js";

describe("buildOpencodePluginSource", () => {
  const source = buildOpencodePluginSource();

  it("含托管 marker", () => {
    expect(source).toContain(OPENCODE_PLUGIN_MARKER_TEXT);
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

  it("JSONL 行字段：v/kind/agent/event/panelId/windowId/pid/ts", () => {
    expect(source).toContain("v: 2");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "opencode"');
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

  it("事件映射齐全：session.created/idle/error/prompt.submit/permission.updated/replied/tool.execute", () => {
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
    expect(source).toContain(
      'emitPierEvent("ToolStart", "tool.execute.before", args)'
    );
    expect(source).toContain(
      'emitPierEvent("ToolComplete", "tool.execute.after", args)'
    );
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

describe("opencode 生成插件的子会话身份继承", () => {
  it("child created 后的 status/tool/deleted 全部保持 subagent actor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-runtime-"));
    const logPath = join(dir, "events.jsonl");
    const previousEnv = {
      log: process.env.PIER_AGENT_EVENT_LOG,
      panel: process.env.PIER_PANEL_ID,
      window: process.env.PIER_WINDOW_ID,
    };
    process.env.PIER_AGENT_EVENT_LOG = logPath;
    process.env.PIER_PANEL_ID = "panel-1";
    process.env.PIER_WINDOW_ID = "1";
    try {
      interface GeneratedPlugin {
        event: (args: { event: Record<string, unknown> }) => void;
        "tool.execute.after": (...args: unknown[]) => void;
        "tool.execute.before": (...args: unknown[]) => void;
      }
      const moduleShim: {
        exports: (() => GeneratedPlugin) | undefined;
      } = { exports: undefined };
      const source = buildOpencodePluginSource().replace(
        "export const PierAgentStatus =",
        "module.exports ="
      );
      const evaluate = new Function("module", source) as (
        module: typeof moduleShim
      ) => void;
      evaluate(moduleShim);
      if (!moduleShim.exports) throw new Error("生成插件没有导出 factory");
      const plugin = moduleShim.exports();
      plugin.event({
        event: {
          properties: { info: { id: "child", parentID: "parent" } },
          type: "session.created",
        },
      });
      plugin.event({
        event: {
          properties: { sessionID: "child", status: { type: "busy" } },
          type: "session.status",
        },
      });
      plugin["tool.execute.before"]({ callID: "tool-1", sessionID: "child" });
      plugin["tool.execute.after"]({ callID: "tool-1", sessionID: "child" });
      plugin.event({
        event: {
          properties: { info: { id: "child" } },
          type: "session.deleted",
        },
      });

      await vi.waitFor(async () => {
        expect(
          (await readFile(logPath, "utf8")).trim().split("\n")
        ).toHaveLength(5);
      });
      const events = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
      for (const event of events) {
        if (event.kind !== "agentEvent") continue;
        expect(event).toMatchObject({
          actorHint: "subagent",
          parentSessionId: "parent",
          sessionId: "child",
        });
        expect(effectsForAcceptedAgentEvent(event)).toEqual({
          markPanelExited: false,
          observeTranscript: false,
          persistResume: false,
        });
      }
    } finally {
      if (previousEnv.log === undefined)
        delete process.env.PIER_AGENT_EVENT_LOG;
      else process.env.PIER_AGENT_EVENT_LOG = previousEnv.log;
      if (previousEnv.panel === undefined) delete process.env.PIER_PANEL_ID;
      else process.env.PIER_PANEL_ID = previousEnv.panel;
      if (previousEnv.window === undefined) delete process.env.PIER_WINDOW_ID;
      else process.env.PIER_WINDOW_ID = previousEnv.window;
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("opencodeConfigPath / opencodePluginPath", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("两个 config 路径都不存在时默认 ~/.config/opencode/opencode.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-cfgpath-"));
    process.env.HOME = dir;
    expect(opencodeConfigPath()).toBe(
      join(dir, ".config", "opencode", "opencode.json")
    );
  });

  it("取已存在者：~/.opencode/opencode.json 优先命中第二候选", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-cfgpath2-"));
    await mkdir(join(dir, ".opencode"), { recursive: true });
    await writeFile(join(dir, ".opencode", "opencode.json"), "{}", "utf8");
    process.env.HOME = dir;
    expect(opencodeConfigPath()).toBe(join(dir, ".opencode", "opencode.json"));
  });

  it("插件路径落在 config 根目录的自动发现 plugins/ 子目录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-plugpath-"));
    process.env.HOME = dir;
    expect(opencodePluginPath()).toBe(
      join(dir, ".config", "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME)
    );
  });

  it("config 根在 ~/.opencode 时插件路径同步跟随", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-plugpath2-"));
    await mkdir(join(dir, ".opencode"), { recursive: true });
    await writeFile(join(dir, ".opencode", "opencode.json"), "{}", "utf8");
    process.env.HOME = dir;
    expect(opencodePluginPath()).toBe(
      join(dir, ".opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME)
    );
  });
});

describe("withoutPierOpencodePlugin (legacy config 注册清理)", () => {
  it("移除旧版字符串注册条目（绝对路径含旧文件名）", () => {
    const config = {
      plugin: ["some-other-plugin.js", `/home/u/.pier/plugins/${LEGACY_FILE}`],
    };
    expect(withoutPierOpencodePlugin(config).plugin).toEqual([
      "some-other-plugin.js",
    ]);
  });

  it("移除新文件名 pier-agent-status 的注册条目", () => {
    const config = { plugin: ["/x/plugins/pier-agent-status.js"] };
    expect(withoutPierOpencodePlugin(config).plugin).toEqual([]);
  });

  it("数组形式条目 [path, opts] 也可识别移除", () => {
    const config = {
      plugin: [[`/home/u/.pier/plugins/${LEGACY_FILE}`, {}], "keep.js"],
    };
    expect(withoutPierOpencodePlugin(config).plugin).toEqual(["keep.js"]);
  });

  it("无托管条目时原样返回输入引用", () => {
    const config = { plugin: ["some-other-plugin.js"] };
    expect(withoutPierOpencodePlugin(config)).toBe(config);
  });

  it("不误删 loomdesk 的同名插件注册（按 Pier 路径识别, 不按裸文件名）", () => {
    const config = {
      plugin: [
        `/Users/u/.loomdesk/plugins/${LEGACY_FILE}`,
        `/Users/u/.pier/plugins/${LEGACY_FILE}`,
      ],
    };
    expect(withoutPierOpencodePlugin(config).plugin).toEqual([
      `/Users/u/.loomdesk/plugins/${LEGACY_FILE}`,
    ]);
  });

  it("plugin 数组清空时保留空数组键", () => {
    const config = { plugin: [`/a/.pier/plugins/${LEGACY_FILE}`] };
    expect(withoutPierOpencodePlugin(config).plugin).toEqual([]);
  });
});

describe("install/uninstallOpencodeHooks (文件 IO)", () => {
  let dir: string;
  let configPath: string;
  let pluginPath: string;
  const originalHome = process.env.HOME;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-opencode-test-"));
    // 隔离 HOME：legacy 清理路径 (~/.pier/plugins/...) 不得触碰真实用户目录。
    process.env.HOME = dir;
    configPath = join(dir, "opencode.json");
    pluginPath = join(dir, "plugins", OPENCODE_PLUGIN_FILE_NAME);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("安装：部署插件文件到自动发现目录, 不创建也不写 config", async () => {
    await installOpencodeHooks(configPath, pluginPath);
    const pluginContent = await readFile(pluginPath, "utf8");
    expect(pluginContent).toContain(OPENCODE_PLUGIN_MARKER_TEXT);
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("安装：清理旧版 config 注册条目 + 旧版 ~/.pier 插件文件", async () => {
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    await writeFile(legacyPath, `// ${OPENCODE_PLUGIN_MARKER_TEXT}\n`, "utf8");
    await writeFile(
      configPath,
      JSON.stringify({ plugin: [legacyPath, "keep.js"] }, null, 2),
      "utf8"
    );
    await installOpencodeHooks(configPath, pluginPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.plugin).toEqual(["keep.js"]);
    await expect(readFile(legacyPath, "utf8")).rejects.toThrow();
    expect(await readFile(pluginPath, "utf8")).toContain(
      OPENCODE_PLUGIN_MARKER_TEXT
    );
  });

  it("安装：非托管的旧版 ~/.pier 文件不删除", async () => {
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    const unmanaged = "// someone else's file\n";
    await writeFile(legacyPath, unmanaged, "utf8");
    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(legacyPath, "utf8")).toBe(unmanaged);
  });

  it("幂等：重复安装插件文件内容不变", async () => {
    await installOpencodeHooks(configPath, pluginPath);
    const firstPlugin = await readFile(pluginPath, "utf8");
    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(firstPlugin);
  });

  it("非托管同名插件文件不覆盖, 发出告警", async () => {
    await mkdir(join(dir, "plugins"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载：删除托管插件文件", async () => {
    await installOpencodeHooks(configPath, pluginPath);
    await uninstallOpencodeHooks(configPath, pluginPath);
    await expect(readFile(pluginPath, "utf8")).rejects.toThrow();
  });

  it("卸载：非托管插件文件不删除, 发出告警", async () => {
    await mkdir(join(dir, "plugins"), { recursive: true });
    const unmanaged = "// someone else's plugin\n";
    await writeFile(pluginPath, unmanaged, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await uninstallOpencodeHooks(configPath, pluginPath);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanaged);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载：插件文件不存在视为已卸载（不抛错）", async () => {
    await expect(
      uninstallOpencodeHooks(configPath, pluginPath)
    ).resolves.toBeUndefined();
  });

  it("卸载：同样清理旧版 config 注册条目", async () => {
    await writeFile(
      configPath,
      JSON.stringify(
        { plugin: [`/a/.pier/plugins/${LEGACY_FILE}`, "keep.js"] },
        null,
        2
      ),
      "utf8"
    );
    await uninstallOpencodeHooks(configPath, pluginPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.plugin).toEqual(["keep.js"]);
  });

  it("config 损坏时 legacy 清理静默放弃, 字节不变, 插件文件仍部署", async () => {
    await writeFile(configPath, "{ not json", "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(configPath, "utf8")).toBe("{ not json");
    expect(await readFile(pluginPath, "utf8")).toContain(
      OPENCODE_PLUGIN_MARKER_TEXT
    );
    warnSpy.mockRestore();
  });

  it("无变化不落盘：没有 pier 注册条目的 config 保持字节原样", async () => {
    const original = JSON.stringify({ plugin: ["foo.js"] }, null, 2);
    await writeFile(configPath, original, "utf8");
    await uninstallOpencodeHooks(configPath, pluginPath);
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
});

describe("opencodeIntegration 契约", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it("capability 为 full, id 为 opencode", () => {
    expect(opencodeIntegration.capability).toBe("full");
    expect(opencodeIntegration.id).toBe("opencode");
  });

  it("detect：两个 config 路径都不存在 → false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-detect-"));
    process.env.HOME = dir;
    expect(opencodeIntegration.detect()).toBe(false);
  });

  it("detect：~/.config/opencode/opencode.json 存在 → true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-detect2-"));
    await mkdir(join(dir, ".config", "opencode"), { recursive: true });
    await writeFile(
      join(dir, ".config", "opencode", "opencode.json"),
      "{}",
      "utf8"
    );
    process.env.HOME = dir;
    expect(opencodeIntegration.detect()).toBe(true);
  });
});
