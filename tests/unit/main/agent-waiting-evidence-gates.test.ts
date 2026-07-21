import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import {
  isAgentStatusHooksIngestEnabled,
  setAgentStatusHooksIngestEnabled,
} from "@main/services/agents/agent-status-hooks-gate.ts";
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
import { agentKindSchema } from "@shared/contracts/agent.ts";
import {
  agentIndexCounts,
  isAgentIndexNeedsYou,
  projectAgentActivities,
} from "@shared/contracts/agent-runtime-index.ts";
import {
  activityStatusForHookEvent,
  type ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function hasPermissionMapping(
  events: ReadonlyArray<{ nativeEvent: string; pierEvent: string }>,
  nativeEvent: string
): boolean {
  return events.some(
    (event) =>
      event.nativeEvent === nativeEvent &&
      event.pierEvent === "PermissionRequest"
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
  it("maps PermissionRequest to waiting in the shared FA contract", () => {
    expect(activityStatusForHookEvent("PermissionRequest")).toBe("waiting");
  });

  it("Claude maps native PermissionRequest → PermissionRequest", () => {
    expect(hasPermissionMapping(CLAUDE_HOOK_EVENTS, "PermissionRequest")).toBe(
      true
    );
  });

  it("Codex maps native PermissionRequest → PermissionRequest", () => {
    expect(hasPermissionMapping(CODEX_HOOK_EVENTS, "PermissionRequest")).toBe(
      true
    );
  });

  it("Copilot maps permissionRequest → PermissionRequest", () => {
    expect(hasPermissionMapping(COPILOT_EVENTS, "permissionRequest")).toBe(
      true
    );
  });

  it("OpenCode maps permission.updated → PermissionRequest", () => {
    for (const native of OPENCODE_PERMISSION_NATIVE_EVENTS) {
      expect(mapOpenCodeNativeEventToPier(native)).toBe("PermissionRequest");
    }
  });

  it("Claude installed hooks emit PermissionRequest pier event", () => {
    const commands = nestedHookCommands(withPierClaudeHooks({}));
    expect(commands.some((cmd) => cmd.includes('"PermissionRequest"'))).toBe(
      true
    );
  });

  it("Codex installed hooks emit PermissionRequest pier event", () => {
    const commands = nestedHookCommands(withPierCodexHooks({}));
    expect(commands.some((cmd) => cmd.includes('"PermissionRequest"'))).toBe(
      true
    );
  });

  it("OpenCode plugin source maps permission.updated to PermissionRequest", () => {
    const source = buildOpencodePluginSource();
    expect(source).toContain(
      'if (event.type === "permission.updated") return "PermissionRequest";'
    );
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
  it("Gemini Notification → PermissionRequest (ToolPermission signal)", () => {
    expect(hasPermissionMapping(GEMINI_HOOK_EVENTS, "Notification")).toBe(true);
  });

  it("Grok Notification → PermissionRequest", () => {
    expect(hasPermissionMapping(GROK_HOOK_EVENTS, "Notification")).toBe(true);
  });

  it("Droid Notification → PermissionRequest", () => {
    expect(hasPermissionMapping(DROID_HOOK_EVENTS, "Notification")).toBe(true);
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
