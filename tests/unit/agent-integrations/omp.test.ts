import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOmpExtensionSource,
  installOmpExtension,
  OMP_EVENT_MAP,
  OMP_FA_ERROR_REACHABILITY,
  OMP_MARKER,
  OMP_SUBAGENT_EVENT_MAP,
  ompDetect,
  ompExtensionPath,
  ompHome,
  uninstallOmpExtension,
} from "../../../src/main/services/agents/integrations/omp.ts";

const NATIVE_EVENTS = [
  "session_start",
  "agent_start",
  "tool_call",
  "tool_result",
  "tool_approval_requested",
  "tool_approval_resolved",
  "agent_end",
  "session_shutdown",
];

describe("buildOmpExtensionSource", () => {
  it("含 marker、三个 PIER_ 环境变量守卫、无顶层 import 声明", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain(OMP_MARKER);
    // JSONL 通路的三个环境变量（HTTP 时代 PORT/TOKEN 已删）
    expect(src).toContain("PIER_AGENT_EVENT_LOG");
    expect(src).toContain("PIER_PANEL_ID");
    expect(src).toContain("PIER_WINDOW_ID");
    expect(src).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(src).not.toContain("PIER_AGENT_HOOK_TOKEN");
    // 无顶层 ImportDeclaration（electron-vite 模板字面量扫描陷阱豁免）；
    // await import() 是 CallExpression, 允许在函数体内。
    for (const line of src.split("\n")) {
      expect(line.trimStart().startsWith("import ")).toBe(false);
    }
    // 运行时 process.getBuiltinModule 同步 append：非 ImportDeclaration,
    // 保 JSONL 文件序（同毫秒事件在未 await 的异步 append 下乱序）,
    // 且宿主退出前最后的 session_shutdown 必落盘。
    expect(src).toContain('process.getBuiltinModule("node:fs")');
    expect(src).toContain("appendFileSync");
    expect(src).not.toContain('await import("node:fs/promises")');
    expect(src).not.toContain('require("node:fs/promises")');
    // HTTP 通路已删
    expect(src).not.toContain("fetch(");
    expect(src).not.toContain("/agent-event");
  });

  it("事件表齐全：主表 8 项、子代理表 2 项, 逐事件单次订阅且无 turn_*", () => {
    const src = buildOmpExtensionSource();
    // 主会话映射：回合真边界是 agent_start/agent_end；turn_* 是每轮 LLM
    // round 边界, 映射 Stop 会在多轮工具循环中途谎报「等待输入」——不再订阅。
    expect(OMP_EVENT_MAP).toHaveLength(8);
    expect(
      Object.fromEntries(OMP_EVENT_MAP.map((e) => [e.nativeEvent, e.pierEvent]))
    ).toEqual({
      session_start: "SessionStart",
      agent_start: "PromptSubmit",
      tool_call: "ToolStart",
      tool_result: "ToolComplete",
      tool_approval_requested: "PermissionRequest",
      tool_approval_resolved: "ToolStart",
      agent_end: "Stop",
      session_shutdown: "SessionEnd",
    });
    // 子代理映射：task subagent 实例只上报计数事件, 不打穿主状态。
    expect(OMP_SUBAGENT_EVENT_MAP).toHaveLength(2);
    expect(
      Object.fromEntries(
        OMP_SUBAGENT_EVENT_MAP.map((e) => [e.nativeEvent, e.pierEvent])
      )
    ).toEqual({
      agent_start: "SubagentStart",
      agent_end: "SubagentStop",
    });
    // 生成源码：8 个原生事件各恰好一次订阅（主/子映射合一, 单次 pi.on）。
    for (const evt of NATIVE_EVENTS) {
      expect(
        src.match(new RegExp(`pi\\.on\\("${evt}"`, "g")),
        evt
      ).toHaveLength(1);
    }
    expect(src).not.toContain('pi.on("turn_start"');
    expect(src).not.toContain('pi.on("turn_end"');
  });

  it("Ev5: FA error unsupported — mapping table has no error pierEvent", () => {
    expect(OMP_FA_ERROR_REACHABILITY).toBe("unsupported");
    expect(OMP_EVENT_MAP.some((e) => e.pierEvent === "error")).toBe(false);
    expect(OMP_SUBAGENT_EVENT_MAP.some((e) => e.pierEvent === "error")).toBe(
      false
    );
    // abort/ESC still agent_end→Stop; must not fake-green as error.
    expect(
      OMP_EVENT_MAP.find((e) => e.nativeEvent === "agent_end")?.pierEvent
    ).toBe("Stop");
  });

  it("agent 字段为 omp", () => {
    const src = buildOmpExtensionSource();
    expect(src).toContain('agent: "omp"');
  });

  it("角色分派取代加载即上报：无字面量 pierEmit 调用, 经实例计数 + hasUI 判定", () => {
    const src = buildOmpExtensionSource();
    // 不再「加载即 pierEmit(\"SessionStart\")」——SessionStart 只作为
    // pierDispatch 的参数出现, 由 session_start 事件触发。
    expect(src).not.toContain('pierEmit("');
    // 角色判定要素：模块级实例计数、统一分派函数、hasUI 主会话判定。
    expect(src).toContain("pierInstanceCount");
    expect(src).toContain("pierDispatch");
    expect(src).toContain("hasUI === true");
    // 同步 append 已取代 promise 串行链。
    expect(src).not.toContain("pierEmitChain");
  });
});

