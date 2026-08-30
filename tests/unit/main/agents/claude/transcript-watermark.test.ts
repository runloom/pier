import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeTranscriptReconciler } from "../../../../../src/main/services/agents/integrations/transcript/claude-reconciler.ts";

function hookEvent(
  transcriptPath: string,
  event: "PromptSubmit" | "SessionStart" = "PromptSubmit"
): AgentHookEventPayload {
  return {
    agent: "claude",
    event,
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    transcriptPath,
    v: 1,
    windowId: "1",
  };
}

function endTurnLine(): string {
  return `${JSON.stringify({
    isSidechain: false,
    message: {
      content: [{ text: "done", type: "text" }],
      role: "assistant",
      stop_reason: "end_turn",
    },
    type: "assistant",
  })}\n`;
}

describe("claude transcript PromptSubmit watermark", () => {
  let dir: string;
  let path: string;
  let transcriptRoot: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-claude-watermark-"));
    transcriptRoot = join(dir, "projects");
    await mkdir(transcriptRoot);
    path = join(transcriptRoot, "session.jsonl");
    writeFileSync(path, '{"type":"summary"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("drops a stale end_turn that landed before the next PromptSubmit", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "SessionStart"));
    appendFileSync(path, endTurnLine());
    await reconciler.observe(hookEvent(path));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(received).toHaveLength(0);
    appendFileSync(path, endTurnLine());
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5000 });
    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });
});
