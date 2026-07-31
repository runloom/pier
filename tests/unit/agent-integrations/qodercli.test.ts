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

const ORIGINAL_PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "pier-qodercli-home-"));
  vi.stubEnv("HOME", homeDir);
  vi.stubEnv("PATH", "");
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadIntegration() {
  const mod = await import(
    "../../../src/main/services/agents/integrations/qodercli.ts"
  );
  return mod.qodercliIntegration;
}

function configPath(): string {
  return join(homeDir, ".qoder", "settings.json");
}

describe("qodercliIntegration", () => {
  it("只安装当前官方可证明且能正确投影的状态事件", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<string, unknown[]>;
    for (const event of [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "Elicitation",
      "ElicitationResult",
      "PreCompact",
      "PostCompact",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "SessionEnd",
    ]) {
      expect(hooks[event], event).toHaveLength(1);
    }
    expect(hooks.PermissionRequest).toBeUndefined();
    expect(hooks.PermissionDenied).toBeUndefined();
    expect(hooks.Notification).toBeUndefined();
  });

  it("官方载荷：tool_use_id 与 agent_id 精确保留，权限拒绝不伪装等待闭环", async () => {
    const integration = await loadIntegration();
    await integration.install();
    const installed = JSON.parse(await readFile(configPath(), "utf8"));
    const hooks = installed.hooks as Record<
      string,
      Array<{ hooks: Array<{ command: string }> }>
    >;
    const command = (event: string) =>
      hooks[event]?.[0]?.hooks[0]?.command ?? "";
    const root = await mkdtemp(join(tmpdir(), "pier-qodercli-v3-"));
    const userData = join(root, "userData");
    const hooksHome = join(root, "hooks");
    await installAgentHooksEmitScript(userData, { hooksHome });
    const logPath = eventsJsonlPath(userData);
    const common = {
      cwd: "/repo",
      session_id: "qoder-session-1",
      transcript_path: "/tmp/qoder-session-1.jsonl",
    };
    for (const [event, payload] of [
      ["SessionStart", { ...common, hook_event_name: "SessionStart" }],
      [
        "UserPromptSubmit",
        {
          ...common,
          hook_event_name: "UserPromptSubmit",
          prompt: "Fix the parser",
        },
      ],
      [
        "PreToolUse",
        {
          ...common,
          hook_event_name: "PreToolUse",
          tool_input: { command: "pnpm test" },
          tool_name: "Bash",
          tool_use_id: "tool-qoder-1",
        },
      ],
      [
        "PostToolUseFailure",
        {
          ...common,
          error: "tests failed",
          error_type: "execution_failed",
          hook_event_name: "PostToolUseFailure",
          is_interrupt: false,
          tool_input: { command: "pnpm test" },
          tool_name: "Bash",
          tool_use_id: "tool-qoder-1",
        },
      ],
      [
        "Elicitation",
        {
          ...common,
          elicitation_id: "elicitation-qoder-1",
          hook_event_name: "Elicitation",
          mcp_server_name: "payments",
          message: "Confirm payment",
          mode: "form",
          requested_schema: { type: "object" },
        },
      ],
      [
        "ElicitationResult",
        {
          ...common,
          action: "decline",
          content: {},
          elicitation_id: "elicitation-qoder-1",
          hook_event_name: "ElicitationResult",
          mcp_server_name: "payments",
          mode: "form",
        },
      ],
      [
        "SubagentStart",
        {
          ...common,
          agent_id: "subagent-qoder-1",
          agent_type: "task",
          hook_event_name: "SubagentStart",
        },
      ],
      [
        "SubagentStop",
        {
          ...common,
          agent_id: "subagent-qoder-1",
          agent_transcript_path: "/tmp/subagent-qoder-1.jsonl",
          agent_type: "task",
          hook_event_name: "SubagentStop",
          stop_hook_active: false,
        },
      ],
      ["Stop", { ...common, hook_event_name: "Stop" }],
      [
        "StopFailure",
        {
          ...common,
          error: "server failed",
          error_type: "server_error",
          hook_event_name: "StopFailure",
        },
      ],
      ["SessionEnd", { ...common, hook_event_name: "SessionEnd" }],
    ] as const) {
      const result = spawnSync("/bin/sh", ["-c", command(event)], {
        env: {
          ...process.env,
          PATH: pathForHookSpawn(ORIGINAL_PATH),
          PIER_AGENT_EVENT_LOG: logPath,
          PIER_AGENT_HOOKS_DIR: pierHooksCurrentDir(hooksHome),
          PIER_PANEL_ID: "panel-1",
          PIER_WINDOW_ID: "window-1",
        },
        input: JSON.stringify(payload),
      });
      expect(result.status, result.stderr.toString()).toBe(0);
    }
    const rows = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => agentHookEventSchema.parse(JSON.parse(line)));
    expect(rows).toMatchObject([
      { event: "SessionStart", sessionId: "qoder-session-1", v: 3 },
      { event: "PromptSubmit", sessionId: "qoder-session-1", v: 3 },
      {
        event: "ToolStart",
        toolName: "Bash",
        toolUseId: "tool-qoder-1",
        v: 3,
      },
      {
        event: "ToolComplete",
        nativeEvent: "PostToolUseFailure",
        toolName: "Bash",
        toolUseId: "tool-qoder-1",
        v: 3,
      },
      {
        event: "InteractionRequested",
        interactionId: "elicitation-qoder-1",
        interactionKind: "question",
        v: 3,
      },
      {
        event: "InteractionResolved",
        interactionId: "elicitation-qoder-1",
        interactionKind: "question",
        interactionOutcome: "rejected",
        nativeState: "decline",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-qoder-1",
        agentType: "task",
        event: "SubagentStart",
        parentSessionId: "qoder-session-1",
        v: 3,
      },
      {
        actorHint: "subagent",
        agentInstanceId: "subagent-qoder-1",
        agentType: "task",
        event: "SubagentStop",
        parentSessionId: "qoder-session-1",
        v: 3,
      },
      { event: "Stop", v: 3 },
      { event: "error", nativeState: "server_error", v: 3 },
      { event: "SessionEnd", v: 3 },
    ]);
    expect(
      integration.runtime.emittedMappings.some(
        ({ nativeEvent }) =>
          nativeEvent === "PermissionRequest" ||
          nativeEvent === "PermissionDenied"
      )
    ).toBe(false);

    const aggregator = createForegroundActivityAggregator();
    const statuses: Array<string | undefined> = [];
    for (const row of rows.slice(0, 6)) {
      if (row.kind !== "agentEvent") {
        continue;
      }
      aggregator.ingestAgentEvent(row, integration.runtime);
      const activity = aggregator.snapshot().activities[0];
      statuses.push(activity?.kind === "agent" ? activity.status : undefined);
    }
    expect(statuses).toEqual([
      undefined,
      "processing",
      "tool",
      "processing",
      "waiting",
      "processing",
    ]);
  }, 15_000);

  it("保留用户配置，重复安装幂等，卸载仅移除 Pier 条目", async () => {
    await mkdir(join(homeDir, ".qoder"), { recursive: true });
    await writeFile(
      configPath(),
      JSON.stringify({
        model: "custom",
        hooks: {
          Stop: [{ hooks: [{ command: "say done", type: "command" }] }],
        },
      }),
      "utf8"
    );
    const integration = await loadIntegration();
    await integration.install();
    const first = await readFile(configPath(), "utf8");
    await integration.install();
    expect(await readFile(configPath(), "utf8")).toBe(first);
    await integration.uninstall();
    const cleaned = JSON.parse(await readFile(configPath(), "utf8"));
    expect(cleaned.model).toBe("custom");
    expect(cleaned.hooks.Stop).toEqual([
      { hooks: [{ command: "say done", type: "command" }] },
    ]);
  });
});
