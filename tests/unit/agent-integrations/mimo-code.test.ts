import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMimoCodePluginSource,
  installMimoCodeHooks,
  MIMO_CODE_PLUGIN_MARKER_TEXT,
  mimoCodeConfigDir,
  mimoCodeIntegration,
  mimoCodePluginPath,
  uninstallMimoCodeHooks,
} from "../../../src/main/services/agents/integrations/mimo-code.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";

const MARK = "PIER_AGENT_EVENT_LOG";

describe("buildMimoCodePluginSource", () => {
  const source = buildMimoCodePluginSource();

  it("含托管 marker", () => {
    expect(source).toContain(MIMO_CODE_PLUGIN_MARKER_TEXT);
    expect(source).toContain("managed by Pier");
  });

  it("按 MiMo 0.1.9 当前格式默认导出 { id, server }", () => {
    expect(source).toContain("export default { id:");
    expect(source).toContain("server: PierAgentStatus");
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
    expect(source).toContain("v: 3");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "mimo-code"');
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

  it("使用 MiMo 独有 session/actor hooks 与运行时总线真实事件", () => {
    expect(source).toContain('event.type === "session.created"');
    expect(source).toContain('"session.pre"');
    expect(source).toContain('"session.post"');
    expect(source).not.toContain('"actor.preStop"');
    expect(source).not.toContain('"actor.postStop"');
    expect(source).toContain('event.type === "permission.asked"');
    expect(source).toContain('event.type === "question.asked"');
    expect(source).not.toContain('event.type === "permission.updated"');
    expect(source).toContain("p.requestID");
    expect(source).toContain("p.reply");
    expect(source).not.toContain("p.permissionID");
    expect(source).not.toContain("p.response");
    expect(source).not.toContain("tui.command.execute");
    expect(source).toContain('"tool.execute.before"');
    expect(source).toContain('"tool.execute.after"');
    expect(source).toContain(
      'emitPierEvent("ToolStart", "tool.execute.before", input'
    );
    expect(source).toContain(
      'emitPierEvent("ToolComplete", "tool.execute.after", input'
    );
    expect(source).toContain('event.type === "session.deleted"');
    expect(source).toContain("value.info || value.session || value.thread");
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

describe("MiMo Code 固定提交真实载荷", () => {
  it("session.post 三结果、并发交互与 tool error 输出严格 v3，preStop 不产生生命周期", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-mimo-runtime-"));
    const log = join(dir, "events.jsonl");
    vi.stubEnv("PIER_AGENT_EVENT_LOG", log);
    vi.stubEnv("PIER_PANEL_ID", "panel-1");
    vi.stubEnv("PIER_WINDOW_ID", "1");
    const module = {
      exports: undefined as undefined | (() => Record<string, any>),
    };
    new Function(
      "module",
      buildMimoCodePluginSource()
        .replace("export const PierAgentStatus =", "module.exports =")
        .replace(
          'export default { id: "pier-agent-status", server: PierAgentStatus };',
          ""
        )
    )(module);
    const plugin = module.exports?.();
    if (!plugin) throw new Error("生成插件没有导出 factory");
    plugin.event({
      event: {
        type: "session.created",
        properties: { info: { id: "main" } },
      },
    });
    plugin["session.pre"]({ agentID: "main", sessionID: "main" });
    plugin["tool.execute.before"]({
      callID: "tool-1",
      sessionID: "main",
      tool: "bash",
    });
    const permission = (id: string) => ({
      type: "permission.asked",
      properties: {
        always: ["*"],
        id,
        metadata: {},
        patterns: ["*"],
        permission: "bash",
        sessionID: "main",
        tool: {
          callID: `call-${id}`,
          messageID: `message-${id}`,
        },
      },
    });
    for (const event of [
      permission("perm-once"),
      permission("perm-always"),
      permission("perm-reject"),
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
          reply: "once",
          requestID: "perm-once",
          sessionID: "main",
        },
      },
      {
        type: "permission.replied",
        properties: {
          reply: "always",
          requestID: "perm-always",
          sessionID: "main",
        },
      },
      {
        type: "permission.replied",
        properties: {
          reply: "reject",
          requestID: "perm-reject",
          sessionID: "main",
        },
      },
      {
        type: "message.part.updated",
        properties: {
          sessionID: "main",
          part: {
            type: "tool",
            callID: "tool-1",
            tool: "bash",
            state: { status: "error", error: "boom" },
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
    const actor = {
      actorID: "actor-1",
      agentType: "explore",
      iteration: 1,
      lifecycle: "ephemeral",
      mode: "subagent",
      parentActorID: "main-actor",
      parentSessionID: "main",
      sessionID: "child-session",
      task: "inspect",
    };
    expect(plugin["actor.preStop"]).toBeUndefined();
    plugin["actor.preStop"]?.run(actor);
    for (const outcome of ["completed", "cancelled", "error"] as const) {
      plugin["session.pre"]({ agentID: "main", sessionID: "main" });
      plugin["session.post"]({
        agentID: "main",
        outcome,
        sessionID: "main",
        trajectory: [],
      });
    }
    plugin["session.post"]({
      agentID: "explore",
      outcome: "completed",
      sessionID: "child-session",
      trajectory: [],
    });

    const rows = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows.every((row) => row.kind !== "agentEvent" || row.v === 3)).toBe(
      true
    );
    const actorRows = rows.filter(
      (row) =>
        row.kind === "agentEvent" &&
        (row.event === "SubagentStart" || row.event === "SubagentStop")
    );
    expect(actorRows).toHaveLength(0);
    expect(
      rows
        .filter(
          (row) =>
            row.kind === "agentEvent" &&
            "nativeEvent" in row &&
            row.nativeEvent.startsWith("session.post")
        )
        .map((row) => row.kind === "agentEvent" && row.event)
    ).toEqual(["TurnCompleted", "TurnInterrupted", "error"]);
    expect(
      rows.some(
        (row) =>
          row.kind === "agentEvent" &&
          "nativeEvent" in row &&
          row.nativeEvent === "message.part.updated=error" &&
          row.event === "ToolComplete"
      )
    ).toBe(true);
    const permissionRows = rows.filter(
      (row) =>
        row.kind === "agentEvent" &&
        "interactionKind" in row &&
        row.interactionKind === "permission"
    );
    expect(
      permissionRows.map((row) =>
        row.kind === "agentEvent" && "interactionId" in row
          ? [
              row.event,
              row.interactionId,
              "interactionOutcome" in row ? row.interactionOutcome : undefined,
            ]
          : []
      )
    ).toEqual([
      ["InteractionRequested", "perm-once", undefined],
      ["InteractionRequested", "perm-always", undefined],
      ["InteractionRequested", "perm-reject", undefined],
      ["InteractionResolved", "perm-once", "accepted"],
      ["InteractionResolved", "perm-always", "accepted"],
      ["InteractionResolved", "perm-reject", "rejected"],
    ]);
    const permissionAggregator = createForegroundActivityAggregator();
    const permissionStatuses: Array<string | undefined> = [];
    for (const row of permissionRows) {
      if (row.kind !== "agentEvent") continue;
      permissionAggregator.ingestAgentEvent(row, {
        stopAuthority: mimoCodeIntegration.runtime.stopAuthority,
      });
      const activity = permissionAggregator.snapshot().activities[0];
      permissionStatuses.push(
        activity?.kind === "agent" ? activity.status : undefined
      );
    }
    expect(permissionStatuses).toEqual([
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "processing",
    ]);
    const aggregator = createForegroundActivityAggregator();
    for (const row of rows) {
      if (row.kind === "agentEvent") {
        aggregator.ingestAgentEvent(row, {
          stopAuthority: mimoCodeIntegration.runtime.stopAuthority,
        });
      }
    }
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      sessionId: "main",
      status: "error",
      subagentCount: 0,
    });
  });
});

describe("mimoCodePluginPath", () => {
  const originalHome = process.env.HOME;
  const originalMimoHome = process.env.MIMOCODE_HOME;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalMimoHome === undefined) {
      delete process.env.MIMOCODE_HOME;
    } else {
      process.env.MIMOCODE_HOME = originalMimoHome;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
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

  it("绝对 MIMOCODE_HOME 决定解析与实际安装路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-mimocode-home-"));
    process.env.MIMOCODE_HOME = root;
    const expected = join(
      root,
      "config",
      "plugins",
      "mimo-code-agent-status.js"
    );
    expect(mimoCodePluginPath()).toBe(expected);
    await installMimoCodeHooks();
    expect(await readFile(expected, "utf8")).toContain(
      MIMO_CODE_PLUGIN_MARKER_TEXT
    );
  });

  it("XDG_CONFIG_HOME 决定默认解析与实际安装路径", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-mimocode-xdg-"));
    const xdgConfigHome = join(root, "xdg-config");
    delete process.env.MIMOCODE_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    const expected = join(
      xdgConfigHome,
      "mimocode",
      "plugins",
      "mimo-code-agent-status.js"
    );

    expect(mimoCodeConfigDir()).toBe(join(xdgConfigHome, "mimocode"));
    expect(mimoCodePluginPath()).toBe(expected);
    await installMimoCodeHooks();
    expect(await readFile(expected, "utf8")).toContain(
      MIMO_CODE_PLUGIN_MARKER_TEXT
    );
  });

  it("相对 MIMOCODE_HOME 被拒绝，绝不基于 cwd 解析安装路径", async () => {
    process.env.MIMOCODE_HOME = "relative-mimocode-home";

    expect(() => mimoCodeConfigDir()).toThrow(/absolute/i);
    await expect(installMimoCodeHooks()).rejects.toThrow(/absolute/i);
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

  it("id 为 mimo-code", () => {
    expect(mimoCodeIntegration.id).toBe("mimo-code");
  });

  it("runtime 只声明固定提交总线实际投递的 permission.asked/replied", () => {
    expect(mimoCodeIntegration.runtime.emittedMappings).toContainEqual({
      nativeEvent: "permission.asked",
      pierEvent: "InteractionRequested",
    });
    expect(mimoCodeIntegration.runtime.emittedMappings).toContainEqual({
      nativeEvent: "permission.replied",
      pierEvent: "InteractionResolved",
    });
    expect(mimoCodeIntegration.runtime.emittedMappings).not.toContainEqual(
      expect.objectContaining({ nativeEvent: "permission.updated" })
    );
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

  it("detect：官方 mimo 命令在 PATH 上 → true", async () => {
    const homeDir = await mkdtemp(
      join(tmpdir(), "pier-mimocode-detect-path-home-")
    );
    const binDir = await mkdtemp(
      join(tmpdir(), "pier-mimocode-detect-path-bin-")
    );
    await writeFile(join(binDir, "mimo"), "#!/bin/sh\n", {
      mode: 0o755,
    });
    delete process.env.MIMOCODE_HOME;
    process.env.HOME = homeDir;
    process.env.PATH = binDir;
    expect(mimoCodeIntegration.detect()).toBe(true);
  });
});
