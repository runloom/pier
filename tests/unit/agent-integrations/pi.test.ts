import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPiExtensionSource,
  installPiExtension,
  PI_EVENT_MAP,
  PI_MARKER,
  piDetect,
  piExtensionPath,
  piHome,
  uninstallPiExtension,
} from "../../../src/main/services/agents/integrations/pi.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";

const NATIVE_EVENTS = [
  "session_start",
  "before_agent_start",
  "tool_execution_start",
  "tool_execution_end",
  "agent_settled",
  "session_shutdown",
];

describe("buildPiExtensionSource", () => {
  it("含 marker、三个 PIER_ 环境变量守卫、无顶层 import 声明", () => {
    const src = buildPiExtensionSource();
    expect(src).toContain(PI_MARKER);
    expect(src).toContain("PIER_AGENT_EVENT_LOG");
    expect(src).toContain("PIER_PANEL_ID");
    expect(src).toContain("PIER_WINDOW_ID");
    expect(src).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(src).not.toContain("PIER_AGENT_HOOK_TOKEN");
    // 无顶层 ImportDeclaration；pierAppend 用 process.getBuiltinModule（运行时调用）。
    for (const line of src.split("\n")) {
      expect(line.trimStart().startsWith("import ")).toBe(false);
    }
    // 同步优先：process.getBuiltinModule + appendFileSync
    expect(src).toContain("process.getBuiltinModule");
    expect(src).toContain("appendFileSync");
    // 异步退化分支保留（旧 Node 宿主）
    expect(src).toContain('import("node:fs/promises")');
    expect(src).toContain("appendFile");
    // HTTP 通路已删
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("/agent-event");
  });

  it("按固定提交中的公开事件注册，只有 agent_settled 结束回合", () => {
    const src = buildPiExtensionSource();
    expect(PI_EVENT_MAP).toEqual([
      { nativeEvent: "session_start", pierEvent: "SessionStart" },
      { nativeEvent: "before_agent_start", pierEvent: "PromptSubmit" },
      { nativeEvent: "tool_execution_start", pierEvent: "ToolStart" },
      {
        nativeEvent: "tool_execution_start.ask",
        pierEvent: "InteractionRequested",
      },
      { nativeEvent: "tool_execution_end", pierEvent: "ToolComplete" },
      {
        nativeEvent: "tool_execution_end.ask",
        pierEvent: "InteractionResolved",
      },
      { nativeEvent: "agent_settled", pierEvent: "Stop" },
      { nativeEvent: "session_shutdown", pierEvent: "SessionEnd" },
    ]);
    for (const evt of NATIVE_EVENTS) {
      expect(src).toContain(`pi.on("${evt}"`);
    }
    expect(src).not.toContain('pi.on("agent_end"');
    expect(src).not.toContain('pi.on("agent_start"');
    expect(src).not.toContain("PermissionRequest");
  });

  it("agent 字段为 pi", () => {
    const src = buildPiExtensionSource();
    expect(src).toContain('agent: "pi"');
  });

  it("不合成 SessionStart，只消费真实 session_start", () => {
    const src = buildPiExtensionSource();
    const functionStart = src.indexOf(
      "export default function PierAgentStatus(pi)"
    );
    const firstSubscription = src.indexOf(
      'pi.on("session_start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    const between = src.slice(functionStart, firstSubscription);
    expect(between).not.toContain("pierEmit(");
    expect(between).not.toContain("pi.on(");
  });
});

describe("生成源码行为（动态加载 + 假 pi 触发）", () => {
  const ORIG = {
    log: process.env.PIER_AGENT_EVENT_LOG,
    panelId: process.env.PIER_PANEL_ID,
    windowId: process.env.PIER_WINDOW_ID,
  };

  afterEach(() => {
    restoreEnv("PIER_AGENT_EVENT_LOG", ORIG.log);
    restoreEnv("PIER_PANEL_ID", ORIG.panelId);
    restoreEnv("PIER_WINDOW_ID", ORIG.windowId);
  });

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  interface PiEventCtx {
    sessionManager?: {
      getLastUserMessage?: () => string;
      getSessionFile?: () => string | undefined;
      getSessionId?: () => string;
    };
  }
  type PiHandler = (event: unknown, ctx: PiEventCtx) => void;
  type PiExtensionFactory = (pi: {
    on: (name: string, handler: PiHandler) => void;
  }) => void;

  function createFakePi() {
    const handlers = new Map<string, PiHandler[]>();
    return {
      pi: {
        on(name: string, handler: PiHandler): void {
          const list = handlers.get(name);
          if (list) {
            list.push(handler);
          } else {
            handlers.set(name, [handler]);
          }
        },
      },
      fire(name: string, ctx: PiEventCtx, event: unknown = {}): void {
        for (const handler of handlers.get(name) ?? []) {
          handler(event, ctx);
        }
      },
    };
  }

  async function loadFreshExtension(): Promise<{
    factory: PiExtensionFactory;
    logPath: string;
  }> {
    const source = buildPiExtensionSource();
    const exportTokenCount =
      source.match(/export default function/g)?.length ?? 0;
    if (exportTokenCount !== 1) {
      throw new Error(
        `生成源码应恰含一处 export default function, 实际 ${exportTokenCount} 处`
      );
    }
    const cjsSource = source.replace(
      "export default function",
      "module.exports = function"
    );
    const moduleShim: { exports: PiExtensionFactory | undefined } = {
      exports: undefined,
    };
    const evaluate = new Function("module", cjsSource) as (
      shim: typeof moduleShim
    ) => void;
    evaluate(moduleShim);
    if (typeof moduleShim.exports !== "function") {
      throw new Error("生成源码未导出扩展工厂函数");
    }
    const dir = await mkdtemp(join(tmpdir(), "pier-pi-ext-"));
    const logPath = join(dir, "events.jsonl");
    process.env.PIER_AGENT_EVENT_LOG = logPath;
    process.env.PIER_PANEL_ID = "panel-1";
    process.env.PIER_WINDOW_ID = "window-1";
    return { factory: moduleShim.exports, logPath };
  }

  async function readEmittedRecords(
    logPath: string
  ): Promise<Record<string, unknown>[]> {
    const raw = await readFile(logPath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("从 ctx.sessionManager.getSessionId 写入 sessionId 供重启 resume", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const sessionId = "019f7021-45c3-7000-aa01-d23a7bd03bc0";
    const ctx: PiEventCtx = {
      sessionManager: {
        getSessionFile: () =>
          `/tmp/sessions/2026-07-17T12-50-56-579Z_${sessionId}.jsonl`,
        getSessionId: () => sessionId,
      },
    };
    main.fire("session_start", ctx, { type: "session_start" });
    main.fire("before_agent_start", ctx, {
      prompt: "Fix the flaky test",
      type: "before_agent_start",
    });
    const records = await readEmittedRecords(logPath);
    expect(records).toEqual([
      expect.objectContaining({
        event: "SessionStart",
        nativeEvent: "session_start",
        sessionId,
      }),
      expect.objectContaining({
        event: "PromptSubmit",
        sessionId,
      }),
    ]);
  });

  it("PromptSubmit 从 event.prompt 写入 promptSnippet", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    main.fire(
      "before_agent_start",
      {},
      {
        prompt: "帮我分析下当前未提交的修改",
        type: "before_agent_start",
      }
    );
    const records = await readEmittedRecords(logPath);
    const submit = records.find((r) => r.event === "PromptSubmit");
    expect(submit).toMatchObject({
      promptSnippet: "帮我分析下当前未提交的修改",
    });
  });

  it("真实工具载荷保留 toolCallId，局部失败只结束对应工具", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: PiEventCtx = {
      sessionManager: { getSessionId: () => "session-pi" },
    };
    main.fire("tool_execution_start", ctx, {
      args: { command: "false" },
      toolCallId: "call-7",
      toolName: "bash",
      type: "tool_execution_start",
    });
    main.fire("tool_execution_end", ctx, {
      isError: true,
      result: { content: "exit 1" },
      toolCallId: "call-7",
      toolName: "bash",
      type: "tool_execution_end",
    });
    main.fire("agent_settled", ctx, { type: "agent_settled" });
    const records = await readEmittedRecords(logPath);
    expect(records).toMatchObject([
      {
        event: "ToolStart",
        nativeEvent: "tool_execution_start",
        sessionId: "session-pi",
        toolName: "bash",
        toolUseId: "call-7",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "tool_execution_end",
        nativeState: "error",
        sessionId: "session-pi",
        toolName: "bash",
        toolUseId: "call-7",
        v: 3,
      },
      {
        event: "Stop",
        nativeEvent: "agent_settled",
        sessionId: "session-pi",
        v: 3,
      },
    ]);
    expect(records.some((record) => record.event === "error")).toBe(false);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const record of records) {
      const parsed = agentHookEventSchema.parse(record);
      if (parsed.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(parsed, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual(["tool", "processing", "ready"]);
  });

  it("ask 问卷走 InteractionRequested，不标成 ToolStart", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: PiEventCtx = {
      sessionManager: { getSessionId: () => "session-pi" },
    };
    main.fire("tool_execution_start", ctx, {
      toolCallId: "call-ask-1",
      toolName: "ask",
      type: "tool_execution_start",
    });
    main.fire("tool_execution_end", ctx, {
      toolCallId: "call-ask-1",
      toolName: "ask",
      type: "tool_execution_end",
    });
    const records = await readEmittedRecords(logPath);
    expect(records).toMatchObject([
      {
        event: "InteractionRequested",
        interactionId: "call-ask-1",
        interactionKind: "question",
        nativeEvent: "tool_execution_start.ask",
        toolName: "ask",
        toolUseId: "call-ask-1",
      },
      {
        event: "InteractionResolved",
        interactionId: "call-ask-1",
        interactionKind: "question",
        interactionOutcome: "completed",
        nativeEvent: "tool_execution_end.ask",
        toolName: "ask",
        toolUseId: "call-ask-1",
      },
    ]);
  });
});

describe("piHome", () => {
  const ORIG = process.env.PI_CODING_AGENT_DIR;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = ORIG;
    }
  });

  it("默认 ~/.pi/agent", () => {
    delete process.env.PI_CODING_AGENT_DIR;
    expect(piHome()).toContain(join(".pi", "agent"));
  });

  it("PI_CODING_AGENT_DIR 设置时使用该路径", () => {
    process.env.PI_CODING_AGENT_DIR = "/custom/pi-home";
    expect(piHome()).toBe("/custom/pi-home");
  });
});

