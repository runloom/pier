import { appendFileSync, utimesSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AgentHookEventPayload,
  type AgentHookEventPayloadV1,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCursorTranscriptLine,
  CURSOR_QUESTION_BACKFILL_MAX_AGE_MS,
  composeCursorQuestionPending,
  createCursorTranscriptReconciler,
  cursorQuestionInteractionId,
  findCursorAgentTranscript,
  isCursorMainAgentTranscriptPath,
  isCursorQuestionToolName,
  scanCursorQuestionState,
  viewportShowsCursorQuestion,
} from "../../../../../src/main/services/agents/integrations/transcript/cursor-reconciler.ts";
import { createForegroundActivityAggregator } from "../../../../../src/main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "../../../../../src/main/services/foreground-activity/types.ts";

const SESSION_ID = "a5ff8ad2-73ea-49e9-811a-c81934880086";
const TRANSCRIPT_WAIT_MS = 5000;

function waitForTranscript(
  assertion: () => void,
  timeout = TRANSCRIPT_WAIT_MS
): Promise<void> {
  return vi.waitFor(assertion, { timeout });
}

function userLine(text: string): string {
  return JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text }] },
  });
}

function assistantTextLine(text: string): string {
  return JSON.stringify({
    role: "assistant",
    message: { content: [{ type: "text", text }] },
  });
}

function questionLine(
  input: Record<string, unknown>,
  toolName = "AskQuestion"
): string {
  return JSON.stringify({
    role: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: toolName,
          input,
        },
      ],
    },
  });
}

function readLine(): string {
  return JSON.stringify({
    role: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Read", input: { path: "a.ts" } }],
    },
  });
}

function grepLine(): string {
  return JSON.stringify({
    role: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Grep",
          input: { path: "/tmp", pattern: "后续独立 spec" },
        },
      ],
    },
  });
}

function canvasQuestionInput(): Record<string, unknown> {
  return {
    title: "工作台 × Canvas 终态",
    questions: [
      {
        id: "workbench-fate",
        prompt:
          "当前 canvas 最不完整的一点：它把「给 Canvas 一份目录」当主交付，工作台网格与物料实现「另议」。金标准应该是哪种产品终态？",
      },
    ],
  };
}

const HOOK_INGEST: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

