import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranscriptTailReconciler } from "../../../../../src/main/services/agents/integrations/transcript/tail-reconciler.ts";
import { shouldDropStaleEmptyTurnTerminal } from "../../../../../src/main/services/agents/integrations/transcript/tail-watermark.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mockedStat = vi.fn(actual.stat);
  return {
    ...actual,
    default: { ...actual, stat: mockedStat },
    stat: mockedStat,
  };
});

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

  it.each([
    ["bound", "session-new", 1],
    ["pending", "session-new", 1],
    ["bound", "session-1", 2],
    ["pending", "session-1", 2],
  ] as const)("a stale SessionEnd cannot release a %s watch for %s generation %s", async (phase, sessionId, spawnGeneration) => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) =>
        line.includes("turn_ended")
          ? {
              nativeEvent: "kimi.wire.TurnEnd",
              pierEvent: "TurnCompleted",
              turnId: "",
            }
          : null,
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    try {
      const oldEvent = {
        ...promptEvent(path),
        event: "PromptSubmit" as const,
        nativeEvent: "PromptSubmit",
        spawnGeneration: 1,
        v: 3 as const,
      };
      await reconciler.observe(oldEvent);
      const pending = reconciler.observe({
        ...oldEvent,
        sessionId,
        spawnGeneration,
      });
      if (phase === "bound") await pending;

      await reconciler.observe({ ...oldEvent, event: "SessionEnd" });
      await pending;
      appendFileSync(path, emptyTurnLine());

      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toMatchObject({ event: "TurnCompleted", sessionId });
    } finally {
      reconciler.dispose();
    }
  });

  it.each([
    "old",
    "current",
    "transfer",
    "panel",
    "window",
    "matching-panels",
    "dispose",
  ])("handles %s lifecycle events during the prompt watermark read", async (ending) => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) =>
        line.includes("turn_ended")
          ? {
              nativeEvent: "kimi.wire.TurnEnd",
              pierEvent: "TurnCompleted",
              turnId: "",
            }
          : null,
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    try {
      await reconciler.observe(promptEvent(path));
      const currentStats = await stat(path);
      vi.mocked(stat).mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        return currentStats;
      });
      const nextEvent = { ...promptEvent(path), sessionId: "session-new" };
      const pending = reconciler.observe(nextEvent);
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error(
            "observation completed without entering the stat gate"
          );
        }),
      ]);
      await reconciler.observe({ ...nextEvent, event: "ToolStart" });
      if (ending === "transfer") {
        reconciler.transferPanelOwnership({
          panelId: "panel-1",
          sourceWindowId: "1",
          targetWindowId: "2",
        });
      } else if (ending === "panel") {
        reconciler.releasePanel("panel-1", "1");
      } else if (ending === "window") {
        reconciler.releaseWindow("1");
      } else if (ending === "matching-panels") {
        reconciler.releasePanelsWhere(
          (panelId, windowId) => panelId === "panel-1" && windowId === "1"
        );
      } else if (ending === "dispose") {
        reconciler.dispose();
      } else {
        await reconciler.observe({ ...promptEvent(path), event: "SessionEnd" });
        if (ending === "current") {
          await reconciler.observe({ ...nextEvent, event: "SessionEnd" });
        }
      }
      resume.resolve();
      await pending;
      appendFileSync(path, emptyTurnLine());
      if (ending !== "old" && ending !== "transfer") {
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(received).toHaveLength(0);
      } else {
        await vi.waitFor(() => expect(received).toHaveLength(1));
        expect(received[0]?.sessionId).toBe("session-new");
        expect(received[0]?.windowId).toBe(ending === "transfer" ? "2" : "1");
      }
    } finally {
      resume.resolve();
      reconciler.dispose();
    }
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

  it.each([
    "ToolStart",
    "ToolComplete",
    "processing",
  ] as const)("preserves the prompt watermark when %s overlaps its stat read", async (progress) => {
    const received: AgentHookEventPayload[] = [];
    const readLines: string[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) => {
        readLines.push(line);
        return line.includes("turn_ended")
          ? {
              nativeEvent: "kimi.wire.TurnEnd",
              pierEvent: "TurnCompleted",
              turnId: "",
            }
          : null;
      },
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    try {
      await reconciler.observe(sessionStart(path));
      await vi.waitFor(() => expect(readLines).toHaveLength(1));
      appendFileSync(path, emptyTurnLine());
      const currentStats = await stat(path);
      vi.mocked(stat).mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        return currentStats;
      });
      const pending = reconciler.observe(promptEvent(path));
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error(
            "observation completed without entering the stat gate"
          );
        }),
      ]);
      await reconciler.observe({
        ...promptEvent(path),
        event: progress,
        toolName: "current-tool",
      });
      // Let the real file watcher run as well as the overlapping observation.
      if (progress === "ToolStart") {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      resume.resolve();
      await pending;
      await vi.waitFor(() => expect(readLines).toHaveLength(2));
      expect(received).toHaveLength(0);

      appendFileSync(path, emptyTurnLine());
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toMatchObject({
        event: "TurnCompleted",
        sessionId: "session-1",
        toolName: "current-tool",
      });
    } finally {
      resume.resolve();
      reconciler.dispose();
    }
  });

  it("a superseded prompt cannot overwrite a newer prompt's watermark or owner", async () => {
    const received: AgentHookEventPayload[] = [];
    const readLines: string[] = [];
    const reconciler = createTranscriptTailReconciler({
      agent: "kimi",
      classifyLine: (line) => {
        readLines.push(line);
        return line.includes("turn_ended")
          ? {
              nativeEvent: "kimi.wire.TurnEnd",
              pierEvent: "TurnCompleted",
              turnId: "",
            }
          : null;
      },
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    try {
      await reconciler.observe(sessionStart(path));
      await vi.waitFor(() => expect(readLines).toHaveLength(1));
      const currentStats = await stat(path);
      vi.mocked(stat).mockImplementationOnce(async () => {
        entered.resolve();
        await resume.promise;
        return currentStats;
      });
      const pending = reconciler.observe(promptEvent(path));
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error(
            "observation completed without entering the stat gate"
          );
        }),
      ]);
      await reconciler.observe({ ...promptEvent(path), event: "ToolStart" });
      appendFileSync(path, emptyTurnLine());
      await reconciler.observe(promptEvent(path, "turn-3"));
      await reconciler.observe({
        ...promptEvent(path, "turn-3"),
        event: "ToolStart",
        toolName: "newer-tool",
      });
      resume.resolve();
      await pending;
      await vi.waitFor(() => expect(readLines).toHaveLength(2));
      expect(received).toHaveLength(0);

      appendFileSync(path, emptyTurnLine());
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]?.toolName).toBe("newer-tool");
    } finally {
      resume.resolve();
      reconciler.dispose();
    }
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
