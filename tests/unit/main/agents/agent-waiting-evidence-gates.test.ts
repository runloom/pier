import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import {
  CLAUDE_HOOK_EVENTS,
  withPierClaudeHooks,
} from "@main/services/agents/integrations/claude.ts";
import {
  CODEX_HOOK_EVENTS,
  withPierCodexHooks,
} from "@main/services/agents/integrations/codex.ts";
import { COPILOT_EVENTS } from "@main/services/agents/integrations/copilot.ts";
import { CURSOR_EVENTS } from "@main/services/agents/integrations/cursor.ts";
import { DROID_HOOK_EVENTS } from "@main/services/agents/integrations/droid.ts";
import { GEMINI_HOOK_EVENTS } from "@main/services/agents/integrations/gemini.ts";
import { GROK_HOOK_EVENTS } from "@main/services/agents/integrations/grok.ts";
import {
  buildOpencodePluginSource,
  mapOpenCodeNativeEventToPier,
  OPENCODE_PERMISSION_NATIVE_EVENTS,
} from "@main/services/agents/integrations/opencode.ts";
import { getAgentHookIntegration } from "@main/services/agents/integrations/registry.ts";
import {
  isAgentStatusHooksIngestEnabled,
  setAgentStatusHooksIngestEnabled,
} from "@main/services/agents/status-hooks-gate.ts";
import { activityStatusForAgentHookEvent } from "@main/services/foreground-activity/agent-hook-compatibility.ts";
import {
  agentIndexCounts,
  isAgentIndexNeedsYou,
  projectAgentActivities,
} from "@shared/contracts/agent/runtime-index.ts";
import { agentKindSchema } from "@shared/contracts/agent.ts";
import {
  activityStatusForHookEvent,
  type ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function hasWaitingMapping(
  events: ReadonlyArray<{ nativeEvent: string; pierEvent: string }>,
  nativeEvent: string
): boolean {
  return events.some(
    (event) =>
      event.nativeEvent === nativeEvent &&
      (event.pierEvent === "PermissionRequest" ||
        event.pierEvent === "InteractionRequested")
  );
}

function nestedHookCommands(settings: Record<string, unknown>): string[] {
  const hooks = settings.hooks as
    | Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
    | undefined;
  if (!hooks) {
    return [];
  }
  const commands: string[] = [];
  for (const entries of Object.values(hooks)) {
    for (const entry of entries ?? []) {
      for (const hook of entry.hooks ?? []) {
        if (typeof hook.command === "string") {
          commands.push(hook.command);
        }
      }
    }
  }
  return commands;
}

describe("S1 top A waiting evidence", () => {
  it("旧 PermissionRequest 只在 v1/v2 兼容边界映射 waiting", () => {
    expect(activityStatusForHookEvent("PermissionRequest")).toBeNull();
    expect(
      activityStatusForAgentHookEvent({
        agent: "claude",
        event: "PermissionRequest",
        kind: "agentEvent",
        nativeEvent: "PermissionRequest",
        panelId: "p1",
        v: 2,
        windowId: "1",
      })
    ).toBe("waiting");
  });

  it("Claude 不为缺少完整结果闭环的事件建立 waiting", () => {
    for (const nativeEvent of [
      "PermissionRequest",
      "Elicitation",
      "ElicitationResult",
    ]) {
      expect(hasWaitingMapping(CLAUDE_HOOK_EVENTS, nativeEvent)).toBe(false);
    }
  });

  it("Codex hook 不与 transcript 重复建立 PermissionRequest waiting", () => {
    expect(hasWaitingMapping(CODEX_HOOK_EVENTS, "PermissionRequest")).toBe(
      false
    );
  });

  it("Copilot fire-and-forget 通知不映射 waiting", () => {
    expect(hasWaitingMapping(COPILOT_EVENTS, "permissionRequest")).toBe(false);
    expect(
      hasWaitingMapping(COPILOT_EVENTS, "notification.permission_prompt")
    ).toBe(false);
    expect(
      hasWaitingMapping(COPILOT_EVENTS, "notification.elicitation_dialog")
    ).toBe(false);
  });

  it("OpenCode maps permission.asked → InteractionRequested", () => {
    for (const native of OPENCODE_PERMISSION_NATIVE_EVENTS) {
      expect(mapOpenCodeNativeEventToPier(native)).toBe("InteractionRequested");
    }
  });

  it("Claude installed hooks do not emit unpaired interaction events", () => {
    const commands = nestedHookCommands(withPierClaudeHooks({}));
    expect(commands.some((cmd) => cmd.includes('"InteractionRequested"'))).toBe(
      false
    );
    expect(commands.some((cmd) => cmd.includes('"InteractionResolved"'))).toBe(
      false
    );
  });

  it("Codex installed hooks leave named interactions to transcript", () => {
    const commands = nestedHookCommands(withPierCodexHooks({}));
    expect(commands.some((cmd) => cmd.includes('"InteractionRequested"'))).toBe(
      false
    );
  });

  it("OpenCode plugin source maps permission.asked to named interaction", () => {
    const source = buildOpencodePluginSource();
    expect(source).toContain('event.type === "permission.asked"');
    expect(source).toContain('"InteractionRequested"');
  });

  it("projects waiting agent into Index needsYou and Attention candidate", async () => {
    const activity: Extract<ForegroundActivity, { kind: "agent" }> = {
      agentId: "claude",
      kind: "agent",
      panelId: "p1",
      source: "hook",
      spawnedAt: 1,
      status: "waiting",
      subagentCount: 0,
      updatedAt: 10,
      windowId: "11",
    };
    const entries = projectAgentActivities([activity]);
    expect(agentIndexCounts(entries).needsYou).toBeGreaterThanOrEqual(1);
    expect(entries.some((entry) => isAgentIndexNeedsYou(entry.status))).toBe(
      true
    );

    const showNotification = vi.fn(async () => ({ shown: true }));
    const service = createAgentAttentionService({
      isTargetPanelFocused: () => false,
      isOwnerWindowFocused: () => false,
      showNotification,
    });
    await service.observe(null, { activities: [activity], ts: 1 });
    expect(showNotification).toHaveBeenCalled();
  });
});

describe("S2 launch-only and no-status", () => {
  it("launch-only agents have no hook integration", () => {
    const launchOnly = ["ante", "codebuff", "continue", "rovo", "openclaw"];
    expect(
      agentKindSchema.options.filter(
        (agentId) => getAgentHookIntegration(agentId) === null
      )
    ).toEqual(launchOnly);
  });

  it("Index needsYou ignores launch entries without waiting|error status", () => {
    const entries = projectAgentActivities([
      {
        agentId: "ante",
        kind: "agent",
        panelId: "p1",
        source: "launch",
        spawnedAt: 1,
        subagentCount: 0,
        updatedAt: 10,
        windowId: "11",
      },
    ]);
    expect(agentIndexCounts(entries).needsYou).toBe(0);
    expect(entries.every((entry) => !isAgentIndexNeedsYou(entry.status))).toBe(
      true
    );
  });
});

describe("S3 agentStatusHooks ingest gate", () => {
  afterEach(() => {
    setAgentStatusHooksIngestEnabled(true);
  });

  it("tracks enabled flag for FA hook ingestion", () => {
    expect(isAgentStatusHooksIngestEnabled()).toBe(true);
    setAgentStatusHooksIngestEnabled(false);
    expect(isAgentStatusHooksIngestEnabled()).toBe(false);
    setAgentStatusHooksIngestEnabled(true);
    expect(isAgentStatusHooksIngestEnabled()).toBe(true);
  });
});

describe("B-tier permission-adjacent mappings retained after review", () => {
  it("Gemini ToolPermission 与 ask_user 缺少完整结果闭环，不映射 waiting", () => {
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "Notification")).toBe(false);
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "BeforeTool")).toBe(false);
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "AfterTool")).toBe(false);
  });

  it("Grok 不装 Notification→PermissionRequest（Turn complete 会假 waiting）", () => {
    expect(hasWaitingMapping(GROK_HOOK_EVENTS, "Notification")).toBe(false);
    expect(
      GROK_HOOK_EVENTS.some((event) => event.nativeEvent === "Notification")
    ).toBe(false);
  });

  it("Droid Notification 缺少结果事件，不映射 waiting", () => {
    expect(hasWaitingMapping(DROID_HOOK_EVENTS, "Notification")).toBe(false);
  });

  it("Cursor shell/MCP 闸门事件不装——自动放行也触发（假 waiting）且无 tool_use_id（无法配对）", () => {
    for (const nativeEvent of [
      "beforeShellExecution",
      "beforeMCPExecution",
      "afterShellExecution",
      "afterMCPExecution",
    ]) {
      expect(
        CURSOR_EVENTS.some((event) => event.nativeEvent === nativeEvent),
        nativeEvent
      ).toBe(false);
    }
  });
});