const TRANSCRIPT_INGEST: AgentEventIngestOptions = {
  evidenceSource: "transcript",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayloadV1 {
  return {
    agent: "cursor",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: SESSION_ID,
    windowId: "1",
    ...overrides,
    v: 1,
  };
}

describe("cursor question classifier", () => {
  it("detects Cursor TUI question chrome in viewport text", () => {
    expect(
      viewportShowsCursorQuestion(
        "Question 1 of 1\n1. 方案用哪一条？\n↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip"
      )
    ).toBe(true);
    expect(viewportShowsCursorQuestion("Read 4 files\nGrep pattern")).toBe(
      false
    );
  });

  it("lets a readable viewport override a stale jsonl AskQuestion", () => {
    expect(
      composeCursorQuestionPending({
        jsonlPending: true,
        viewportKnown: true,
        viewportPending: false,
      })
    ).toBe(false);
    expect(
      composeCursorQuestionPending({
        jsonlPending: false,
        viewportKnown: true,
        viewportPending: true,
      })
    ).toBe(true);
    expect(
      composeCursorQuestionPending({
        jsonlPending: true,
        viewportKnown: false,
        viewportPending: false,
      })
    ).toBe(true);
    expect(
      composeCursorQuestionPending({
        jsonlPending: false,
        viewportKnown: false,
        viewportPending: true,
      })
    ).toBe(true);
  });

  it("recognizes AskQuestion name variants and rejects Shell", () => {
    expect(isCursorQuestionToolName("AskQuestion")).toBe(true);
    expect(isCursorQuestionToolName("AskQuestions")).toBe(true);
    expect(isCursorQuestionToolName("ask_question")).toBe(true);
    expect(isCursorQuestionToolName("AskUserQuestion")).toBe(true);
    expect(isCursorQuestionToolName("ask-followup-question")).toBe(true);
    expect(isCursorQuestionToolName("Shell")).toBe(false);
    expect(isCursorQuestionToolName("QuestionnaireImport")).toBe(false);
  });

  it("marks pending on trailing AskQuestion", () => {
    const state = scanCursorQuestionState(
      [userLine("调研 canvas"), questionLine(canvasQuestionInput())].join("\n"),
      SESSION_ID
    );
    expect(state.pending).toBe(true);
    expect(state.generation).toBe(1);
  });

  it("clears pending on later Grep/Read — confirm writes no user row", () => {
    const state = scanCursorQuestionState(
      [
        userLine("调研 canvas"),
        questionLine(canvasQuestionInput()),
        grepLine(),
        readLine(),
      ].join("\n"),
      SESSION_ID
    );
    expect(state.pending).toBe(false);
  });

  it("clears pending on later assistant text", () => {
    const state = scanCursorQuestionState(
      [
        questionLine(canvasQuestionInput()),
        assistantTextLine("按你的选择继续。"),
      ].join("\n"),
      SESSION_ID
    );
    expect(state.pending).toBe(false);
  });

  it("clears pending on a later user row", () => {
    const state = scanCursorQuestionState(
      [
        questionLine(canvasQuestionInput()),
        readLine(),
        userLine("选双宿主"),
      ].join("\n"),
      SESSION_ID
    );
    expect(state.pending).toBe(false);
  });

  it("re-opens waiting on the next trailing AskQuestion", () => {
    const state = scanCursorQuestionState(
      [
        questionLine(canvasQuestionInput()),
        grepLine(),
        questionLine({
          title: "下一步任务 · 第 2 题",
          questions: [{ id: "spec_family", prompt: "接的是哪一类已有 spec？" }],
        }),
      ].join("\n"),
      SESSION_ID
    );
    expect(state.pending).toBe(true);
    expect(state.generation).toBe(2);
  });

  it("ignores run_async questions", () => {
    const state = scanCursorQuestionState(
      questionLine({
        questions: [{ id: "a", prompt: "Any preference?" }],
        run_async: true,
      }),
      SESSION_ID
    );
    expect(state.pending).toBe(false);
  });

  it("ignores Claude type-keyed AskUserQuestion lines", () => {
    const claude = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: "AskUserQuestion",
            input: { questions: [{ question: "Pick one" }] },
          },
        ],
      },
    });
    const state = scanCursorQuestionState(claude, SESSION_ID);
    expect(state.pending).toBe(false);
  });

  it("does not emit a second request while one question is still open", () => {
    const state = { generation: 0, pending: false };
    const first = applyCursorTranscriptLine(
      state,
      questionLine(canvasQuestionInput()),
      SESSION_ID
    );
    const second = applyCursorTranscriptLine(
      state,
      questionLine({ title: "另一题", questions: [] }),
      SESSION_ID
    );
    expect(first?.pierEvent).toBe("InteractionRequested");
    expect(second).toBeNull();
    expect(state.generation).toBe(1);
  });

  it("resolves on later Grep then requests the next AskQuestion", () => {
    const state = { generation: 0, pending: false };
    const first = applyCursorTranscriptLine(
      state,
      questionLine(canvasQuestionInput()),
      SESSION_ID
    );
    const grep = applyCursorTranscriptLine(state, grepLine(), SESSION_ID);
    const second = applyCursorTranscriptLine(
      state,
      questionLine({
        title: "下一步任务 · 第 2 题",
        questions: [{ id: "spec_family", prompt: "接的是哪一类已有 spec？" }],
      }),
      SESSION_ID
    );
    expect(first?.pierEvent).toBe("InteractionRequested");
    expect(grep?.pierEvent).toBe("InteractionResolved");
    expect(second?.pierEvent).toBe("InteractionRequested");
    expect(state.generation).toBe(2);
    expect(state.pending).toBe(true);
  });

  it("builds a stable interaction id per generation", () => {
    expect(cursorQuestionInteractionId(SESSION_ID, 2)).toBe(
      `cq:${SESSION_ID}:2`
    );
  });
});

describe("cursor transcript path guards", () => {
  it("accepts only main conversation jsonl", () => {
    const main = `/tmp/projects/ws/agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`;
    expect(isCursorMainAgentTranscriptPath(main, SESSION_ID)).toBe(true);
    expect(
      isCursorMainAgentTranscriptPath(
        `/tmp/projects/ws/agent-transcripts/${SESSION_ID}/child.jsonl`,
        SESSION_ID
      )
    ).toBe(false);
  });

  it("finds the session file under a projects root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-cursor-projects-"));
    const path = join(
      root,
      "Users-xyz-ws",
      "agent-transcripts",
      SESSION_ID,
      `${SESSION_ID}.jsonl`
    );
    await mkdir(dirname(path), { recursive: true });
    writeFileSync(path, `${userLine("hi")}\n`);
    await expect(findCursorAgentTranscript(root, SESSION_ID)).resolves.toBe(
      path
    );
    await rm(root, { force: true, recursive: true });
  });
});