describe("生成源码行为（临时文件动态加载 + 假 pi 触发）", () => {
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

  interface OmpEventCtx {
    hasUI: boolean;
    sessionManager?: {
      getLastUserMessage?: () => string;
      getMessages?: () => Array<{ role?: string; content?: string }>;
      getSessionFile?: () => string | undefined;
      getSessionId?: () => string;
    };
  }
  type OmpHandler = (event: unknown, ctx: OmpEventCtx) => void;
  type OmpExtensionFactory = (pi: {
    on: (name: string, handler: OmpHandler) => void;
  }) => void;

  /** 假 pi：on 收集 handlers, fire 模拟宿主派发；未订阅事件静默无操作。 */
  function createFakePi() {
    const handlers = new Map<string, OmpHandler[]>();
    return {
      pi: {
        on(name: string, handler: OmpHandler): void {
          const list = handlers.get(name);
          if (list) {
            list.push(handler);
          } else {
            handlers.set(name, [handler]);
          }
        },
      },
      fire(name: string, ctx: OmpEventCtx, event: unknown = {}): void {
        for (const handler of handlers.get(name) ?? []) {
          handler(event, ctx);
        }
      },
    };
  }

  /**
   * 求值生成源码, 一次求值 = 一个全新模块实例（pierInstanceCount 归零）,
   * 模拟一个新的 omp 宿主进程；三个 PIER_ 环境变量指向唯一临时 JSONL。
   *
   * 不写临时文件走 import()：vitest 模块运行器解析不了仓库根外的文件,
   * jsdom 池的 vm 上下文又未接通动态 import 回调, 原生 import() 同样不可用。
   * 生成源码同步化后不含任何 import, 把模块边界 export default 换成
   * module.exports 即可用 new Function 直接求值——被测逻辑一字未改。
   */
  async function loadFreshExtension(): Promise<{
    factory: OmpExtensionFactory;
    logPath: string;
  }> {
    const source = buildOmpExtensionSource();
    // 钉住替换点唯一：若未来注释/字符串里再出现同 token, replace 只改首处,
    // 漏改的第二处会让 new Function 语法错误且排查成本高——先显式失败。
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
    const moduleShim: { exports: OmpExtensionFactory | undefined } = {
      exports: undefined,
    };
    const evaluate = new Function("module", cjsSource) as (
      shim: typeof moduleShim
    ) => void;
    evaluate(moduleShim);
    if (typeof moduleShim.exports !== "function") {
      throw new Error("生成源码未导出扩展工厂函数");
    }
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-ext-"));
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

  function eventsOf(records: Record<string, unknown>[]): unknown[] {
    return records.map((record) => record.event);
  }

  it("主会话(hasUI=true)：事件同步落盘且顺序精确, turn_end 无输出", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = { hasUI: true };
    // turn_end 夹在序列中间：未订阅 → 不产生任何行（核心 bug 回归——
    // 旧版映射 Stop, 多轮工具循环中途会谎报「等待输入」）。
    for (const evt of [
      "session_start",
      "agent_start",
      "tool_call",
      "tool_result",
      "turn_end",
      "tool_approval_requested",
      "tool_approval_resolved",
      "agent_end",
    ]) {
      main.fire(evt, ctx);
    }
    const records = await readEmittedRecords(logPath);
    expect(eventsOf(records)).toEqual([
      "SessionStart",
      "PromptSubmit",
      "ToolStart",
      "ToolComplete",
      "PermissionRequest",
      "ToolStart",
      "Stop",
    ]);
    // JSONL 载荷契约（聚合器按这些字段消费）。
    expect(records[0]).toMatchObject({
      v: 2,
      kind: "agentEvent",
      panelId: "panel-1",
      windowId: "window-1",
      pid: process.pid,
      agent: "omp",
      event: "SessionStart",
      nativeEvent: "session_start",
    });
    expect(typeof records[0]?.ts).toBe("number");
  });

  it("从 ctx.sessionManager.getSessionId 写入 sessionId 供重启 resume", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const sessionId = "019f7021-45c3-7000-aa01-d23a7bd03bc0";
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: {
        getSessionFile: () =>
          `/Users/dev/.omp/agent/sessions/-ABC-pier/2026-07-17T12-50-56-579Z_${sessionId}.jsonl`,
        getSessionId: () => sessionId,
      },
    };
    // omp 宿主 session_start 载荷只有 type，sessionId 在 ctx.sessionManager。
    main.fire("session_start", ctx, { type: "session_start" });
    main.fire("agent_start", ctx, { type: "agent_start" });
    const records = await readEmittedRecords(logPath);
    expect(records).toEqual([
      expect.objectContaining({
        event: "SessionStart",
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
    const ctx: OmpEventCtx = { hasUI: true };
    main.fire("agent_start", ctx, {
      prompt: "帮我分析下当前未提交的修改",
      type: "agent_start",
    });
    const records = await readEmittedRecords(logPath);
    expect(records).toEqual([
      expect.objectContaining({
        event: "PromptSubmit",
        promptSnippet: "帮我分析下当前未提交的修改",
      }),
    ]);
  });

  it("PromptSubmit 可从 sessionManager.getLastUserMessage 取文案", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = {
      hasUI: true,
      sessionManager: {
        getLastUserMessage: () => "fix the flaky test",
        getSessionId: () => "sess-1",
      },
    };
    main.fire("agent_start", ctx, { type: "agent_start" });
    const records = await readEmittedRecords(logPath);
    expect(records[0]).toMatchObject({
      event: "PromptSubmit",
      promptSnippet: "fix the flaky test",
      sessionId: "sess-1",
    });
  });

  it("task subagent(非首实例且 hasUI=false)：交错序列中只追加 Subagent 计数事件", async () => {
    const { factory, logPath } = await loadFreshExtension();
    // 同进程两次工厂调用 = 主会话 + task subagent（实测同 pid）。
    const main = createFakePi();
    const sub = createFakePi();
    factory(main.pi);
    factory(sub.pi);
    const mainCtx: OmpEventCtx = { hasUI: true };
    const subCtx: OmpEventCtx = { hasUI: false };
    // 真实 probe 交错序列（2026-07-05, M 主会话 / S 子实例）。
    main.fire("session_start", mainCtx); // SessionStart
    main.fire("agent_start", mainCtx); // PromptSubmit
    main.fire("tool_call", mainCtx); // ToolStart (task)
    main.fire("tool_result", mainCtx); // ToolComplete
    sub.fire("session_start", subCtx); // 子表无此项 → 无输出, 角色在此锁定 sub
    sub.fire("agent_start", subCtx); // SubagentStart
    main.fire("tool_call", mainCtx); // ToolStart (job)
    sub.fire("tool_call", subCtx); // 无输出
    sub.fire("tool_result", subCtx); // 无输出
    sub.fire("agent_end", subCtx); // SubagentStop
    main.fire("tool_result", mainCtx); // ToolComplete
    main.fire("agent_end", mainCtx); // Stop
    sub.fire("session_shutdown", subCtx); // 无输出——不拆主会话层
    main.fire("session_shutdown", mainCtx); // SessionEnd
    const records = await readEmittedRecords(logPath);
    expect(eventsOf(records)).toEqual([
      "SessionStart",
      "PromptSubmit",
      "ToolStart",
      "ToolComplete",
      "SubagentStart",
      "ToolStart",
      "SubagentStop",
      "ToolComplete",
      "Stop",
      "SessionEnd",
    ]);
    expect(
      records.filter((record) =>
        ["SubagentStart", "SubagentStop"].includes(String(record.event))
      )
    ).toEqual([
      expect.objectContaining({ actorHint: "subagent" }),
      expect.objectContaining({ actorHint: "subagent" }),
    ]);
  });

  it("headless 主会话兜底：首实例即使 hasUI=false 也按主表上报", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    // omp -p 主会话无 UI, 靠「进程内首实例必是主会话」兜底。
    const ctx: OmpEventCtx = { hasUI: false };
    main.fire("session_start", ctx);
    main.fire("agent_start", ctx);
    main.fire("agent_end", ctx);
    expect(eventsOf(await readEmittedRecords(logPath))).toEqual([
      "SessionStart",
      "PromptSubmit",
      "Stop",
    ]);
  });

  it("PIER_ 环境变量缺失时静默 no-op；恢复后按 emit 调用时读取生效", async () => {
    const { factory, logPath } = await loadFreshExtension();
    const main = createFakePi();
    factory(main.pi);
    const ctx: OmpEventCtx = { hasUI: true };
    delete process.env.PIER_PANEL_ID;
    // 守卫拦截且写入是同步路径 → fire 返回后即可断言文件不存在。
    main.fire("session_start", ctx);
    await expect(readFile(logPath, "utf8")).rejects.toThrow();
    // 恢复后生效, 且被拦截的 SessionStart 不会补写（若守卫失效, 它会先于
    // PromptSubmit 出现在文件里）。
    process.env.PIER_PANEL_ID = "panel-1";
    main.fire("agent_start", ctx);
    expect(eventsOf(await readEmittedRecords(logPath))).toEqual([
      "PromptSubmit",
    ]);
  });
});

