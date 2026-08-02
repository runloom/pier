import { spawnSync } from "node:child_process";
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
import {
  PIER_MANAGED_PLUGIN_GENERATION,
  pierManagedPluginMarker,
} from "../../../src/main/services/agents/integrations/managed-plugin-file.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

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
  "subagent_start",
  "subagent_stop",
];

describe("buildHermesPluginManifest", () => {
  it("含 marker、插件名, 事件表齐全（provides_hooks 列全部原生事件）", () => {
    const manifest = buildHermesPluginManifest();
    expect(manifest).toContain(HERMES_MARKER);
    expect(manifest).toContain(`name: ${HERMES_PLUGIN_NAME}`);
    expect(HERMES_EVENT_MAP).toEqual([
      { nativeEvent: "on_session_start", pierEvent: "SessionStart" },
      { nativeEvent: "pre_llm_call", pierEvent: "PromptSubmit" },
      { nativeEvent: "pre_tool_call", pierEvent: "ToolStart" },
      {
        nativeEvent: "pre_tool_call.clarify",
        pierEvent: "InteractionRequested",
      },
      { nativeEvent: "post_tool_call", pierEvent: "ToolComplete" },
      {
        nativeEvent: "post_tool_call.clarify",
        pierEvent: "InteractionResolved",
      },
      {
        nativeEvent: "pre_approval_request",
        pierEvent: "InteractionRequested",
      },
      {
        nativeEvent: "post_approval_response",
        pierEvent: "InteractionResolved",
      },
      {
        nativeEvent: "on_session_end.completed",
        pierEvent: "TurnCompleted",
      },
      { nativeEvent: "on_session_end.failed", pierEvent: "error" },
      {
        nativeEvent: "on_session_end.interrupted",
        pierEvent: "TurnInterrupted",
      },
      { nativeEvent: "on_session_finalize", pierEvent: "SessionEnd" },
      { nativeEvent: "on_session_reset", pierEvent: "SessionStart" },
      { nativeEvent: "subagent_start", pierEvent: "SubagentStart" },
      { nativeEvent: "subagent_stop", pierEvent: "SubagentStop" },
    ]);
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
    expect(init).toContain("def _pier_emit(");
    expect(init).toContain("payload: dict[str, Any],");
    expect(init).toContain('"nativeEvent": native_event');
  });

  it("事件分派使用真实终态与交互结果，不把回合结束写成 SessionEnd", () => {
    const init = buildHermesPluginInit();
    expect(init).toContain('"on_session_start": "SessionStart"');
    expect(init).toContain('"pre_llm_call": "PromptSubmit"');
    expect(init).toContain('"pre_tool_call": "ToolStart"');
    expect(init).toContain('"post_tool_call": "ToolComplete"');
    expect(init).toContain("InteractionRequested");
    expect(init).toContain("InteractionResolved");
    expect(init).toContain("TurnCompleted");
    expect(init).toContain("TurnInterrupted");
    expect(init).toContain('"on_session_finalize": "SessionEnd"');
    expect(init).toContain('"on_session_reset": "SessionStart"');
    expect(init).toContain('"subagent_start": "SubagentStart"');
    expect(init).toContain('"subagent_stop": "SubagentStop"');
    expect(init).not.toContain("post_llm_call");
  });

  it("真实 kwargs 生成严格 v3，工具失败不升全局错误，终态与子智能体身份闭环", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hermes-runtime-"));
    const initPath = join(dir, "pier_status.py");
    const logPath = join(dir, "events.jsonl");
    await writeFile(initPath, buildHermesPluginInit(), "utf8");
    const runner = `
import importlib.util
spec = importlib.util.spec_from_file_location("pier_status", ${JSON.stringify(initPath)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self): self.hooks = {}
    def register_hook(self, name, callback): self.hooks[name] = callback
ctx = Ctx()
mod.register(ctx)
ctx.hooks["on_session_start"](session_id="parent")
ctx.hooks["pre_llm_call"](session_id="parent", turn_id="turn-1", user_message="Fix it")
ctx.hooks["pre_tool_call"](session_id="parent", turn_id="turn-1", tool_name="terminal", tool_call_id="tool-1")
ctx.hooks["post_tool_call"](session_id="parent", turn_id="turn-1", tool_name="terminal", tool_call_id="tool-1", status="error")
ctx.hooks["pre_approval_request"](session_key="parent", pattern_key="approval-1", command="rm x")
ctx.hooks["post_approval_response"](session_key="parent", pattern_key="approval-1", command="rm x", choice="deny")
# 固定提交 tools/delegate_tool.py 的两个真实调用点都传同一个
# getattr(child, "session_id", None)：start 1469-1478，stop 2490-2502。
ctx.hooks["subagent_start"](parent_session_id="parent", parent_turn_id="turn-1", child_session_id="child", child_subagent_id="sub-1", child_role="researcher")
ctx.hooks["subagent_stop"](parent_session_id="parent", parent_turn_id="turn-1", child_session_id="child", child_role="researcher", child_status="completed")
ctx.hooks["on_session_end"](session_id="parent", turn_id="turn-1", completed=True, failed=False, interrupted=False)
`;
    const result = spawnSync("python3", ["-c", runner], {
      env: {
        ...process.env,
        PATH: pathForHookSpawn(process.env.PATH),
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_PANEL_ID: "panel-1",
        PIER_WINDOW_ID: "window-1",
      },
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      { event: "SessionStart", sessionId: "parent", v: 3 },
      {
        event: "PromptSubmit",
        promptSnippet: "Fix it",
        sessionId: "parent",
        turnId: "turn-1",
      },
      {
        event: "ToolStart",
        toolName: "terminal",
        toolUseId: "tool-1",
      },
      {
        event: "ToolComplete",
        nativeState: "error",
        toolUseId: "tool-1",
      },
      {
        event: "InteractionRequested",
        interactionId: "approval-1",
        interactionKind: "permission",
      },
      {
        event: "InteractionResolved",
        interactionId: "approval-1",
        interactionKind: "permission",
        interactionOutcome: "rejected",
      },
      {
        actorHint: "subagent",
        agentInstanceId: "child",
        event: "SubagentStart",
        parentSessionId: "parent",
        sessionId: "child",
      },
      {
        actorHint: "subagent",
        agentInstanceId: "child",
        event: "SubagentStop",
        parentSessionId: "parent",
        sessionId: "child",
      },
      { event: "TurnCompleted", nativeEvent: "on_session_end.completed" },
    ]);
    expect(
      rows.some((row) => row.kind === "agentEvent" && row.event === "error")
    ).toBe(false);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "none",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status) {
        statuses.push(activity.status);
      }
    }
    expect(statuses).toEqual([
      "processing",
      "tool",
      "processing",
      "waiting",
      "processing",
      "processing",
      "processing",
      "ready",
    ]);
  });

  it("_DEFAULT_PAYLOADS 式 stop 缺 child_session_id 时保持匿名，不伪造稳定身份", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-hermes-default-stop-"));
    const initPath = join(dir, "pier_status.py");
    const logPath = join(dir, "events.jsonl");
    await writeFile(initPath, buildHermesPluginInit(), "utf8");
    const runner = `
import importlib.util
spec = importlib.util.spec_from_file_location("pier_status", ${JSON.stringify(initPath)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Ctx:
    def __init__(self): self.hooks = {}
    def register_hook(self, name, callback): self.hooks[name] = callback
ctx = Ctx()
mod.register(ctx)
ctx.hooks["subagent_stop"](
    parent_session_id="parent-sess",
    child_role=None,
    child_summary="Synthetic summary for hooks test",
    child_status="completed",
    duration_ms=1234,
)
`;
    const result = spawnSync("python3", ["-c", runner], {
      env: {
        ...process.env,
        PATH: pathForHookSpawn(process.env.PATH),
        PIER_AGENT_EVENT_LOG: logPath,
        PIER_PANEL_ID: "panel-1",
        PIER_WINDOW_ID: "window-1",
      },
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    const row = agentHookEventSchema.parse(
      JSON.parse((await readFile(logPath, "utf8")).trim())
    );
    expect(row).toMatchObject({
      actorHint: "subagent",
      event: "SubagentStop",
      parentSessionId: "parent-sess",
      v: 3,
    });
    expect(row).not.toHaveProperty("agentInstanceId");
    expect(row).not.toHaveProperty("sessionId");
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

  it("enabled 与 disabled 共存时只解析 enabled 子块", () => {
    const raw =
      "plugins:\n  enabled:\n    - other-plugin\n  disabled:\n    - blocked-plugin\n";
    expect(withHermesPluginEnabled(raw)).toBe(
      "plugins:\n  enabled:\n    - other-plugin\n    - pier-status\n  disabled:\n    - blocked-plugin\n"
    );
  });

  it("相似缩进块不会被并入 plugins.enabled", () => {
    const raw =
      "profiles:\n  enabled:\n    - pier-status\nplugins:\n  disabled:\n    - blocked-plugin\n";
    expect(withHermesPluginEnabled(raw)).toBe(
      "profiles:\n  enabled:\n    - pier-status\nplugins:\n  enabled:\n    - pier-status\n  disabled:\n    - blocked-plugin\n"
    );
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

  it("只移除 plugins.enabled 内的同名项，保留其它列表", () => {
    const raw =
      "profiles:\n  enabled:\n    - pier-status\nplugins:\n  enabled:\n    - pier-status\n  disabled:\n    - pier-status\n";
    expect(withoutHermesPluginEnabled(raw)).toBe(
      "profiles:\n  enabled:\n    - pier-status\nplugins:\n  disabled:\n    - pier-status\n"
    );
  });

  it("malformed enabled 安全放弃，不误删其它相似列表", () => {
    const raw =
      "profiles:\n  enabled:\n    - pier-status\nplugins:\n  enabled: [pier-status]\n";
    expect(withoutHermesPluginEnabled(raw)).toBe(raw);
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

  it("任一文件非托管时整组预检失败，另一缺失文件与 config 都零写入", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    const manifestPath = join(pluginDir, "plugin.yaml");
    const initPath = join(pluginDir, "__init__.py");
    const rawConfig = "provider: anthropic\n";
    await mkdir(pluginDir, { recursive: true });
    await writeFile(manifestPath, "name: user-plugin\n", "utf8");
    await writeFile(configPath, rawConfig, "utf8");

    await installHermesPlugin(configPath);

    expect(await readFile(manifestPath, "utf8")).toBe("name: user-plugin\n");
    await expect(readFile(initPath, "utf8")).rejects.toThrow();
    expect(await readFile(configPath, "utf8")).toBe(rawConfig);
  });

  it("任一文件世代更新时整组拒绝，另一旧文件不升级且 config 不启用", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    const manifestPath = join(pluginDir, "plugin.yaml");
    const initPath = join(pluginDir, "__init__.py");
    const newer = `# ${pierManagedPluginMarker(
      PIER_MANAGED_PLUGIN_GENERATION + 1
    )}\nnewer manifest\n`;
    const older = `# ${pierManagedPluginMarker(
      Math.max(1, PIER_MANAGED_PLUGIN_GENERATION - 1)
    )}\nolder init\n`;
    await mkdir(pluginDir, { recursive: true });
    await writeFile(manifestPath, newer, "utf8");
    await writeFile(initPath, older, "utf8");

    await installHermesPlugin(configPath);

    expect(await readFile(manifestPath, "utf8")).toBe(newer);
    expect(await readFile(initPath, "utf8")).toBe(older);
    await expect(readFile(configPath, "utf8")).rejects.toThrow();
  });

  it("非托管同名插件启用项在卸载时保持不变", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    const manifestPath = join(pluginDir, "plugin.yaml");
    const initPath = join(pluginDir, "__init__.py");
    const rawConfig = "plugins:\n  enabled:\n    - pier-status\n";
    await mkdir(pluginDir, { recursive: true });
    await writeFile(manifestPath, "name: user-plugin\n", "utf8");
    await writeFile(initPath, "# user plugin\n", "utf8");
    await writeFile(configPath, rawConfig, "utf8");

    await uninstallHermesPlugin(configPath);

    expect(await readFile(manifestPath, "utf8")).toBe("name: user-plugin\n");
    expect(await readFile(initPath, "utf8")).toBe("# user plugin\n");
    expect(await readFile(configPath, "utf8")).toBe(rawConfig);
  });

  it("单侧历史 Pier 残留可完整恢复后再启用 config", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    const manifestPath = join(pluginDir, "plugin.yaml");
    const initPath = join(pluginDir, "__init__.py");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      manifestPath,
      `# ${pierManagedPluginMarker(1)}\nold manifest\n`,
      "utf8"
    );

    await installHermesPlugin(configPath);

    expect(await readFile(manifestPath, "utf8")).toBe(
      buildHermesPluginManifest()
    );
    expect(await readFile(initPath, "utf8")).toBe(buildHermesPluginInit());
    expect(await readFile(configPath, "utf8")).toContain("    - pier-status");
  });

  it("卸载只清理可证明托管的历史残留，保留同目录未知文件", async () => {
    await setup();
    const pluginDir = join(dir, "plugins", "pier-status");
    const manifestPath = join(pluginDir, "plugin.yaml");
    const sentinelPath = join(pluginDir, "user-note.txt");
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      manifestPath,
      `# ${pierManagedPluginMarker(1)}\nold manifest\n`,
      "utf8"
    );
    await writeFile(sentinelPath, "keep me\n", "utf8");
    await writeFile(
      configPath,
      "plugins:\n  enabled:\n    - pier-status\n",
      "utf8"
    );

    await uninstallHermesPlugin(configPath);

    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
    expect(await readFile(sentinelPath, "utf8")).toBe("keep me\n");
    expect(await readFile(configPath, "utf8")).not.toContain("pier-status");
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
  it("id 为 hermes", () => {
    expect(hermesIntegration.id).toBe("hermes");
  });
});
