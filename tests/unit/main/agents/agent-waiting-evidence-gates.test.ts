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
import { AGENT_STATUS_EVIDENCE } from "@main/services/agents/integrations/evidence/matrix.ts";
import { GEMINI_HOOK_EVENTS } from "@main/services/agents/integrations/gemini.ts";
import { GROK_HOOK_EVENTS } from "@main/services/agents/integrations/grok.ts";
import { KIMI_HOOK_EVENTS } from "@main/services/agents/integrations/kimi.ts";
import { buildOmpExtensionSource } from "@main/services/agents/integrations/omp.ts";
import {
  buildOpencodePluginSource,
  mapOpenCodeNativeEventToPier,
  OPENCODE_PERMISSION_NATIVE_EVENTS,
} from "@main/services/agents/integrations/opencode.ts";
import { buildPiExtensionSource } from "@main/services/agents/integrations/pi.ts";
import { getAgentHookIntegration } from "@main/services/agents/integrations/registry.ts";
import {
  isAgentStatusHooksIngestEnabled,
  setAgentStatusHooksIngestEnabled,
} from "@main/services/agents/status-hooks-gate.ts";
import { classifyAgentTurnEvent } from "@main/services/foreground-activity/agent-turn-event-semantics.ts";
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
      classifyAgentTurnEvent(
        {
          agent: "claude",
          event: "PermissionRequest",
          kind: "agentEvent",
          nativeEvent: "PermissionRequest",
          panelId: "p1",
          v: 2,
          windowId: "1",
        },
        {
          evidenceSource: "hook",
          stopAuthority: "advisory",
          turnStartAuthority: "none",
        }
      ).mappedStatus
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

  it("Claude installed hooks pair InteractionRequested with InteractionResolved for blocking tools", () => {
    const commands = nestedHookCommands(withPierClaudeHooks({}));
    // Plan/Ask 等人工具经 Pre/Post toolUseId 闭环；不得只装一边。
    expect(commands.some((cmd) => cmd.includes('"InteractionRequested"'))).toBe(
      true
    );
    expect(commands.some((cmd) => cmd.includes('"InteractionResolved"'))).toBe(
      true
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

    const ingestNotification = vi.fn();
    const service = createAgentAttentionService({
      ingestNotification,
    });
    await service.observe(null, { activities: [activity], ts: 1 });
    expect(ingestNotification).toHaveBeenCalled();
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
  it("Kimi PermissionRequest/Result 成对映射 waiting", () => {
    expect(hasWaitingMapping(KIMI_HOOK_EVENTS, "PermissionRequest")).toBe(true);
    expect(hasWaitingMapping(KIMI_HOOK_EVENTS, "PermissionResult")).toBe(false);
    expect(
      KIMI_HOOK_EVENTS.some(
        (event) =>
          event.nativeEvent === "PermissionResult" &&
          event.pierEvent === "InteractionResolved"
      )
    ).toBe(true);
    expect(AGENT_STATUS_EVIDENCE.kimi.evidence.waiting).toBe("native");
  });

  it("Gemini ToolPermission 与 ask_user 缺少完整结果闭环，不映射 waiting", () => {
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "Notification")).toBe(false);
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "BeforeTool")).toBe(false);
    expect(hasWaitingMapping(GEMINI_HOOK_EVENTS, "AfterTool")).toBe(false);
    expect(AGENT_STATUS_EVIDENCE.gemini.evidence.waiting).toBe("unsupported");
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

  it("OMP / Pi 发出 ask 时裁掉 toolCallId 签名段，避免契约拒收", () => {
    expect(buildOmpExtensionSource()).toContain("function pierBoundWorkId");
    expect(buildPiExtensionSource()).toContain("function pierBoundWorkId");
  });

  it("Cursor CreatePlan/SwitchMode 走 hook Interaction；AskQuestion 只走 transcript", () => {
    // CURSOR_EVENTS 表仍把 preToolUse 标成 ToolStart；审批门在 hook 命令内按工具名分发。
    expect(hasWaitingMapping(CURSOR_EVENTS, "preToolUse")).toBe(false);
    expect(hasWaitingMapping(CURSOR_EVENTS, "beforeSubmitPrompt")).toBe(false);
    expect(AGENT_STATUS_EVIDENCE.cursor.evidence.waiting).toBe("native");
    expect(
      AGENT_STATUS_EVIDENCE.cursor.eventMappings.some(
        (mapping) =>
          mapping.dimension === "waiting" &&
          mapping.nativeEvent === "preToolUse" &&
          mapping.level === "native"
      )
    ).toBe(true);
    expect(
      AGENT_STATUS_EVIDENCE.cursor.eventMappings.some(
        (mapping) =>
          mapping.dimension === "waiting" &&
          mapping.nativeEvent === "cursor.transcript.ask_question" &&
          mapping.level === "reconciled"
      )
    ).toBe(true);
    expect(AGENT_STATUS_EVIDENCE.cursor.transport).toContain(
      "transcript-reconciler"
    );
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
