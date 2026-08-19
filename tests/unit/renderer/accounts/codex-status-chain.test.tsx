import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV2 } from "@shared/contracts/agent/session.ts";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/status-bar.tsx";
import { registerAgentStatusItem } from "@/panel-kits/terminal/status-items/agent.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { createCodexTranscriptReconciler } from "../../../../src/main/services/agents/integrations/transcript/codex-reconciler.ts";
import { createForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "../../../../src/main/services/foreground-activity/types.ts";

const HOOK_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "none",
};
const TRANSCRIPT_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "transcript",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

describe("Codex transcript → aggregator → store → status DOM", () => {
  let dir: string;
  let transcriptPath: string;

  beforeEach(async () => {
    await initI18n();
    dir = await mkdtemp(join(tmpdir(), "pier-codex-chain-"));
    await mkdir(join(dir, "sessions"));
    transcriptPath = join(dir, "sessions", "rollout.jsonl");
    writeFileSync(transcriptPath, '{"type":"session_meta"}\n');
    window.matchMedia = vi.fn().mockReturnValue({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    });
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
    terminalStatusItemRegistry.clearForTests();
  });

  afterEach(async () => {
    cleanup();
    terminalStatusItemRegistry.clearForTests();
    await rm(dir, { force: true, recursive: true });
  });

  function promptEvent(): AgentHookEventPayloadV2 {
    return {
      agent: "codex",
      event: "PromptSubmit",
      kind: "agentEvent",
      nativeEvent: "codex.notify",
      panelId: "panel-1",
      sessionId: "session-1",
      transcriptPath,
      turnId: "turn-1",
      v: 2,
      windowId: "1",
    };
  }

  it.each([
    { order: "terminal-first", terminalType: "task_complete" },
    { order: "stop-first", terminalType: "task_complete" },
    { order: "stop-first", terminalType: "turn_aborted" },
  ])("$order 的 $terminalType 最终都只由可信终态进入 ready", async (row) => {
    const aggregator = createForegroundActivityAggregator();
    const applySnapshot = (): void => {
      act(() => {
        useForegroundActivityStore.getState().apply(aggregator.snapshot("1"));
      });
    };
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => {
        aggregator.ingestAgentEvent(event, TRANSCRIPT_OPTIONS);
        applySnapshot();
      },
      transcriptRoot: join(dir, "sessions"),
    });
    const prompt = promptEvent();
    aggregator.ingestAgentEvent(prompt, HOOK_OPTIONS);
    await reconciler.observe(prompt);
    applySnapshot();
    const disposeStatus = registerAgentStatusItem();
    render(
      <TerminalStatusBar
        context={undefined}
        cwd="/repo"
        getGroupId={() => null}
        panelId="panel-1"
        title={null}
      />
    );
    expect(await screen.findByTestId("agent-status-item")).toHaveAttribute(
      "data-agent-status",
      "processing"
    );

    aggregator.ingestAgentEvent(
      {
        ...prompt,
        event: "ToolStart",
        nativeEvent: "PreToolUse",
        toolUseId: "unmatched-tool",
      },
      HOOK_OPTIONS
    );
    applySnapshot();
    expect(screen.getByTestId("agent-status-item")).toHaveAttribute(
      "data-agent-status",
      "tool"
    );

    const stop = { ...prompt, event: "Stop" };
    const appendTerminal = (): void => {
      appendFileSync(
        transcriptPath,
        `${JSON.stringify({
          payload: {
            ...(row.terminalType === "turn_aborted"
              ? { reason: "interrupted" }
              : {}),
            turn_id: "turn-1",
            type: row.terminalType,
          },
          type: "event_msg",
        })}\n`
      );
    };
    if (row.order === "stop-first") {
      aggregator.ingestAgentEvent(stop, HOOK_OPTIONS);
      applySnapshot();
      expect(screen.getByTestId("agent-status-item")).toHaveAttribute(
        "data-agent-status",
        "none"
      );
      appendTerminal();
    } else {
      appendTerminal();
    }

    await waitFor(() => {
      expect(screen.getByTestId("agent-status-item")).toHaveAttribute(
        "data-agent-status",
        "ready"
      );
    });
    if (row.order === "terminal-first") {
      aggregator.ingestAgentEvent(stop, HOOK_OPTIONS);
      applySnapshot();
      expect(screen.getByTestId("agent-status-item")).toHaveAttribute(
        "data-agent-status",
        "ready"
      );
    }

    disposeStatus();
    reconciler.dispose();
    aggregator.dispose();
  });
});
