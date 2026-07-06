import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildHermesPluginInit,
  buildHermesPluginManifest,
  HERMES_EVENT_MAP,
  HERMES_MARKER,
  HERMES_PLUGIN_NAME,
  hermesConfigPath,
  hermesDetect,
  hermesHome,
  hermesInitPath,
  hermesIntegration,
  hermesManifestPath,
  hermesPluginDir,
  installHermesPlugin,
  uninstallHermesPlugin,
  withHermesPluginEnabled,
  withoutHermesPluginEnabled,
} from "../../../src/main/services/agents/integrations/hermes.ts";

const EXCEPT_PASS_RE = /except[^\n]*:\s*(?:\n\s*#[^\n]*)*\s*\n\s*pass/;

const NATIVE_EVENTS = [
  "on_session_start",
  "pre_llm_call",
  "pre_tool_call",
  "post_tool_call",
  "pre_approval_request",
  "post_approval_response",
  "on_session_end",
  "on_session_finalize",
  "on_session_reset",
];

describe("buildHermesPluginManifest", () => {
  it("含 marker、插件名, 事件表齐全（provides_hooks 列全部原生事件）", () => {
    const manifest = buildHermesPluginManifest();
    expect(manifest).toContain(HERMES_MARKER);
    expect(manifest).toContain(`name: ${HERMES_PLUGIN_NAME}`);
    expect(HERMES_EVENT_MAP).toHaveLength(NATIVE_EVENTS.length);
    for (const evt of NATIVE_EVENTS) {
      expect(manifest).toContain(`  - ${evt}`);
    }
  });
});

describe("buildHermesPluginInit", () => {
  it("含 marker + open(..., 'a') append + os.environ 三变量守卫", () => {
    const init = buildHermesPluginInit();
    expect(init).toContain(HERMES_MARKER);
    // 直写 JSONL 通路——HTTP urllib 时代已删
    expect(init).toContain('open(log, "a"');
    expect(init).not.toContain("import urllib");
    expect(init).not.toContain("urllib.request");
    expect(init).not.toContain("timeout=1.5");
    // JSONL 通路三个环境变量
    expect(init).toContain('os.environ.get("PIER_AGENT_EVENT_LOG"');
    expect(init).toContain('os.environ.get("PIER_PANEL_ID"');
    expect(init).toContain('os.environ.get("PIER_WINDOW_ID"');
    // HTTP 时代变量已删
    expect(init).not.toContain("PIER_AGENT_HOOK_PORT");
    expect(init).not.toContain("PIER_AGENT_HOOK_TOKEN");
  });

  it("except 只捕 OSError（不宽泛 Exception, 保 hermes 内部 bug 可见）", () => {
    const init = buildHermesPluginInit();
    expect(init).toMatch(EXCEPT_PASS_RE);
    expect(init).toContain("except OSError:");
    expect(init).not.toContain("except Exception:");
  });

  it("Python 语法关键结构：register(ctx) 遍历 EVENTS 并注册 hook", () => {
    const init = buildHermesPluginInit();
    expect(init).toContain("def register(ctx: Any) -> None:");
    expect(init).toContain(
      "ctx.register_hook(event_name, _make_hook(event_name))"
    );
    expect(init).toContain("def _make_hook(event_name: str)");
    expect(init).toContain(
      "def _pier_emit(pier_event: str, payload: dict[str, Any]) -> None:"
    );
  });

  it("事件映射齐全：EVENT_MAP 覆盖全部原生事件, 值为正确 pier 事件名", () => {
    const init = buildHermesPluginInit();
    expect(init).toContain('"on_session_start": "SessionStart"');
    expect(init).toContain('"pre_llm_call": "processing"');
    expect(init).toContain('"pre_tool_call": "ToolStart"');
    expect(init).toContain('"post_tool_call": "ToolComplete"');
    expect(init).toContain('"pre_approval_request": "PermissionRequest"');
    expect(init).toContain('"post_approval_response": "ToolStart"');
    expect(init).toContain('"on_session_end": "SessionEnd"');
    expect(init).toContain('"on_session_finalize": "SessionEnd"');
    expect(init).toContain('"on_session_reset": "Stop"');
    // post_llm_call 不映射——每轮 LLM 调用都发, 映射 Stop 会谎报 ready
    expect(init).not.toContain("post_llm_call");
  });

  it("agent 字段为 hermes", () => {
    const init = buildHermesPluginInit();
    expect(init).toContain('"agent": "hermes"');
  });

  it("register(ctx) 无合成 SessionStart——真实 on_session_start 覆盖, 合成版在非会话上下文误发", () => {
    const init = buildHermesPluginInit();
    const registerStart = init.indexOf("def register(ctx: Any) -> None:");
    expect(registerStart).toBeGreaterThanOrEqual(0);
    // register 体内不应有独立的 _pier_emit 调用
    const body = init.slice(registerStart);
    expect(body).not.toContain('_pier_emit("SessionStart")');
  });
});

describe("hermesHome / hermesConfigPath / hermesPluginDir", () => {
  const ORIG = process.env.HERMES_HOME;
  afterEach(() => {
    if (ORIG === undefined) {
      delete process.env.HERMES_HOME;
    } else {
      process.env.HERMES_HOME = ORIG;
    }
  });

  it("默认 ~/.hermes", () => {
    delete process.env.HERMES_HOME;
    expect(hermesHome()).toContain(".hermes");
  });

  it("HERMES_HOME 设置时使用该路径", () => {
    process.env.HERMES_HOME = "/custom/hermes-home";
    expect(hermesHome()).toBe("/custom/hermes-home");
  });

  it("configPath 为 <home>/config.yaml, pluginDir 为 <home>/plugins/pier-status", () => {
    process.env.HERMES_HOME = "/custom/hermes-home";
    expect(hermesConfigPath()).toBe(join("/custom/hermes-home", "config.yaml"));
    expect(hermesPluginDir()).toBe(
      join("/custom/hermes-home", "plugins", "pier-status")
    );
    expect(hermesManifestPath()).toBe(
      join("/custom/hermes-home", "plugins", "pier-status", "plugin.yaml")
    );
    expect(hermesInitPath()).toBe(
      join("/custom/hermes-home", "plugins", "pier-status", "__init__.py")
    );
  });
});

describe("hermesDetect", () => {
  it("返回布尔值", () => {
    expect(typeof hermesDetect()).toBe("boolean");
  });

  it("home 目录存在时为真", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hermes-detect-"));
    const orig = process.env.HERMES_HOME;
    process.env.HERMES_HOME = dir;
    vi.resetModules();
    const mod = await import(
      "../../../src/main/services/agents/integrations/hermes.ts"
    );
    expect(mod.hermesDetect()).toBe(true);
    if (orig === undefined) {
      delete process.env.HERMES_HOME;
    } else {
      process.env.HERMES_HOME = orig;
    }
    vi.resetModules();
  });
});