describe("cursor transcript reconciler", () => {
  let projectsRoot: string;
  let transcriptPath: string;

  beforeEach(async () => {
    vi.useRealTimers();
    projectsRoot = await mkdtemp(join(tmpdir(), "pier-cursor-projects-"));
    transcriptPath = join(
      projectsRoot,
      "Users-xyz-ws",
      "agent-transcripts",
      SESSION_ID,
      `${SESSION_ID}.jsonl`
    );
    await mkdir(dirname(transcriptPath), { recursive: true });
    writeFileSync(transcriptPath, `${userLine("start")}\n`);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectsRoot, { force: true, recursive: true });
  });

  it("treats viewport question chrome as waiting when jsonl has no AskQuestion", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
      readViewportText: () =>
        "Question 1 of 1\n↑/↓ option · Space select · Esc to skip",
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.some((event) => event.event === "InteractionRequested")
    ).toBe(true);
    reconciler.dispose();
  });

  it("clears waiting from a readable viewport even if jsonl still ends on AskQuestion", async () => {
    writeFileSync(
      transcriptPath,
      `${userLine("调研")}\n${questionLine(canvasQuestionInput())}\n`
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
      readViewportText: () => "Thinking...\nGrep pattern",
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.some((event) => event.event === "InteractionRequested")
    ).toBe(false);
    expect(
      received.some((event) => event.event === "InteractionResolved")
    ).toBe(false);
    reconciler.dispose();
  });

  it("polls viewport to wait when jsonl lags, then leaves waiting when chrome is gone", async () => {
    vi.useFakeTimers();
    const chrome =
      "Question 1 of 1\n↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip";
    let screen = "Thinking...";
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
      readViewportText: () => screen,
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.some((event) => event.event === "InteractionRequested")
    ).toBe(false);

    screen = chrome;
    await vi.advanceTimersByTimeAsync(250);
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);

    screen = "Thinking...\nGrep pattern";
    await vi.advanceTimersByTimeAsync(250);
    expect(
      received.filter((event) => event.event === "InteractionResolved")
    ).toHaveLength(1);
    reconciler.dispose();
    vi.useRealTimers();
  });

  it("drives FA waiting → processing across jsonl-lag appear and confirm", async () => {
    vi.useFakeTimers();
    const chrome =
      "Question 1 of 1\n↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip";
    let screen = "Thinking...";
    const agg = createForegroundActivityAggregator();
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => {
        agg.ingestAgentEvent(event, TRANSCRIPT_INGEST);
      },
      projectsRoot,
      readViewportText: () => screen,
    });
    agg.ingestAgentEvent(hookEvent({ event: "PromptSubmit" }), HOOK_INGEST);
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );

    screen = chrome;
    await vi.advanceTimersByTimeAsync(250);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    screen = "Thinking...\nGrep pattern";
    await vi.advanceTimersByTimeAsync(250);
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    reconciler.dispose();
    agg.dispose();
    vi.useRealTimers();
  });

  it("does not re-emit InteractionRequested on later viewport polls", async () => {
    vi.useFakeTimers();
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
      readViewportText: () =>
        "Question 1 of 1\n↑/↓ option · Space select · Esc to skip",
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);
    reconciler.dispose();
    vi.useRealTimers();
  });

  it("backfills a fresh trailing AskQuestion as InteractionRequested", async () => {
    writeFileSync(
      transcriptPath,
      `${userLine("调研")}\n${questionLine(canvasQuestionInput())}\n`
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent());
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      agent: "cursor",
      event: "InteractionRequested",
      interactionKind: "question",
      nativeEvent: "cursor.transcript.ask_question",
      panelId: "panel-1",
      toolName: "AskQuestion",
    });
    expect(agentHookEventSchema.safeParse(received[0]).success).toBe(true);
    reconciler.dispose();
  });

  it("keeps one question id when viewport appears before lagged jsonl", async () => {
    const chrome = "Question 1 of 1\n↑/↓ option · Space select · Esc to skip";
    let screen = chrome;
    const agg = createForegroundActivityAggregator();
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => {
        received.push(event);
        agg.ingestAgentEvent(event, TRANSCRIPT_INGEST);
      },
      projectsRoot,
      readViewportText: () => screen,
    });
    agg.ingestAgentEvent(hookEvent({ event: "PromptSubmit" }), HOOK_INGEST);
    await reconciler.observe(hookEvent({ transcriptPath }));
    const requested = received.filter(
      (event) => event.event === "InteractionRequested"
    );
    expect(requested).toHaveLength(1);
    const liveId =
      "interactionId" in requested[0]!
        ? requested[0]!.interactionId
        : undefined;
    expect(liveId).toBe(cursorQuestionInteractionId(SESSION_ID, 1));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "waiting"
    );

    appendFileSync(transcriptPath, `${questionLine(canvasQuestionInput())}\n`);
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);
    expect(
      received.filter((event) => event.event === "InteractionResolved")
    ).toHaveLength(0);

    screen = "Thinking...\nGrep pattern";
    await waitForTranscript(() => {
      expect(
        received.filter((event) => event.event === "InteractionResolved")
      ).toHaveLength(1);
    });
    expect(
      received.find((event) => event.event === "InteractionResolved")
    ).toMatchObject({ interactionId: liveId });
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    reconciler.dispose();
    agg.dispose();
  });

  it("rekeys viewport watch after transferPanelOwnership", async () => {
    vi.useFakeTimers();
    const chrome = "Question 1 of 1\n↑/↓ option · Space select · Esc to skip";
    let screen = chrome;
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
      readViewportText: () => screen,
    });
    await reconciler.observe(hookEvent({ transcriptPath, windowId: "1" }));
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);
    reconciler.transferPanelOwnership({
      panelId: "panel-1",
      sourceWindowId: "1",
      targetWindowId: "2",
    });
    screen = "Thinking...\nGrep pattern";
    await vi.advanceTimersByTimeAsync(250);
    const resolved = received.filter(
      (event) => event.event === "InteractionResolved"
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ windowId: "2" });
    reconciler.dispose();
    vi.useRealTimers();
  });

  it("does not backfill a stale pending question", async () => {
    writeFileSync(transcriptPath, `${questionLine(canvasQuestionInput())}\n`);
    const stale =
      (Date.now() - CURSOR_QUESTION_BACKFILL_MAX_AGE_MS - 60_000) / 1000;
    utimesSync(transcriptPath, stale, stale);
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent());
    expect(received).toHaveLength(0);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("resolves after confirm continuation (Grep), then waits on the next question", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    appendFileSync(transcriptPath, `${questionLine(canvasQuestionInput())}\n`);
    await waitForTranscript(() => {
      expect(
        received.some((event) => event.event === "InteractionRequested")
      ).toBe(true);
    });
    appendFileSync(transcriptPath, `${grepLine()}\n`);
    await waitForTranscript(() => {
      expect(
        received.some((event) => event.event === "InteractionResolved")
      ).toBe(true);
    });
    appendFileSync(
      transcriptPath,
      `${questionLine({
        title: "下一步任务 · 第 2 题",
        questions: [{ id: "spec_family", prompt: "接的是哪一类已有 spec？" }],
      })}\n`
    );
    await waitForTranscript(() => {
      expect(
        received.filter((event) => event.event === "InteractionRequested")
      ).toHaveLength(2);
    });
    const resolved = received.find(
      (event) => event.event === "InteractionResolved"
    );
    expect(resolved).toMatchObject({
      interactionKind: "question",
      interactionOutcome: "completed",
    });
    reconciler.dispose();
  });

  it("keeps waiting when Stop fires but AskQuestion is still trailing", async () => {
    writeFileSync(transcriptPath, `${questionLine(canvasQuestionInput())}\n`);
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.filter((event) => event.event === "InteractionRequested")
    ).toHaveLength(1);
    await reconciler.observe(
      hookEvent({ event: "TurnInterrupted", transcriptPath })
    );
    expect(
      received.filter((event) => event.event === "InteractionResolved")
    ).toHaveLength(0);
    expect(received.at(-1)).toMatchObject({
      event: "InteractionRequested",
      interactionKind: "question",
    });
    reconciler.dispose();
  });

  it("cancels a pending question on SessionEnd", async () => {
    writeFileSync(transcriptPath, `${questionLine(canvasQuestionInput())}\n`);
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath }));
    expect(
      received.some((event) => event.event === "InteractionRequested")
    ).toBe(true);
    await reconciler.observe(
      hookEvent({ event: "SessionEnd", transcriptPath })
    );
    expect(
      received.filter((event) => event.event === "InteractionResolved")
    ).toHaveLength(1);
    expect(
      received.find((event) => event.event === "InteractionResolved")
    ).toMatchObject({ interactionOutcome: "cancelled" });
    reconciler.dispose();
  });

  it("ignores a child transcript path", async () => {
    const child = join(
      projectsRoot,
      "Users-xyz-ws",
      "agent-transcripts",
      SESSION_ID,
      "child.jsonl"
    );
    writeFileSync(child, `${questionLine(canvasQuestionInput())}\n`);
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCursorTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      projectsRoot,
    });
    await reconciler.observe(hookEvent({ transcriptPath: child }));
    expect(received).toHaveLength(0);
    reconciler.dispose();
  });
});
