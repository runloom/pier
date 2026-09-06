import {
  appendFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentHookEventSinks,
  handleObservedAgentHookEvent,
} from "@main/ipc/foreground-activity/hook-pipeline.ts";
import { claudeIntegration } from "@main/services/agents/integrations/claude.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import { createClaudeTranscriptReconciler } from "@main/services/agents/integrations/transcript/claude-reconciler.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV3,
} from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Claude 2.1.261 实机：Prompt 已到 Pier 后 31ms 才创建 transcript。
// 无工具直答，Stop 到达时两条 assistant end_turn 已全部写完。
const TURN_ID = "c11e160f-21fb-470b-98ac-9f709ba1b73c";
const endTurn = `${JSON.stringify({
  isSidechain: false,
  type: "assistant",
  message: {
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "done" }],
  },
})}\n`;

describe("Claude transcript created after PromptSubmit", () => {
  let root: string;
  let path: string;
  let aggregator: ReturnType<typeof createForegroundActivityAggregator>;
  let reconciler: ReturnType<typeof createClaudeTranscriptReconciler>;
  let received: AgentHookEventPayload[];
  let sinks: AgentHookEventSinks;

  function event(
    name: "SessionStart" | "PromptSubmit" | "Stop" | "SessionEnd"
  ): AgentHookEventPayloadV3 {
    return {
      agent: "claude",
      event: name,
      kind: "agentEvent",
      nativeEvent: name === "PromptSubmit" ? "UserPromptSubmit" : name,
      panelId: "panel-1",
      sessionId: "session-1",
      spawnGeneration: 1,
      transcriptPath: path,
      ts: Date.now() * 1_000_000,
      ...(name === "SessionStart" ? {} : { turnId: TURN_ID }),
      v: 3,
      windowId: "1",
    };
  }

  beforeEach(async () => {
    vi.useRealTimers();
    root = await mkdtemp(join(tmpdir(), "pier-claude-late-file-"));
    path = join(root, "project", "session-1.jsonl");
    received = [];
    aggregator = createForegroundActivityAggregator();
    aggregator.agentLaunched("1", "panel-1", "claude");
    reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (terminal) => {
        received.push(terminal);
        aggregator.ingestAgentEvent(
          terminal,
          resolveAgentEventIngestOptions({
            evidenceSource: "transcript",
            event: terminal,
            runtime: undefined,
          })
        );
      },
      transcriptRoot: root,
    });
    sinks = {
      aggregator,
      applySessionTitle: async () => {},
      notifyListeners() {},
      observeTranscript: (hook) => reconciler.observe(hook),
      recordResume() {},
      resolveRuntime: () => claudeIntegration.runtime,
    };
  });

  afterEach(async () => {
    reconciler.dispose();
    aggregator.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    false,
    true,
  ])("late file completes a tool-free turn; later Stop=%s", async (sendStop) => {
    await handleObservedAgentHookEvent(sinks, event("SessionStart"));
    await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "processing",
    });

    await mkdir(join(root, "project"));
    await writeFile(path, endTurn);
    if (sendStop) await handleObservedAgentHookEvent(sinks, event("Stop"));

    await vi.waitFor(
      () => {
        expect(aggregator.snapshot().activities[0]).toMatchObject({
          kind: "agent",
          status: "ready",
        });
      },
      { timeout: 1500 }
    );
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "claude.transcript.assistant_stop.end_turn",
      turnId: TURN_ID,
    });
  });

  it("SessionStart alone cannot replay a file that appears with history", async () => {
    await reconciler.observe(event("SessionStart"));
    await mkdir(join(root, "project"));
    await writeFile(path, endTurn);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
  });

  it.each([
    "panel",
    "window",
    "session",
    "dispose",
  ])("releasing %s cancels a missing-file watch", async (release) => {
    await reconciler.observe(event("PromptSubmit"));
    if (release === "panel") reconciler.releasePanel("panel-1", "1");
    if (release === "window") reconciler.releaseWindow("1");
    if (release === "session") await reconciler.observe(event("SessionEnd"));
    if (release === "dispose") reconciler.dispose();
    await mkdir(join(root, "project"));
    await writeFile(path, endTurn);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
  });

  it("a new session retires the old missing file without losing its own completion", async () => {
    await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
    const nextPath = join(root, "project", "session-2.jsonl");
    const nextTurn = "c11e160f-21fb-470b-98ac-9f709ba1b73d";
    await handleObservedAgentHookEvent(sinks, {
      ...event("PromptSubmit"),
      sessionId: "session-2",
      transcriptPath: nextPath,
      turnId: nextTurn,
    });
    await mkdir(join(root, "project"));
    await writeFile(path, endTurn);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    await writeFile(nextPath, endTurn);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      sessionId: "session-2",
      turnId: nextTurn,
    });
  });

  it("moving a panel preserves the missing file's prompt boundary and new owner", async () => {
    await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
    const transfer = {
      panelId: "panel-1",
      sourceWindowId: "1",
      targetWindowId: "2",
    };
    aggregator.transferPanelOwnership(transfer);
    reconciler.transferPanelOwnership(transfer);
    await mkdir(join(root, "project"));
    await writeFile(path, endTurn);
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ windowId: "2", turnId: TURN_ID });
    expect(aggregator.snapshot("2").activities[0]).toMatchObject({
      kind: "agent",
      status: "ready",
    });
  });

  it("a late-created symlink outside the provider root cannot supply completion", async () => {
    const outside = await mkdtemp(join(tmpdir(), "pier-claude-outside-"));
    try {
      const target = join(outside, "session.jsonl");
      await writeFile(target, endTurn);
      await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
      await mkdir(join(root, "project"));
      await symlink(target, path);
      await handleObservedAgentHookEvent(sinks, event("Stop"));
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(received).toHaveLength(0);
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        kind: "agent",
        status: "processing",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("a late-created symlink inside the provider root retains its prompt boundary at Stop", async () => {
    await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
    await mkdir(join(root, "project"));
    const target = join(root, "project", "native.jsonl");
    await writeFile(target, endTurn);
    await symlink(target, path);
    await handleObservedAgentHookEvent(sinks, event("Stop"));
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 1500 });
    expect(aggregator.snapshot().activities[0]).toMatchObject({
      kind: "agent",
      status: "ready",
    });
  });

  it("a new prompt follows an existing link redirected to another transcript", async () => {
    await mkdir(join(root, "project"));
    const first = join(root, "project", "first.jsonl");
    const second = join(root, "project", "second.jsonl");
    await writeFile(first, '{"type":"summary"}\n');
    await writeFile(second, '{"type":"summary"}\n');
    await symlink(first, path);
    await handleObservedAgentHookEvent(sinks, event("PromptSubmit"));
    await unlink(path);
    await symlink(second, path);
    const nextTurn = "c11e160f-21fb-470b-98ac-9f709ba1b73d";
    await handleObservedAgentHookEvent(sinks, {
      ...event("PromptSubmit"),
      turnId: nextTurn,
    });
    await appendFile(second, endTurn);
    await handleObservedAgentHookEvent(sinks, {
      ...event("Stop"),
      turnId: nextTurn,
    });
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 1500 });
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      turnId: nextTurn,
    });
  });
});
