import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";

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

  it("JSONL 行字段使用严格 v3", () => {
    expect(source).toContain("v: 3");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "opencode"');
    expect(source).toContain("event,");
    expect(source).toContain("nativeEvent,");
    expect(source).toContain("nativeState");
    expect(source).toContain('actorHint: "subagent"');
    expect(source).toContain("parentSessionId");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
    expect(source).toContain("pid: process.pid");
    expect(source).toContain("ts: Date.now() * 1_000_000");
  });

  it("事件映射来自固定提交的 plugin 与 v2 event 形状", () => {
    expect(source).toContain('event.type === "session.created"');
    expect(source).toContain('event.type === "session.idle"');
    expect(source).toContain('event.type === "session.error"');
    expect(source).toContain('"chat.message"');
    expect(source).toContain('event.type === "permission.asked"');
    expect(source).toContain('event.type === "permission.replied"');
    expect(source).toContain('event.type === "question.asked"');
    expect(source).toContain('event.type === "question.replied"');
    expect(source).toContain('event.type === "question.rejected"');
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain('pierEmit("ToolStart", "tool.execute.before"');
    expect(source).toContain('pierEmit("ToolComplete", "tool.execute.after"');
    expect(source).toContain('event.type === "session.deleted"');
    expect(source).toContain("value.info || value.message");
    expect(source).toContain("toolUseId");
    expect(source).toContain("pierPromptSnippetFrom");
    expect(source).toContain("promptSnippet");
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
  it("chat.message 的真实 parts 载荷写入 promptSnippet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-prompt-"));
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
        "chat.message": (
          input: Record<string, unknown>,
          output: Record<string, unknown>
        ) => void;
        event: (args: { event: Record<string, unknown> }) => void;
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
      plugin["chat.message"](
        { messageID: "message-1", sessionID: "main" },
        {
          message: { id: "message-1", role: "user" },
          parts: [{ type: "text", text: "帮我分析下当前未提交的修改" }],
        }
      );
      const lines = (await readFile(logPath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        event: "PromptSubmit",
        sessionId: "main",
        turnId: "message-1",
        promptSnippet: "帮我分析下当前未提交的修改",
        v: 3,
      });
    } finally {
      if (previousEnv.log === undefined) {
        delete process.env.PIER_AGENT_EVENT_LOG;
      } else {
        process.env.PIER_AGENT_EVENT_LOG = previousEnv.log;
      }
      if (previousEnv.panel === undefined) {
        delete process.env.PIER_PANEL_ID;
      } else {
        process.env.PIER_PANEL_ID = previousEnv.panel;
      }
      if (previousEnv.window === undefined) {
        delete process.env.PIER_WINDOW_ID;
      } else {
        process.env.PIER_WINDOW_ID = previousEnv.window;
      }
    }
  });

  it("permission 与 question 并发时必须分别按 requestID 闭合", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-interactions-"));
    const logPath = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", logPath);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const moduleShim = {
      exports: undefined as
        | undefined
        | (() => {
            event: (args: { event: Record<string, unknown> }) => void;
            "tool.execute.before": (input: Record<string, unknown>) => void;
          }),
    };
    new Function(
      "module",
      buildOpencodePluginSource().replace(
        "export const PierAgentStatus =",
        "module.exports ="
      )
    )(moduleShim);
    const plugin = moduleShim.exports?.();
    if (!plugin) throw new Error("生成插件没有导出 factory");
    plugin.event({
      event: {
        type: "session.created",
        properties: { info: { id: "main" } },
      },
    });
    plugin["tool.execute.before"]({
      callID: "tool-1",
      sessionID: "main",
      tool: "bash",
    });
    for (const event of [
      {
        type: "permission.asked",
        properties: { id: "perm-1", sessionID: "main", permission: "read" },
      },
      {
        type: "question.asked",
        properties: {
          id: "question-1",
          sessionID: "main",
          questions: [{ question: "继续吗？" }],
        },
      },
      {
        type: "permission.replied",
        properties: {
          requestID: "perm-1",
          reply: "once",
          sessionID: "main",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "main",
          part: {
            callID: "tool-1",
            state: { error: "boom", status: "error" },
            tool: "bash",
            type: "tool",
          },
        },
      },
      {
        type: "question.replied",
        properties: {
          requestID: "question-1",
          answers: [["继续"]],
          sessionID: "main",
        },
      },
    ]) {
      plugin.event({ event });
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, { stopAuthority: "authoritative" });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual([
      "tool",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "processing",
    ]);
    expect(
      rows
        .slice(2)
        .map((row) =>
          row.kind === "agentEvent"
            ? [
                row.event,
                "interactionId" in row ? row.interactionId : undefined,
              ]
            : []
        )
    ).toEqual([
      ["InteractionRequested", "perm-1"],
      ["InteractionRequested", "question-1"],
      ["InteractionResolved", "perm-1"],
      ["ToolComplete", undefined],
      ["InteractionResolved", "question-1"],
    ]);
  });

  it("child idle/error/deleted 三条终态都准确归零且不覆盖主会话身份", async () => {
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
          properties: { info: { id: "parent" } },
          type: "session.created",
        },
      });
      plugin.event({
        event: {
          properties: { info: { id: "child-idle", parentID: "parent" } },
          type: "session.created",
        },
      });
      plugin.event({
        event: {
          properties: { sessionID: "child-idle", status: { type: "busy" } },
          type: "session.status",
        },
      });
      plugin.event({
        event: {
          properties: { sessionID: "child-idle", status: { type: "idle" } },
          type: "session.status",
        },
      });
      for (const terminal of ["error", "deleted"] as const) {
        const child = `child-${terminal}`;
        plugin.event({
          event: {
            properties: { info: { id: child, parentID: "parent" } },
            type: "session.created",
          },
        });
        plugin.event({
          event: {
            properties: { sessionID: child, status: { type: "busy" } },
            type: "session.status",
          },
        });
        plugin.event({
          event: {
            properties:
              terminal === "deleted"
                ? { info: { id: child } }
                : { sessionID: child, error: { name: "boom" } },
            type: `session.${terminal}`,
          },
        });
      }

      await vi.waitFor(async () => {
        expect(
          (await readFile(logPath, "utf8")).trim().split("\n")
        ).toHaveLength(7);
      });
      const events = (await readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
      const aggregator = createForegroundActivityAggregator();
      const counts: number[] = [];
      for (const event of events) {
        if (event.kind !== "agentEvent") continue;
        expect(event.v).toBe(3);
        aggregator.ingestAgentEvent(event, {
          stopAuthority: opencodeIntegration.runtime.stopAuthority,
        });
        const activity = aggregator.snapshot().activities[0];
        counts.push(activity?.kind === "agent" ? activity.subagentCount : -1);
      }
      expect(counts).toEqual([-1, 1, 0, 1, 0, 1, 0]);
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        kind: "agent",
        sessionId: "parent",
        subagentCount: 0,
      });
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
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  function isolateHome(dir: string): void {
    process.env.HOME = dir;
    // Prefer explicit XDG under the temp root so host CI XDG cannot win.
    process.env.XDG_CONFIG_HOME = join(dir, ".config");
  }

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  });

  it("没有配置文件时默认正式全局 JSONC 路径", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-cfgpath-"));
    isolateHome(dir);
    expect(opencodeConfigPath()).toBe(
      join(dir, ".config", "opencode", "opencode.jsonc")
    );
  });

  it("JSON 与 JSONC 同时存在时 JSONC 优先", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-cfgpath2-"));
    const configDir = join(dir, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), "{}", "utf8");
    await writeFile(
      join(configDir, "opencode.jsonc"),
      "{\n  // user\n}",
      "utf8"
    );
    isolateHome(dir);
    expect(opencodeConfigPath()).toBe(join(configDir, "opencode.jsonc"));
  });

  it("插件路径落在 config 根目录的自动发现 plugins/ 子目录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-plugpath-"));
    isolateHome(dir);
    expect(opencodePluginPath()).toBe(
      join(dir, ".config", "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME)
    );
  });

  it("用户主目录下的项目级 .opencode 不会改变全局插件路径", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-plugpath2-"));
    await mkdir(join(dir, ".opencode"), { recursive: true });
    await writeFile(join(dir, ".opencode", "opencode.json"), "{}", "utf8");
    isolateHome(dir);
    expect(opencodePluginPath()).toBe(
      join(dir, ".config", "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME)
    );
  });

  it("XDG_CONFIG_HOME 指定全局配置根与插件安装路径", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-xdg-"));
    const xdgConfigHome = join(dir, "xdg-config");
    process.env.HOME = dir;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    expect(opencodeConfigPath()).toBe(
      join(xdgConfigHome, "opencode", "opencode.jsonc")
    );
    expect(opencodePluginPath()).toBe(
      join(xdgConfigHome, "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME)
    );
    await opencodeIntegration.install();
    expect(await readFile(opencodePluginPath(), "utf8")).toContain(
      OPENCODE_PLUGIN_MARKER_TEXT
    );
  });
});

