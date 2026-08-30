import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranscriptTailReconciler } from "../../../../../src/main/services/agents/integrations/transcript/tail-reconciler.ts";
import { shouldDropStaleEmptyTurnTerminal } from "../../../../../src/main/services/agents/integrations/transcript/tail-watermark.ts";

function promptEvent(
  transcriptPath: string,
  turnId = "turn-2"
): AgentHookEventPayload {
  return {
    agent: "kimi",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    transcriptPath,
    turnId,
    v: 1,
    windowId: "1",
  };
}

function sessionStart(transcriptPath: string): AgentHookEventPayload {
  return {
    ...promptEvent(transcriptPath, "turn-1"),
    event: "SessionStart",
  };
}

function emptyTurnLine(): string {
  return `${JSON.stringify({ type: "turn_ended", status: "success" })}\n`;
}

describe("shouldDropStaleEmptyTurnTerminal", () => {
  it("drops empty-turn terminals at or before the PromptSubmit watermark", () => {
    const record = {
      nativeEvent: "kimi.wire.TurnEnd",
      pierEvent: "TurnCompleted" as const,
      turnId: "",
    };
    expect(
      shouldDropStaleEmptyTurnTerminal({
        lineEnd: 40,
        record,
        watermark: 40,
      })
    ).toBe(true);
    expect(
      shouldDropStaleEmptyTurnTerminal({
        lineEnd: 41,
        record,
        watermark: 40,
      })
    ).toBe(false);
    expect(
      shouldDropStaleEmptyTurnTerminal({
        lineEnd: 40,
        record: { ...record, turnId: "native-turn" },
        watermark: 40,
      })
    ).toBe(false);
    expect(
      shouldDropStaleEmptyTurnTerminal({
        lineEnd: 40,
        record,
        watermark: undefined,
      })
    ).toBe(false);
  });
});

describe("createTranscriptTailReconciler", () => {
  let dir: string;
  let transcriptRoot: string;
  let path: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-tail-reconciler-"));
    transcriptRoot = join(dir, "sessions");
    await mkdir(transcriptRoot);
    path = join(transcriptRoot, "wire.jsonl");
    writeFileSync(path, '{"ok":true}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("PromptSubmit 水位丢弃空 turnId 旧终态，水位之后的新行仍派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) => {
        if (!line.includes("turn_ended")) {
          return null;
        }
        return {
          nativeEvent: "kimi.wire.TurnEnd",
          pierEvent: "TurnCompleted",
          turnId: "",
        };
      },
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(sessionStart(path));
    appendFileSync(path, emptyTurnLine());
    await reconciler.observe(promptEvent(path));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(received).toHaveLength(0);
    appendFileSync(path, emptyTurnLine());
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });

  it("文件截断后清空 PromptSubmit 水位，新终态仍派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) => {
        if (!line.includes("turn_ended")) {
          return null;
        }
        return {
          nativeEvent: "kimi.wire.TurnEnd",
          pierEvent: "TurnCompleted",
          turnId: "",
        };
      },
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(promptEvent(path));
    appendFileSync(path, emptyTurnLine());
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    writeFileSync(path, "");
    await new Promise((resolve) => setTimeout(resolve, 400));
    appendFileSync(path, emptyTurnLine());
    await vi.waitFor(() => {
      expect(received).toHaveLength(2);
    });
    reconciler.dispose();
  });

  it("drain 结束后 pending 残留会继续消费后续行", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) => {
        if (!line.includes("turn_ended")) {
          return null;
        }
        return {
          nativeEvent: "kimi.wire.TurnEnd",
          pierEvent: "TurnCompleted",
          turnId: "",
        };
      },
      onTerminalEvent: (event) => {
        received.push(event);
        if (received.length === 1) {
          queueMicrotask(() => {
            appendFileSync(path, emptyTurnLine());
            reconciler
              .observe({
                ...promptEvent(path, "turn-3"),
                event: "processing",
              })
              .then(
                () => undefined,
                () => undefined
              );
          });
        }
      },
      transcriptRoot,
    });
    await reconciler.observe(promptEvent(path, "turn-1"));
    appendFileSync(path, emptyTurnLine());
    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThanOrEqual(1);
    });
    await vi.waitFor(() => {
      expect(received.length).toBeGreaterThanOrEqual(2);
    });
    reconciler.dispose();
  });
});
