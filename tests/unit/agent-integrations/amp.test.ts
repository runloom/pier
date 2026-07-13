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

  it("JSONL 行字段：v/kind/agent/event/panelId/windowId/pid/ts", () => {
    expect(source).toContain("v: 2");
    expect(source).toContain('kind: "agentEvent"');
    expect(source).toContain('agent: "amp"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("nativeEvent,");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
    expect(source).toContain("pid: process.pid");
    expect(source).toContain("ts: Date.now() * 1_000_000");
  });

  it("事件映射齐全：session.start/agent.start/tool.call/tool.result/agent.end", () => {
    expect(source).toContain('amp.on("session.start"');
    expect(source).toContain('amp.on("agent.start"');
    expect(source).toContain('amp.on("tool.call"');
    expect(source).toContain('amp.on("tool.result"');
    expect(source).toContain('amp.on("agent.end"');
    expect(source).toContain('"session.start": "SessionStart"');
    expect(source).toContain('"agent.start": "PromptSubmit"');
    expect(source).toContain('"tool.call": "ToolStart"');
    expect(source).toContain('"tool.result": "ToolComplete"');
    expect(source).toContain('"agent.end": "Stop"');
  });

  it("tool.call 拦截返回 allow（不拦截真实工具调用）", () => {
    expect(source).toContain('return { action: "allow" }');
  });

  it("无加载合成 SessionStart：session.start 只在真实事件订阅回调内 emit", () => {
    const functionStart = source.indexOf("export default function (amp");
    const firstSubscription = source.indexOf(
      'amp.on("session.start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(firstSubscription).toBeGreaterThan(functionStart);
    // 工厂体到首个订阅之间不得有独立 emitPierEvent 调用（合成版在工厂按
    // 会话/子代理多次执行的宿主上会打穿主状态, omp task subagent 教训）。
    const betweenFnAndSubscription = source.slice(
      functionStart,
      firstSubscription
    );
    expect(betweenFnAndSubscription).not.toContain("emitPierEvent(");
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

  it("capability 为 full, id 为 amp", () => {
    expect(ampIntegration.capability).toBe("full");
    expect(ampIntegration.id).toBe("amp");
  });
});
