import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventsJsonlPath,
  installAgentHooksEmitScript,
  pierHooksCurrentDir,
} from "../../../src/main/services/agents/hooks-install.ts";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";
import { agentHookEventSchema } from "../../../src/shared/contracts/agent/session.ts";
import { pathForHookSpawn } from "./hook-spawn-path.ts";

const MARK = "PIER_AGENT_HOOKS_DIR";
const ORIGINAL_PATH = process.env.PATH;

interface AutohandEntry {
  command: string;
  enabled?: boolean;
  event: string;
  timeout?: number;
}

function hookEntries(settings: Record<string, unknown>): AutohandEntry[] {
  const hooks = settings.hooks as { hooks?: AutohandEntry[] } | undefined;
  return Array.isArray(hooks?.hooks) ? hooks.hooks : [];
}

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-autohand-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/autohand.ts"
  );
  return mod.autohandIntegration;
}

function configPath(): string {
  return join(homeDir, ".autohand", "config.json");
}

describe("autohandIntegration", () => {
  it("id 为 autohand", async () => {
    const integration = await loadIntegration();
    expect(integration.id).toBe("autohand");
  });

  it("detect(): ~/.autohand 目录存在时为 true", async () => {
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(false);
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    expect(integration.detect()).toBe(true);
  });

  it("detect(): commandExistsOnPath 兜底——PATH 上有 autohand 二进制时即使无目录也为 true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-autohand-bin-"));
    await writeFile(join(dir, "autohand"), "#!/bin/sh\n", { mode: 0o755 });
    vi.stubEnv("PATH", dir);
    const integration = await loadIntegration();
    expect(integration.detect()).toBe(true);
  });

  it("只安装有完整状态语义的 7 个事件，权限与提问不制造悬挂等待", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const entries = hookEntries(installed);

    const expectedEvents = [
      "session-start",
      "session-end",
      "session-error",
      "pre-prompt",
      "stop",
      "pre-tool",
      "post-tool",
    ];
    expect(entries).toHaveLength(expectedEvents.length);
    const byEvent = new Map(entries.map((e) => [e.event, e]));
    for (const evt of expectedEvents) {
      expect(byEvent.has(evt), evt).toBe(true);
      expect(byEvent.get(evt)?.enabled).toBe(true);
    }
    // post-response 别名不重复安装
    expect(byEvent.has("post-response")).toBe(false);
    expect(byEvent.has("permission-request")).toBe(false);
    expect(byEvent.has("ask-followup-question")).toBe(false);
    expect(byEvent.has("subagent-stop")).toBe(false);

    for (const entry of entries) {
      expect(entry.command).toContain(MARK);
      expect(entry.command).toContain('"autohand"');
    }
    // pierEvent 名称核验
    expect(byEvent.get("session-start")?.command).toContain('"SessionStart"');
    expect(byEvent.get("session-end")?.command).toContain('"SessionEnd"');
    expect(byEvent.get("session-error")?.command).toContain('"error"');
    expect(byEvent.get("pre-prompt")?.command).toContain('"PromptSubmit"');
    expect(byEvent.get("stop")?.command).toContain('"Stop"');
    expect(byEvent.get("pre-tool")?.command).toContain('"ToolStart"');
    expect(byEvent.get("post-tool")?.command).toContain('"ToolComplete"');
    for (const entry of entries) {
      expect(entry.command).toContain('"agentEventV3"');
    }
  });

  it("真实 tool_use_id 载荷形成 v3 工具闭环，局部失败后由权威 stop 回到 ready", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const byEvent = new Map(
      hookEntries(installed).map((entry) => [entry.event, entry])
    );
    const root = await mkdtemp(join(tmpdir(), "pier-autohand-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const payloads = [
      [
        "session-start",
        { hook_event_name: "session-start", session_id: "session-a" },
      ],
      [
        "pre-prompt",
        {
          hook_event_name: "pre-prompt",
          prompt: "Fix it",
          session_id: "session-a",
        },
      ],
      [
        "pre-tool",
        {
          hook_event_name: "pre-tool",
          session_id: "session-a",
          tool_name: "terminal",
          tool_use_id: "tool-1",
        },
      ],
      [
        "post-tool",
        {
          hook_event_name: "post-tool",
          session_id: "session-a",
          status: "error",
          tool_name: "terminal",
          tool_use_id: "tool-1",
        },
      ],
      ["stop", { hook_event_name: "stop", session_id: "session-a" }],
    ] as const;
    for (const [event, payload] of payloads) {
      const result = spawnSync(
        "/bin/sh",
        ["-c", byEvent.get(event)?.command ?? ""],
        {
          env: {
            ...process.env,
            PATH: pathForHookSpawn(ORIGINAL_PATH),
            PIER_AGENT_EVENT_LOG: logPath,
            PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
            PIER_PANEL_ID: "panel-1",
            PIER_WINDOW_ID: "window-1",
          },
          input: JSON.stringify(payload),
        }
      );
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows[2]).toMatchObject({
      event: "ToolStart",
      toolName: "terminal",
      toolUseId: "tool-1",
      v: 3,
    });
    expect(rows[3]).toMatchObject({
      event: "ToolComplete",
      nativeState: "error",
      toolUseId: "tool-1",
      v: 3,
    });
    expect(
      rows.some((row) => row.kind === "agentEvent" && row.event === "error")
    ).toBe(false);
    const aggregator = createForegroundActivityAggregator();
    const statuses: string[] = [];
    for (const row of rows) {
      if (row.kind !== "agentEvent") continue;
      aggregator.ingestAgentEvent(row, {
        evidenceSource: "hook",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      const activity = aggregator.snapshot().activities[0];
      if (activity?.kind === "agent" && activity.status)
        statuses.push(activity.status);
    }
    expect(statuses).toEqual(["processing", "tool", "processing", "ready"]);
  }, 15_000);

  it("幂等：重复安装不产生重复条目", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const once = JSON.parse(await readFile(configPath(), "utf8"));
    await integration.install();
    const twice = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookEntries(twice)).toHaveLength(hookEntries(once).length);
  });

  it("重复安装第二次不改变文件字节", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const afterFirst = await readFile(configPath(), "utf8");
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(afterFirst);
  });

  it("保留用户已有的无关 hook 与顶层配置", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "autohand-1",
        hooks: {
          enabled: true,
          hooks: [{ event: "stop", command: "say done", enabled: true }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    expect(installed.model).toBe("autohand-1");
    const entries = hookEntries(installed);
    expect(entries.some((e) => e.command === "say done")).toBe(true);
  });

  it("卸载只移除 pier 条目，保留用户 hook", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        hooks: {
          enabled: true,
          hooks: [{ event: "stop", command: "say done", enabled: true }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(hookEntries(cleaned)).toEqual([
      { event: "stop", command: "say done", enabled: true },
    ]);
  });

  it("已损坏的 config.json 不被覆盖(安装静默放弃)", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(configPath(), "{ not json", "utf8");
    const integration = await loadIntegration();
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe("{ not json");
  });

  it.each([
    '{"hooks":"user-value"}',
    '{"hooks":{"hooks":{"custom":true}}}',
    '{"hooks":{"hooks":[],"enabled":"user-value"}}',
  ])("合法 JSON 的异常 Autohand shape 安装时保持字节不变：%s", async (raw) => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    await writeFile(configPath(), raw, "utf8");
    const integration = await loadIntegration();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await integration.install();
      expect(await readFile(configPath(), "utf8")).toBe(raw);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("无变化不落盘：卸载未安装文件字节不变", async () => {
    await mkdir(join(homeDir, ".autohand"), { recursive: true });
    const original = '{"model":"autohand-1"}';
    await writeFile(configPath(), original, "utf8");
    const integration = await loadIntegration();
    await integration.uninstall();
    expect(await readFile(configPath(), "utf8")).toBe(original);
  });
});