describe("piExtensionPath", () => {
  it("落在 <home>/extensions/pier-agent-status.ts", () => {
    expect(piExtensionPath()).toContain(
      join("extensions", "pier-agent-status.ts")
    );
  });
});

describe("piDetect", () => {
  it("返回布尔值", () => {
    expect(typeof piDetect()).toBe("boolean");
  });

  it("home 目录存在时为真", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-pi-detect-"));
    const orig = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    vi.resetModules();
    const mod = await import(
      "../../../src/main/services/agents/integrations/pi.ts"
    );
    expect(mod.piDetect()).toBe(true);
    if (orig === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = orig;
    }
    vi.resetModules();
  });
});

describe("install/uninstallPiExtension (文件 IO)", () => {
  let dir: string;
  let extPath: string;

  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    vi.resetModules();
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "pier-pi-io-test-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    extPath = join(dir, "extensions", "pier-agent-status.ts");
  }

  it("detect 为真时安装写入 marker 全文件, 卸载删除该文件", async () => {
    await setup();
    await installPiExtension(extPath);
    const installed = await readFile(extPath, "utf8");
    expect(installed).toContain(PI_MARKER);
    await uninstallPiExtension(extPath);
    await expect(readFile(extPath, "utf8")).rejects.toThrow();
  });

  it("重复安装第二次不改变文件内容（幂等）", async () => {
    await setup();
    await installPiExtension(extPath);
    const afterFirst = await readFile(extPath, "utf8");
    await installPiExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(afterFirst);
  });

  it("非托管文件（无 marker）不覆盖, 跳过并 warn", async () => {
    await setup();
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign =
      "// not managed by pier\nexport default function Foo() {}\n";
    await writeFile(extPath, foreign, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installPiExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uninstall 对非托管文件不删除", async () => {
    await setup();
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign = "// not managed by pier\n";
    await writeFile(extPath, foreign, "utf8");
    await uninstallPiExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
  });

  it("uninstall 对不存在的文件零副作用（不抛异常）", async () => {
    await setup();
    await expect(uninstallPiExtension(extPath)).resolves.toBeUndefined();
  });

  it("detect 为假时（无 home 目录、无 pi 命令）install 不写入任何文件", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pier-pi-nodetect-"));
    delete process.env.PI_CODING_AGENT_DIR;
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = emptyDir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/pi.ts"
      );
      const missingPath = join(
        emptyDir,
        ".pi",
        "agent",
        "extensions",
        "pier-agent-status.ts"
      );
      expect(mod.piDetect()).toBe(false);
      await mod.installPiExtension(missingPath);
      await expect(readFile(missingPath, "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      vi.resetModules();
    }
  });
});

describe("piIntegration 契约", () => {
  it("id 为 pi", async () => {
    const { piIntegration } = await import(
      "../../../src/main/services/agents/integrations/pi.ts"
    );
    expect(piIntegration.id).toBe("pi");
  });
});