describe("ompHome", () => {
  const ORIG = process.env.OMP_HOME;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.OMP_HOME;
    } else {
      process.env.OMP_HOME = ORIG;
    }
  });

  it("默认 ~/.omp/agent", () => {
    delete process.env.OMP_HOME;
    expect(ompHome()).toContain(join(".omp", "agent"));
  });

  it("OMP_HOME 设置时使用该路径", () => {
    process.env.OMP_HOME = "/custom/omp-home";
    expect(ompHome()).toBe("/custom/omp-home");
  });
});

describe("ompExtensionPath", () => {
  it("落在 <home>/extensions/pier-agent-status.ts", () => {
    expect(ompExtensionPath()).toContain(
      join("extensions", "pier-agent-status.ts")
    );
  });
});

describe("ompDetect", () => {
  it("返回布尔值", () => {
    expect(typeof ompDetect()).toBe("boolean");
  });

  it("home 目录存在时为真", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-omp-detect-"));
    const orig = process.env.OMP_HOME;
    process.env.OMP_HOME = dir;
    vi.resetModules();
    const mod = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(mod.ompDetect()).toBe(true);
    if (orig === undefined) {
      delete process.env.OMP_HOME;
    } else {
      process.env.OMP_HOME = orig;
    }
    vi.resetModules();
  });
});

