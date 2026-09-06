import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyClaudeTranscriptTerminalLine } from "@main/services/agents/integrations/transcript/claude-style-interrupt.ts";
import { createTranscriptTailReconciler } from "@main/services/agents/integrations/transcript/tail-reconciler.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { expect, it, vi } from "vitest";

it("reads a file created between the missing-file check and watcher registration", async () => {
  const root = await mkdtemp(join(tmpdir(), "pier-transcript-register-race-"));
  const path = join(root, "session.jsonl");
  const received: AgentHookEventPayload[] = [];
  const reconciler = createTranscriptTailReconciler({
    agent: "claude",
    // 构造分类器时尚未注册 watcher；模拟恰在此时一次写完的原生回复。
    createLineClassifier: () => {
      writeFileSync(
        path,
        `${JSON.stringify({
          type: "assistant",
          message: { role: "assistant", stop_reason: "end_turn" },
        })}\n`
      );
      return (line) =>
        classifyClaudeTranscriptTerminalLine(
          line,
          "claude.transcript.user_interrupt",
          "claude.transcript.assistant_stop"
        );
    },
    onTerminalEvent: (event) => received.push(event),
    transcriptRoot: root,
  });
  try {
    await reconciler.observe({
      agent: "claude",
      event: "PromptSubmit",
      kind: "agentEvent",
      panelId: "panel-1",
      sessionId: "session-1",
      transcriptPath: path,
      v: 1,
      windowId: "1",
    });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "claude.transcript.assistant_stop.end_turn",
    });
  } finally {
    reconciler.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
