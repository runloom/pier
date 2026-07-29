import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AMP_PLUGIN_MARKER_TEXT,
  ampDetect,
  ampIntegration,
  ampPluginPath,
  buildAmpPluginSource,
  installAmpHooks,
  uninstallAmpHooks,
} from "../../../src/main/services/agents/integrations/amp.ts";
import { runAmpPluginScenario } from "./amp-test-runtime.ts";

const MARK = "PIER_AGENT_EVENT_LOG";

describe("buildAmpPluginSource", () => {
  const source = buildAmpPluginSource();

  it("含托管 marker", () => {
    expect(source).toContain(AMP_PLUGIN_MARKER_TEXT);
    expect(source).toContain("managed by Pier");
  });

  it("同步优先写 JSONL（pierAppend: getBuiltinModule + appendFileSync, 异步退化）", () => {
    // 同步优先分支
    expect(source).toContain("process.getBuiltinModule");
    expect(source).toContain("appendFileSync");
    // 异步退化分支保留（旧 Node 宿主）
    expect(source).toContain('import("node:fs/promises")');
    expect(source).toContain("appendFile");
    // 无顶层 import 声明（pierAppend 用运行时调用, 不触发 vite 扫描）
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
    // HTTP-era 变量已删
    expect(source).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(source).not.toContain("PIER_AGENT_HOOK_TOKEN");
  });

  it("最佳 effort：try/catch 吞异常, 不干扰 amp 本体", () => {
    expect(source).toContain("catch");
    // AbortController / 1500ms 超时属于 HTTP 时代, 已删
    expect(source).not.toContain("AbortController");
    expect(source).not.toContain("1500");
  });

  it("JSONL 行字段使用严格 v3，并保留会话、回合与原生状态", () => {
    expect(source).toContain("v: 3");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "amp"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("nativeEvent,");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
    expect(source).toContain("pid: process.pid");
    expect(source).toContain("ts: Date.now() * 1_000_000");
    expect(source).toContain("turnId");
    expect(source).toContain("nativeState");
  });

  it("只监听不要求观察者返回决策的生命周期事件，并订阅正式 ThreadState", () => {
    expect(source).toContain('amp.on("session.start"');
    expect(source).toContain('amp.on("agent.start"');
    expect(source).toContain('amp.on("agent.end"');
    expect(source).not.toContain('amp.on("tool.call"');
    expect(source).not.toContain('amp.on("tool.result"');
    expect(source).toContain("thread.state.subscribe");
    expect(source).toContain('"session.start": "SessionStart"');
    expect(source).toContain('"agent.start": "PromptSubmit"');
    expect(source).toContain(
      '"thread.state.awaiting-approval": "InteractionRequested"'
    );
    expect(source).toContain('"agent.end.done": "TurnCompleted"');
    expect(source).toContain('"agent.end.error": "error"');
    expect(source).toContain('"agent.end.cancelled": "TurnInterrupted"');
    expect(source).toContain("pierPromptSnippetFrom");
    expect(source).toContain("promptSnippet");
  });

  it("无加载合成 SessionStart：session.start 只在真实事件订阅回调内 emit", () => {
    const functionStart = source.indexOf("export default function (amp");
    const firstSubscription = source.indexOf(
      'amp.on("session.start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(firstSubscription).toBeGreaterThan(functionStart);
    // session.start 的发射只能出现在该原生事件回调之后。
    expect(
      source.indexOf('emitPierEvent("session.start"', functionStart)
    ).toBeGreaterThan(firstSubscription);
  });

  it("官方 Amp 事件与 ThreadState 经过生成插件形成严格 v3 状态闭环", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        let stateObserver: ((state: string) => void) | undefined;
        const thread = {
          id: "thread-1",
          state: {
            subscribe(observer: (state: string) => void) {
              stateObserver = observer;
              return { unsubscribe() {} };
            },
          },
        };
        const eventThread = { id: "thread-1" };
        const context = { thread };
        await handlers.get("session.start")?.({ thread: eventThread }, context);
        await handlers.get("agent.start")?.(
          {
            id: "message-1",
            message: "Fix the test",
            thread: eventThread,
          },
          context
        );
        stateObserver?.("running");
        stateObserver?.("awaiting-approval");
        stateObserver?.("running");
        stateObserver?.("awaiting-approval");
        stateObserver?.("idle");
        stateObserver?.("awaiting-approval");
        stateObserver?.("error");
        for (const status of ["done", "error", "cancelled"]) {
          await handlers.get("agent.end")?.(
            {
              id: "message-1",
              message: "Fix the test",
              messages: [],
              status,
              thread: eventThread,
            },
            context
          );
        }
        expect(handlers.has("tool.call")).toBe(false);
        expect(handlers.has("tool.result")).toBe(false);
      }
    );
    expect(rows).toHaveLength(14);
    expect(rows[1]).toMatchObject({
      event: "PromptSubmit",
      sessionId: "thread-1",
      turnId: "message-1",
      v: 3,
    });
    expect(rows[2]).toMatchObject({
      event: "running",
      nativeEvent: "thread.state.running",
      nativeState: "running",
      sessionId: "thread-1",
      v: 3,
    });
    expect(rows[3]).toMatchObject({
      event: "InteractionRequested",
      interactionKind: "external-block",
      nativeEvent: "thread.state.awaiting-approval",
      nativeState: "awaiting-approval",
      sessionId: "thread-1",
    });
    expect(rows[3]).not.toHaveProperty("interactionId");
    expect(rows[4]).toMatchObject({
      event: "InteractionResolved",
      interactionKind: "external-block",
      interactionOutcome: "completed",
      nativeEvent: "thread.state.running.resolved",
      nativeState: "running",
      sessionId: "thread-1",
    });
    expect(rows[4]).not.toHaveProperty("interactionId");
    expect(rows[5]).toMatchObject({
      event: "running",
      nativeEvent: "thread.state.running",
      nativeState: "running",
      sessionId: "thread-1",
    });
    expect(rows[6]).toMatchObject({
      event: "InteractionRequested",
      nativeEvent: "thread.state.awaiting-approval",
    });
    expect(rows[7]).toMatchObject({
      event: "InteractionResolved",
      interactionKind: "external-block",
      interactionOutcome: "completed",
      nativeEvent: "thread.state.idle",
      nativeState: "idle",
      sessionId: "thread-1",
    });
    expect(rows[7]).not.toHaveProperty("interactionId");
    expect(rows.slice(8, 11)).toMatchObject([
      {
        event: "InteractionRequested",
        nativeEvent: "thread.state.awaiting-approval",
      },
      {
        event: "InteractionResolved",
        interactionKind: "external-block",
        interactionOutcome: "failed",
        nativeEvent: "thread.state.error.resolved",
      },
      {
        event: "error",
        nativeEvent: "thread.state.error",
        nativeState: "error",
      },
    ]);
    expect(rows.slice(-3)).toMatchObject([
      {
        event: "TurnCompleted",
        nativeEvent: "agent.end.done",
        nativeState: "done",
      },
      {
        event: "error",
        nativeEvent: "agent.end.error",
        nativeState: "error",
      },
      {
        event: "TurnInterrupted",
        nativeEvent: "agent.end.cancelled",
        nativeState: "cancelled",
      },
    ]);
  });

  it("session.start 时同步当前 awaiting-approval 状态进入等待", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        const thread = {
          id: "thread-hydrated",
          state: {
            get: () => "awaiting-approval",
            subscribe() {
              return { unsubscribe() {} };
            },
          },
        };
        await handlers.get("session.start")?.(
          { thread: { id: thread.id } },
          { thread }
        );
      }
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: "InteractionRequested",
        interactionKind: "external-block",
        nativeEvent: "thread.state.awaiting-approval",
        sessionId: "thread-hydrated",
      })
    );
  });

  it("订阅先收到更新时丢弃稍后返回的旧 ThreadState 快照", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        let resolveSnapshot: (state: string) => void = () => {};
        const snapshot = new Promise<string>((resolve) => {
          resolveSnapshot = resolve;
        });
        let stateObserver: ((state: string) => void) | undefined;
        const thread = {
          id: "thread-race",
          state: {
            get: () => snapshot,
            subscribe(observer: (state: string) => void) {
              stateObserver = observer;
              return { unsubscribe() {} };
            },
          },
        };
        const pending = Promise.resolve(
          handlers.get("session.start")?.(
            { thread: { id: thread.id } },
            { thread }
          )
        );
        stateObserver?.("running");
        resolveSnapshot("awaiting-approval");
        await pending;
      }
    );
    expect(
      rows.filter((row) => row.nativeEvent?.startsWith("thread.state."))
    ).toMatchObject([
      {
        event: "running",
        nativeEvent: "thread.state.running",
        sessionId: "thread-race",
      },
    ]);
  });

  it("ThreadState.get 异常不阻断 session.start", async () => {
    const rows = await runAmpPluginScenario(
      buildAmpPluginSource(),
      async (handlers) => {
        const thread = {
          id: "thread-get-error",
          state: {
            get() {
              throw new Error("state unavailable");
            },
            subscribe() {
              return { unsubscribe() {} };
            },
          },
        };
        await expect(
          Promise.resolve(
            handlers.get("session.start")?.(
              { thread: { id: thread.id } },
              { thread }
            )
          )
        ).resolves.toBeUndefined();
      }
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        event: "SessionStart",
        nativeEvent: "session.start",
        sessionId: "thread-get-error",
      })
    );
  });
});