describe("withHermesPluginEnabled (文本级 YAML 插入)", () => {
  it("空文件 → 生成完整 plugins.enabled 块", () => {
    const next = withHermesPluginEnabled("");
    expect(next).toBe("plugins:\n  enabled:\n    - pier-status\n");
  });

  it("无 plugins: 顶层键 → 追加整块", () => {
    const raw = "provider: anthropic\nmodel: foo\n";
    const next = withHermesPluginEnabled(raw);
    expect(next).toContain("provider: anthropic");
    expect(next).toContain("plugins:\n  enabled:\n    - pier-status");
  });

  it("有 plugins: 但无 enabled: 子键 → 追加 enabled 列表", () => {
    const raw = "plugins:\n  disabled:\n    - foo\n";
    const next = withHermesPluginEnabled(raw);
    expect(next).toContain("plugins:");
    expect(next).toContain("  enabled:\n    - pier-status");
    expect(next).toContain("  disabled:\n    - foo");
  });

  it("enabled: 已存在且为空列表 → 追加一项", () => {
    const raw = "plugins:\n  enabled:\n";
    const next = withHermesPluginEnabled(raw);
    expect(next).toContain("  enabled:\n    - pier-status");
  });

  it("enabled: 已有其他插件 → 追加不覆盖既有项", () => {
    const raw = "plugins:\n  enabled:\n    - other-plugin\n";
    const next = withHermesPluginEnabled(raw);
    expect(next).toContain("- other-plugin");
    expect(next).toContain("- pier-status");
  });

  it("幂等：已含 pier-status 时不重复插入", () => {
    const raw = "plugins:\n  enabled:\n    - pier-status\n";
    const next = withHermesPluginEnabled(raw);
    expect(next).toBe(raw);
    const matches = next?.match(/pier-status/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("enabled: 为内联数组等异常结构时返回 null（调用方 warn 跳过）", () => {
    const raw = "plugins:\n  enabled: [a, b]\n";
    expect(withHermesPluginEnabled(raw)).toBeNull();
  });

  it("enabled: 子行含非法形式（非 '  - x'）时返回 null", () => {
    const raw = "plugins:\n  enabled:\n    foo: bar\n";
    expect(withHermesPluginEnabled(raw)).toBeNull();
  });
});

describe("withoutHermesPluginEnabled", () => {
  it("移除后与原文件一致（还原, 有 plugins 块场景）", () => {
    const original = "plugins:\n  disabled:\n    - foo\n";
    const installed = withHermesPluginEnabled(original);
    expect(installed).not.toBeNull();
    const removed = withoutHermesPluginEnabled(installed as string);
    expect(removed).toBe(original);
  });

  it("无该条目时原样返回", () => {
    const raw = "plugins:\n  enabled:\n    - other\n";
    expect(withoutHermesPluginEnabled(raw)).toBe(raw);
  });

  it("空文件原样返回", () => {
    expect(withoutHermesPluginEnabled("")).toBe("");
  });
});

describe("install/uninstallHermesPlugin (文件 IO)", () => {
  let dir: string;
  let configPath: string;

  afterEach(() => {
    delete process.env.HERMES_HOME;
    vi.resetModules();
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), "pier-hermes-io-test-"));
    process.env.HERMES_HOME = dir;
    configPath = join(dir, "config.yaml");
  }

  it("detect 为真时安装写入插件文件 + config.yaml enabled 注册, 卸载还原", async () => {
    await setup();
    await installHermesPlugin(configPath);
    const manifest = await readFile(
      join(dir, "plugins", "pier-status", "plugin.yaml"),
      "utf8"
    );
    const init = await readFile(
      join(dir, "plugins", "pier-status", "__init__.py"),
      "utf8"
    );
    expect(manifest).toContain(HERMES_MARKER);
    expect(init).toContain(HERMES_MARKER);
    const config = await readFile(configPath, "utf8");
    expect(config).toContain("pier-status");

    await uninstallHermesPlugin(configPath);
    await expect(
      readFile(join(dir, "plugins", "pier-status", "plugin.yaml"), "utf8")
    ).rejects.toThrow();
    const configAfter = await readFile(configPath, "utf8");
    expect(configAfter).not.toContain("pier-status");
  });

  it("重复安装第二次不改变插件文件内容（幂等）", async () => {
    await setup();
    await installHermesPlugin(configPath);
    const manifestPath = join(dir, "plugins", "pier-status", "plugin.yaml");
    const afterFirst = await readFile(manifestPath, "utf8");
    await installHermesPlugin(configPath);
    expect(await readFile(manifestPath, "utf8")).toBe(afterFirst);
    const configAfterFirst = await readFile(configPath, "utf8");
    await installHermesPlugin(configPath);
    expect(await readFile(configPath, "utf8")).toBe(configAfterFirst);
  });

  it("未安装时卸载零写入（无 config.yaml, 无插件目录）", async () => {
    await setup();
    await expect(uninstallHermesPlugin(configPath)).resolves.toBeUndefined();
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("config.yaml plugins.enabled 结构异常时 install 跳过写入 config（但插件文件仍写, 此处遵循 goose 纪律：结构异常直接整体跳过）", async () => {
    await setup();
    const malformed = "plugins:\n  enabled: [a, b]\n";
    await writeFile(configPath, malformed, "utf8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // swallow
    });
    await installHermesPlugin(configPath);
    expect(await readFile(configPath, "utf8")).toBe(malformed);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uninstall 对非托管插件目录不删除（无 marker）", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.yaml"),
      "name: pier-status\n",
      "utf8"
    );
    await writeFile(join(pluginDir, "__init__.py"), "# not managed\n", "utf8");
    await uninstallHermesPlugin(configPath);
    expect(await readFile(join(pluginDir, "plugin.yaml"), "utf8")).toBe(
      "name: pier-status\n"
    );
  });

  it("detect 为假时（无 home 目录、无 hermes 命令）install 不写入任何文件", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "pier-hermes-nodetect-"));
    delete process.env.HERMES_HOME;
    const originalPath = process.env.PATH;
    const originalHome = process.env.HOME;
    process.env.PATH = emptyDir;
    process.env.HOME = emptyDir;
    try {
      vi.resetModules();
      const mod = await import(
        "../../../src/main/services/agents/integrations/hermes.ts"
      );
      const missingConfigPath = join(emptyDir, ".hermes", "config.yaml");
      expect(mod.hermesDetect()).toBe(false);
      await mod.installHermesPlugin(missingConfigPath);
      await expect(readFile(missingConfigPath, "utf8")).rejects.toThrow();
    } finally {
      process.env.PATH = originalPath;
      process.env.HOME = originalHome;
      vi.resetModules();
    }
  });
});

describe("hermesIntegration 契约", () => {
  it("capability 为 coarse, id 为 hermes", () => {
    expect(hermesIntegration.capability).toBe("coarse");
    expect(hermesIntegration.id).toBe("hermes");
  });
});