describe("withoutPierOpencodePlugin (legacy config 注册清理)", () => {
  it("移除旧版字符串注册条目（绝对路径含旧文件名）", () => {
    const legacyPath = `/home/u/.pier/plugins/${LEGACY_FILE}`;
    const config = {
      plugin: ["some-other-plugin.js", legacyPath],
    };
    expect(withoutPierOpencodePlugin(config, [legacyPath]).plugin).toEqual([
      "some-other-plugin.js",
    ]);
  });

  it("移除新文件名 pier-agent-status 的注册条目", () => {
    const managedPath = "/x/plugins/pier-agent-status.js";
    const config = { plugin: [managedPath] };
    expect(withoutPierOpencodePlugin(config, [managedPath]).plugin).toEqual([]);
  });

  it("数组形式条目 [path, opts] 也可识别移除", () => {
    const legacyPath = `/home/u/.pier/plugins/${LEGACY_FILE}`;
    const config = {
      plugin: [[legacyPath, {}], "keep.js"],
    };
    expect(withoutPierOpencodePlugin(config, [legacyPath]).plugin).toEqual([
      "keep.js",
    ]);
  });

  it("无托管条目时原样返回输入引用", () => {
    const config = { plugin: ["some-other-plugin.js"] };
    expect(withoutPierOpencodePlugin(config)).toBe(config);
  });

  it("不误删 loomdesk 的同名插件注册（按 Pier 路径识别, 不按裸文件名）", () => {
    const legacyPath = `/Users/u/.pier/plugins/${LEGACY_FILE}`;
    const config = {
      plugin: [`/Users/u/.loomdesk/plugins/${LEGACY_FILE}`, legacyPath],
    };
    expect(withoutPierOpencodePlugin(config, [legacyPath]).plugin).toEqual([
      `/Users/u/.loomdesk/plugins/${LEGACY_FILE}`,
    ]);
  });

  it("只清理显式 Pier 所有路径，保留同 basename 与名称相似的用户插件", () => {
    const managedPath = "/x/plugins/pier-agent-status.js";
    const config = {
      plugin: [
        "my-pier-agent-status-plugin.js",
        "/x/plugins/pier-agent-status-helper.js",
        ["file:///x/plugins/my-pier-agent-status.js", { user: true }],
        "/other/plugins/pier-agent-status.js",
        "file:///other/plugins/pier-agent-status.js",
        "file:///x/plugins/pier-agent-status.js",
        [managedPath, { managed: true }],
      ],
    };

    expect(withoutPierOpencodePlugin(config, [managedPath]).plugin).toEqual([
      "my-pier-agent-status-plugin.js",
      "/x/plugins/pier-agent-status-helper.js",
      ["file:///x/plugins/my-pier-agent-status.js", { user: true }],
      "/other/plugins/pier-agent-status.js",
      "file:///other/plugins/pier-agent-status.js",
    ]);
  });

  it("plugin 数组清空时保留空数组键", () => {
    const legacyPath = `/a/.pier/plugins/${LEGACY_FILE}`;
    const config = { plugin: [legacyPath] };
    expect(withoutPierOpencodePlugin(config, [legacyPath]).plugin).toEqual([]);
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

  it("安装 hooks：只部署插件，不写主题配置", async () => {
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

  it("安装：从 JSONC 清理旧 Pier 注册且保留用户注释与其它插件", async () => {
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    await writeFile(legacyPath, `// ${OPENCODE_PLUGIN_MARKER_TEXT}\n`, "utf8");
    const original = `{
  // keep this user comment
  "plugin": [
    ${JSON.stringify(legacyPath)},
    "keep.js",
  ],
}
`;
    await writeFile(configPath, original, "utf8");
    await installOpencodeHooks(configPath, pluginPath);
    const updated = await readFile(configPath, "utf8");
    expect(updated).toContain("// keep this user comment");
    expect(updated).toContain('"keep.js"');
    expect(updated).not.toContain(legacyPath);
  });

  it("安装：非托管的旧版 ~/.pier 文件不删除", async () => {
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    const unmanaged = "// someone else's file\n";
    await writeFile(legacyPath, unmanaged, "utf8");
    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(legacyPath, "utf8")).toBe(unmanaged);
  });

  it("当前与旧版同路径文件均非托管时，安装和卸载都保留文件及配置引用", async () => {
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    await mkdir(join(dir, "plugins"), { recursive: true });
    const unmanagedCurrent = "// user current plugin\n";
    const unmanagedLegacy = "// user legacy plugin\n";
    const originalConfig = JSON.stringify({
      plugin: [pluginPath, legacyPath, "keep.js"],
    });
    await writeFile(pluginPath, unmanagedCurrent, "utf8");
    await writeFile(legacyPath, unmanagedLegacy, "utf8");
    await writeFile(configPath, originalConfig, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });

    await installOpencodeHooks(configPath, pluginPath);
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
    await uninstallOpencodeHooks(configPath, pluginPath);
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
    expect(await readFile(pluginPath, "utf8")).toBe(unmanagedCurrent);
    expect(await readFile(legacyPath, "utf8")).toBe(unmanagedLegacy);
    warnSpy.mockRestore();
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
    const legacyPath = join(dir, ".pier", "plugins", LEGACY_FILE);
    await mkdir(join(dir, ".pier", "plugins"), { recursive: true });
    await writeFile(legacyPath, `// ${OPENCODE_PLUGIN_MARKER_TEXT}\n`, "utf8");
    await writeFile(
      configPath,
      JSON.stringify({ plugin: [legacyPath, "keep.js"] }, null, 2),
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
  const originalPath = process.env.PATH;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  });

  it("id 为 opencode", () => {
    expect(opencodeIntegration.id).toBe("opencode");
  });

  it("detect：正式配置目录和命令都不存在 → false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-detect-"));
    process.env.HOME = dir;
    process.env.XDG_CONFIG_HOME = join(dir, ".config");
    process.env.PATH = "";
    expect(opencodeIntegration.detect()).toBe(false);
  });

  it("detect：~/.config/opencode/opencode.jsonc 存在 → true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-opencode-detect2-"));
    await mkdir(join(dir, ".config", "opencode"), { recursive: true });
    await writeFile(
      join(dir, ".config", "opencode", "opencode.jsonc"),
      "{\n  // user config\n}",
      "utf8"
    );
    process.env.HOME = dir;
    process.env.XDG_CONFIG_HOME = join(dir, ".config");
    process.env.PATH = "";
    expect(opencodeIntegration.detect()).toBe(true);
  });

  it("detect：PATH 上只有 opencode 命令也为 true", async () => {
    const home = await mkdtemp(join(tmpdir(), "pier-opencode-home-"));
    const bin = await mkdtemp(join(tmpdir(), "pier-opencode-bin-"));
    await writeFile(join(bin, "opencode"), "#!/bin/sh\n", { mode: 0o755 });
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    process.env.PATH = bin;
    expect(opencodeIntegration.detect()).toBe(true);
  });
});