describe("install/uninstallOmpExtension (文件 IO)", () => {
  let dir: string;
  let extPath: string;

  afterEach(() => {
    delete process.env.OMP_HOME;
    vi.resetModules();
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "pier-omp-io-test-"));
    process.env.OMP_HOME = dir;
    extPath = join(dir, "extensions", "pier-agent-status.ts");
  }

  it("detect 为真时安装写入 marker 全文件, 卸载删除该文件", async () => {
    await setup();
    await installOmpExtension(extPath);
    const installed = await readFile(extPath, "utf8");
    expect(installed).toContain(OMP_MARKER);
    await uninstallOmpExtension(extPath);
    await expect(readFile(extPath, "utf8")).rejects.toThrow();
  });

  it("重复安装第二次不改变文件内容（幂等）", async () => {
    await setup();
    await installOmpExtension(extPath);
    const afterFirst = await readFile(extPath, "utf8");
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(afterFirst);
  });

  it("非托管文件（无 marker）不覆盖, 跳过并 warn", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign =
      "// not managed by pier\nexport default function Foo() {}\n";
    await writeFile(extPath, foreign, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uninstall 对非托管文件不删除", async () => {
    await setup();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "extensions"), { recursive: true });
    const foreign = "// not managed by pier\n";
    await writeFile(extPath, foreign, "utf8");
    await uninstallOmpExtension(extPath);
    expect(await readFile(extPath, "utf8")).toBe(foreign);
  });

  it("uninstall 对不存在的文件零副作用（不抛异常）", async () => {
    await setup();
    await expect(uninstallOmpExtension(extPath)).resolves.toBeUndefined();
  });

  it("detect 为假时（无 home 目录、无 omp 命令）install 不写入任何文件", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pier-omp-nodetect-"));
    delete process.env.OMP_HOME;
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = emptyDir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/omp.ts"
      );
      const missingPath = join(
        emptyDir,
        ".omp",
        "agent",
        "extensions",
        "pier-agent-status.ts"
      );
      expect(mod.ompDetect()).toBe(false);
      await mod.installOmpExtension(missingPath);
      await expect(readFile(missingPath, "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      vi.resetModules();
    }
  });
});

describe("ompIntegration 契约", () => {
  it("capability 为 full, id 为 omp", async () => {
    const { ompIntegration } = await import(
      "../../../src/main/services/agents/integrations/omp.ts"
    );
    expect(ompIntegration.capability).toBe("full");
    expect(ompIntegration.id).toBe("omp");
  });
});
