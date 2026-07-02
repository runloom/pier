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

const MARK = "PIER_AGENT_HOOK_PORT";

describe("buildAmpPluginSource", () => {
  const source = buildAmpPluginSource();

  it("含托管 marker", () => {
    expect(source).toContain(AMP_PLUGIN_MARKER_TEXT);
    expect(source).toContain("managed by Pier");
  });

  it("POST 目标为 /agent-event, 携带 Authorization Bearer 头", () => {
    expect(source).toContain("/agent-event");
    expect(source).toContain("Authorization");
    expect(source).toContain("Bearer");
  });

  it("env 守卫覆盖全部四个必需变量（PORT/TOKEN/PANEL_ID/WINDOW_ID）", () => {
    expect(source).toContain(`process.env.${MARK}`);
    expect(source).toContain("process.env.PIER_AGENT_HOOK_TOKEN");
    expect(source).toContain("process.env.PIER_PANEL_ID");
    expect(source).toContain("process.env.PIER_WINDOW_ID");
  });

  it("fire-and-forget：1.5s 超时 + 吞异常", () => {
    expect(source).toContain("1500");
    expect(source).toContain("catch");
    expect(source).toContain("AbortController");
  });

  it("body 五字段 schema：v/agent/event/panelId/windowId", () => {
    expect(source).toContain("v: 1");
    expect(source).toContain('agent: "amp"');
    expect(source).toContain("event: pierEvent");
    expect(source).toContain("panelId,");
    expect(source).toContain("windowId,");
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

  it("加载即 emit：函数体开头独立调用 emitPierEvent, 先于 amp.on 事件订阅", () => {
    const functionStart = source.indexOf("export default function (amp");
    const loadEmit = source.indexOf('void emitPierEvent("session.start");');
    const firstSubscription = source.indexOf(
      'amp.on("session.start"',
      functionStart
    );
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(loadEmit).toBeGreaterThan(functionStart);
    expect(loadEmit).toBeLessThan(firstSubscription);
    // 该调用独立于任何 amp.on(...) 回调闭包内, 是启动路径的顶层语句。
    const betweenFnAndSubscription = source.slice(
      functionStart,
      firstSubscription
    );
    expect(
      betweenFnAndSubscription.match(/emitPierEvent\("session\.start"\)/g)
    ).toHaveLength(1);
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
