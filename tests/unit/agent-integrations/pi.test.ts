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

const NATIVE_EVENTS = [
  "session_start",
  "agent_start",
  "agent_end",
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

  it("事件表齐全：全部 4 个原生事件均注册且映射到正确 pier 事件（coarse 粒度）", () => {
    const src = buildPiExtensionSource();
    expect(PI_EVENT_MAP).toHaveLength(4);
    for (const evt of NATIVE_EVENTS) {
      expect(src).toContain(`pi.on("${evt}"`);
    }
    expect(src).toContain(
      'pierEmit("SessionStart", "pier.synthetic.session_start")'
    );
    expect(src).toContain(
      'pierEmit("PromptSubmit", "agent_start", event, ctx)'
    );
    expect(src).toContain('pierEmit("Stop", "agent_end", event, ctx)');
    expect(src).toContain(
      'pierEmit("SessionEnd", "session_shutdown", event, ctx)'
    );
    // agent_start 映射 PromptSubmit（与 omp 对齐, 非旧 processing）
    expect(
      PI_EVENT_MAP.find((e) => e.nativeEvent === "agent_start")?.pierEvent
    ).toBe("PromptSubmit");
    expect(
      PI_EVENT_MAP.find((e) => e.nativeEvent === "agent_end")?.pierEvent
    ).toBe("Stop");
    // 旧 input→PromptSubmit 已删——input 在 validation 前触发, 会卡态
    expect(PI_EVENT_MAP.find((e) => e.nativeEvent === "input")).toBeUndefined();
    // pi 无工具/权限粒度事件
    expect(src).not.toContain("ToolStart");
    expect(src).not.toContain("PermissionRequest");
  });

  it("agent 字段为 pi", () => {
    const src = buildPiExtensionSource();
    expect(src).toContain('agent: "pi"');
  });

  it("加载即 emit SessionStart：extension 函数体开头独立调用, 先于 pi.on 订阅", () => {
    const src = buildPiExtensionSource();
    const functionStart = src.indexOf(
      "export default function PierAgentStatus(pi)"
    );
    const loadEmit = src.indexOf(
      'pierEmit("SessionStart", "pier.synthetic.session_start");',
      functionStart
    );
    const firstSubscription = src.indexOf(
      'pi.on("session_start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(loadEmit).toBeGreaterThan(functionStart);
    expect(loadEmit).toBeLessThan(firstSubscription);
    // 独立语句, 不在任何 pi.on(...) 回调闭包内。
    const between = src.slice(functionStart, firstSubscription);
    expect(between.match(/pierEmit\("SessionStart"/g)).toHaveLength(1);
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
    main.fire("agent_start", ctx, { type: "agent_start" });
    const records = await readEmittedRecords(logPath);
    // load-time synthetic SessionStart has no ctx, so no sessionId; subsequent
    // real events must carry the manager-provided id.
    expect(records[0]).toMatchObject({
      event: "SessionStart",
      nativeEvent: "pier.synthetic.session_start",
    });
    expect(records[0]).not.toHaveProperty("sessionId");
    expect(records.slice(1)).toEqual([
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
  it("capability 为 coarse, id 为 pi", async () => {
    const { piIntegration } = await import(
      "../../../src/main/services/agents/integrations/pi.ts"
    );
    expect(piIntegration.capability).toBe("coarse");
    expect(piIntegration.id).toBe("pi");
  });
});