describe("ampPluginPath", () => {
  it("默认路径解析：~/.config/amp/plugins/pier-agent-status.ts", () => {
    const HOME = "/tmp/pier-amp-home";
    const orig = process.env.HOME;
    process.env.HOME = HOME;
    try {
      expect(ampPluginPath()).toBe(
        join(HOME, ".config", "amp", "plugins", "pier-agent-status.ts")
      );
    } finally {
      process.env.HOME = orig;
    }
  });
});

describe("install/uninstallAmpHooks (文件 IO)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-amp-test-"));
  });

  it("往不存在的插件路径安装, 内容含 marker", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await installAmpHooks(path);
    const content = await readFile(path, "utf8");
    expect(content).toContain(AMP_PLUGIN_MARKER_TEXT);
  });

  it("卸载后文件删除", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await installAmpHooks(path);
    await uninstallAmpHooks(path);
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("幂等：重复安装第二次不改变文件内容", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await installAmpHooks(path);
    const first = await readFile(path, "utf8");
    await installAmpHooks(path);
    const second = await readFile(path, "utf8");
    expect(second).toBe(first);
  });

  it("非托管同名文件不覆盖, 发出告警", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await mkdir(join(dir, "plugins"), { recursive: true });
    await writeFile(
      path,
      "// my custom plugin\nexport default function () {}\n",
      "utf8"
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await installAmpHooks(path);
    expect(await readFile(path, "utf8")).toBe(
      "// my custom plugin\nexport default function () {}\n"
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载非托管文件也不删除, 发出告警", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await mkdir(join(dir, "plugins"), { recursive: true });
    const original = "// someone else's plugin\n";
    await writeFile(path, original, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    await uninstallAmpHooks(path);
    expect(await readFile(path, "utf8")).toBe(original);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("卸载不存在的文件是零副作用 no-op", async () => {
    const path = join(dir, "plugins", "pier-agent-status.ts");
    await expect(uninstallAmpHooks(path)).resolves.toBeUndefined();
  });
});

describe("ampDetect / ampIntegration 契约", () => {
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  it("~/.config/amp 目录存在 → true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-amp-detect-"));
    await mkdir(join(dir, ".config", "amp"), { recursive: true });
    process.env.HOME = dir;
    process.env.PATH = "";
    expect(ampDetect()).toBe(true);
  });

  it("~/.config/amp 不存在且 amp 不在 PATH → false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-amp-detect-empty-"));
    process.env.HOME = dir;
    process.env.PATH = "";
    expect(ampDetect()).toBe(false);
  });

  it("amp 命令在 PATH 上 → true", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "pier-amp-detect-path-home-"));
    const binDir = await mkdtemp(join(tmpdir(), "pier-amp-detect-path-bin-"));
    await writeFile(join(binDir, "amp"), "#!/bin/sh\n", { mode: 0o755 });
    process.env.HOME = homeDir;
    process.env.PATH = binDir;
    expect(ampDetect()).toBe(true);
  });

  it("id 为 amp", () => {
    expect(ampIntegration.id).toBe("amp");
  });

  it("agent.end 按官方 status 分流，且没有虚构的权威 Stop", () => {
    expect(ampIntegration.runtime.stopAuthority).toBe("none");
    expect(ampIntegration.runtime.emittedMappings).toEqual(
      expect.arrayContaining([
        { nativeEvent: "agent.end.done", pierEvent: "TurnCompleted" },
        { nativeEvent: "agent.end.error", pierEvent: "error" },
        {
          nativeEvent: "agent.end.cancelled",
          pierEvent: "TurnInterrupted",
        },
      ])
    );
  });

  it("不宣称工具观察能力，等待能力来自 ThreadState", () => {
    expect(ampIntegration.runtime.emittedMappings).not.toContainEqual(
      expect.objectContaining({ pierEvent: "ToolStart" })
    );
    expect(ampIntegration.runtime.emittedMappings).toContainEqual({
      nativeEvent: "thread.state.awaiting-approval",
      pierEvent: "InteractionRequested",
    });
  });
});
