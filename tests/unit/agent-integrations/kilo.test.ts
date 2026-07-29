import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentHookEventSchema } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";

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
    expect(source).toContain("v: 3");
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
    expect(source).toContain('event.type === "permission.asked"');
    expect(source).toContain('event.type === "permission.replied"');
    expect(source).toContain('event.type === "question.asked"');
    expect(source).toContain('state === "offline"');
    expect(source).not.toContain("permission.updated");
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain(
      'pierEmit("ToolStart", "tool.execute.before", input'
    );
    expect(source).toContain(
      'pierEmit("ToolComplete", "tool.execute.after", input'
    );
    expect(source).toContain("value.info || value.session || value.thread");
    expect(source).toContain("toolUseId");
  });

  it("通过真实 chat.message hook 读取用户 prompt", async () => {
    const { buildKiloPluginSource } = await loadIntegration();
    const source = buildKiloPluginSource();
    expect(source).toContain("PromptSubmit");
    expect(source).toContain('"chat.message"');
    expect(source).not.toContain("message.updated");
  });

  it("permission/question 并发与 fork 私有 offline 都按 requestID 闭合", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-offline-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const { buildKiloPluginSource } = await loadIntegration();
    const module = {
      exports: undefined as undefined | { server: () => Promise<any> },
    };
    const source = buildKiloPluginSource().replace(
      "export default",
      "module.exports ="
    );
    new Function("module", source)(module);
    const plugin = await module.exports?.server();
    await plugin.event({
      event: {
        type: "session.created",
        properties: { info: { id: "main" } },
      },
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
          blocking: true,
          questions: [{ question: "继续吗？" }],
        },
      },
      {
        type: "permission.replied",
        properties: {
          requestID: "perm-1",
          reply: "always",
          sessionID: "main",
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
      await plugin.event({ event });
    }
    await plugin.event({
      event: {
        type: "session.status",
        properties: {
          sessionID: "main",
          status: {
            type: "offline",
            requestID: "network-1",
            message: "offline",
          },
        },
      },
    });
    await plugin.event({
      event: {
        type: "session.status",
        properties: { sessionID: "main", status: { type: "retry" } },
      },
    });
    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows.map((row) => row.kind === "agentEvent" && row.event)).toEqual([
      "SessionStart",
      "InteractionRequested",
      "InteractionRequested",
      "InteractionResolved",
      "InteractionResolved",
      "InteractionRequested",
      "InteractionResolved",
      "running",
    ]);
    expect(rows[5]).toMatchObject({
      interactionId: "network-1",
      interactionKind: "external-block",
      v: 3,
    });
    expect(
      rows
        .slice(1, 5)
        .map((row) =>
          row.kind === "agentEvent" && "interactionId" in row
            ? row.interactionId
            : undefined
        )
    ).toEqual(["perm-1", "question-1", "perm-1", "question-1"]);
    const aggregator = createForegroundActivityAggregator();
    for (const row of rows) {
      if (row.kind === "agentEvent") {
        aggregator.ingestAgentEvent(row, { stopAuthority: "authoritative" });
      }
    }
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      sessionId: "main",
      status: "processing",
    });
  });

  it("只跟踪 blocking question，非阻塞 reply 不得解除其他等待", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-blocking-question-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const { buildKiloPluginSource } = await loadIntegration();
    const module = {
      exports: undefined as undefined | { server: () => Promise<any> },
    };
    new Function(
      "module",
      buildKiloPluginSource().replace("export default", "module.exports =")
    )(module);
    const plugin = await module.exports?.server();
    for (const event of [
      {
        type: "permission.asked",
        properties: { id: "permission-1", sessionID: "main" },
      },
      {
        type: "question.asked",
        properties: {
          blocking: false,
          id: "question-nonblocking",
          questions: [{ question: "仅供参考" }],
          sessionID: "main",
        },
      },
      {
        type: "question.asked",
        properties: {
          id: "question-blocking",
          questions: [{ question: "需要回答" }],
          sessionID: "main",
        },
      },
      {
        type: "question.replied",
        properties: {
          answers: [["参考"]],
          requestID: "question-nonblocking",
          sessionID: "main",
        },
      },
      {
        type: "question.replied",
        properties: {
          answers: [["继续"]],
          requestID: "question-blocking",
          sessionID: "main",
        },
      },
      {
        type: "permission.replied",
        properties: {
          reply: "once",
          requestID: "permission-1",
          sessionID: "main",
        },
      },
    ]) {
      await plugin.event({ event });
    }
    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(
      rows.map((row) =>
        row.kind === "agentEvent" && "interactionId" in row
          ? [row.event, row.interactionId]
          : []
      )
    ).toEqual([
      ["InteractionRequested", "permission-1"],
      ["InteractionRequested", "question-blocking"],
      ["InteractionResolved", "question-blocking"],
      ["InteractionResolved", "permission-1"],
    ]);
  });

  it("session.network.restored 立即解除 offline，后续 replied 不重复", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-restored-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const { buildKiloPluginSource } = await loadIntegration();
    const module = {
      exports: undefined as undefined | { server: () => Promise<any> },
    };
    new Function(
      "module",
      buildKiloPluginSource().replace("export default", "module.exports =")
    )(module);
    const plugin = await module.exports?.server();
    for (const event of [
      {
        type: "session.status",
        properties: {
          sessionID: "main",
          status: {
            message: "offline",
            requestID: "network-restored",
            type: "offline",
          },
        },
      },
      {
        type: "session.network.restored",
        properties: {
          requestID: "network-restored",
          sessionID: "main",
          time: Date.now(),
        },
      },
      {
        type: "session.network.replied",
        properties: {
          requestID: "network-restored",
          sessionID: "main",
        },
      },
    ]) {
      await plugin.event({ event });
    }
    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(
      rows.map((row) =>
        row.kind === "agentEvent" && row.v === 3
          ? [
              row.event,
              row.nativeEvent,
              "interactionId" in row ? row.interactionId : undefined,
            ]
          : []
      )
    ).toEqual([
      ["InteractionRequested", "session.status=offline", "network-restored"],
      ["InteractionResolved", "session.network.restored", "network-restored"],
    ]);
    const aggregator = createForegroundActivityAggregator();
    for (const row of rows) {
      if (row.kind === "agentEvent") {
        aggregator.ingestAgentEvent(row, { stopAuthority: "authoritative" });
      }
    }
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "processing",
    });
  });

  it("session.deleted 清理未回复 blocking question 与 offline request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-session-cleanup-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const { buildKiloPluginSource } = await loadIntegration();
    const module = {
      exports: undefined as undefined | { server: () => Promise<any> },
    };
    new Function(
      "module",
      buildKiloPluginSource().replace("export default", "module.exports =")
    )(module);
    const plugin = await module.exports?.server();
    for (const event of [
      {
        type: "question.asked",
        properties: {
          id: "question-leaked",
          questions: [{ question: "待回复" }],
          sessionID: "deleted-session",
        },
      },
      {
        type: "session.status",
        properties: {
          sessionID: "deleted-session",
          status: {
            message: "offline",
            requestID: "network-leaked",
            type: "offline",
          },
        },
      },
      {
        type: "session.deleted",
        properties: { info: { id: "deleted-session" } },
      },
      {
        type: "question.replied",
        properties: {
          answers: [["迟到"]],
          requestID: "question-leaked",
          sessionID: "deleted-session",
        },
      },
      {
        type: "session.network.replied",
        properties: {
          requestID: "network-leaked",
          sessionID: "deleted-session",
        },
      },
    ]) {
      await plugin.event({ event });
    }
    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(
      rows.filter(
        (row) =>
          row.kind === "agentEvent" && row.event === "InteractionResolved"
      )
    ).toHaveLength(0);
  });

  it("child session 的 idle/error/deleted 均闭合聚合器计数", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilo-child-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const { buildKiloPluginSource, kiloIntegration } = await loadIntegration();
    const module = {
      exports: undefined as undefined | { server: () => Promise<any> },
    };
    new Function(
      "module",
      buildKiloPluginSource().replace("export default", "module.exports =")
    )(module);
    const plugin = await module.exports?.server();
    await plugin.event({
      event: {
        type: "session.created",
        properties: { info: { id: "main" } },
      },
    });
    for (const terminal of ["idle", "error", "deleted"] as const) {
      const child = `child-${terminal}`;
      await plugin.event({
        event: {
          type: "session.created",
          properties: { info: { id: child, parentID: "main" } },
        },
      });
      await plugin.event({
        event: {
          type: "session.status",
          properties: { sessionID: child, status: { type: "busy" } },
        },
      });
      let properties: Record<string, unknown> = {
        sessionID: child,
        error: { name: "boom" },
      };
      if (terminal === "idle") {
        properties = { sessionID: child, status: { type: "idle" } };
      } else if (terminal === "deleted") {
        properties = { info: { id: child } };
      }
      await plugin.event({
        event: {
          type: terminal === "idle" ? "session.status" : `session.${terminal}`,
          properties,
        },
      });
    }
    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    const aggregator = createForegroundActivityAggregator();
    const counts: number[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        stopAuthority: kiloIntegration.runtime.stopAuthority,
      });
      const activity = aggregator.snapshot().activities[0];
      counts.push(activity?.kind === "agent" ? activity.subagentCount : -1);
    }
    expect(counts).toEqual([-1, 1, 0, 1, 0, 1, 0]);
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      sessionId: "main",
      subagentCount: 0,
    });
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

  it("XDG_CONFIG_HOME 指定默认配置根与实际安装路径", async () => {
    const xdgConfigHome = join(homeDir, "xdg-config");
    vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);
    const {
      kiloIntegration,
      kiloPluginPath,
      KILO_PLUGIN_FILE_NAME,
      KILO_PLUGIN_MARKER_TEXT,
    } = await loadIntegration();
    const expected = join(
      xdgConfigHome,
      "kilo",
      "plugin",
      KILO_PLUGIN_FILE_NAME
    );

    expect(kiloPluginPath()).toBe(expected);
    await kiloIntegration.install();
    expect(await readFile(expected, "utf8")).toContain(KILO_PLUGIN_MARKER_TEXT);
  });

  it("绝对 KILO_CONFIG_DIR 优先于 XDG_CONFIG_HOME 并决定实际安装路径", async () => {
    const customConfigDir = join(homeDir, "custom-kilo");
    vi.stubEnv("XDG_CONFIG_HOME", join(homeDir, "xdg-config"));
    vi.stubEnv("KILO_CONFIG_DIR", customConfigDir);
    const {
      kiloIntegration,
      kiloPluginPath,
      KILO_PLUGIN_FILE_NAME,
      KILO_PLUGIN_MARKER_TEXT,
    } = await loadIntegration();
    const expected = join(customConfigDir, "plugin", KILO_PLUGIN_FILE_NAME);

    expect(kiloPluginPath()).toBe(expected);
    await kiloIntegration.install();
    expect(await readFile(expected, "utf8")).toContain(KILO_PLUGIN_MARKER_TEXT);
  });

  it("相对 KILO_CONFIG_DIR 不作为写入根，回退到 XDG_CONFIG_HOME", async () => {
    const xdgConfigHome = join(homeDir, "xdg-config");
    vi.stubEnv("XDG_CONFIG_HOME", xdgConfigHome);
    vi.stubEnv("KILO_CONFIG_DIR", "relative-kilo-config");
    const { kiloPluginPath, KILO_PLUGIN_FILE_NAME } = await loadIntegration();

    expect(kiloPluginPath()).toBe(
      join(xdgConfigHome, "kilo", "plugin", KILO_PLUGIN_FILE_NAME)
    );
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
  it("id 为 kilo", async () => {
    const { kiloIntegration } = await loadIntegration();
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

  it("detect：~/.kilo 存在 → true", async () => {
    await mkdir(join(homeDir, ".kilo"), { recursive: true });
    vi.stubEnv("PATH", "");
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(true);
  });

  it("detect：KILO_CONFIG_DIR 指向已有自定义配置目录 → true", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "pier-kilo-config-"));
    vi.stubEnv("KILO_CONFIG_DIR", configDir);
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

  it("detect：兼容官方 kilocode 命令别名", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-kilocode-bin-"));
    await writeFile(join(dir, "kilocode"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const { kiloIntegration } = await loadIntegration();
    expect(kiloIntegration.detect()).toBe(true);
  });
});
