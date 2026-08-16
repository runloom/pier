import { open, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  applyCursorTranscriptLine,
  CURSOR_QUESTION_BACKFILL_MAX_AGE_MS,
  type CursorQuestionScanState,
  composeCursorQuestionPending,
  cursorQuestionInteractionId,
  defaultCursorProjectsRoot,
  findCursorAgentTranscript,
  isCursorMainAgentTranscriptPath,
  requestedCursorQuestion,
  resolvedCursorQuestion,
  scanCursorQuestionState,
  viewportShowsCursorQuestion,
} from "./cursor-question.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";

export type CursorTranscriptReconciler = TranscriptTailReconciler;
export type { CursorQuestionScanState } from "./cursor-question.ts";
export {
  applyCursorTranscriptLine,
  CURSOR_QUESTION_BACKFILL_MAX_AGE_MS,
  CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE,
  composeCursorQuestionPending,
  cursorQuestionInteractionId,
  defaultCursorProjectsRoot,
  findCursorAgentTranscript,
  isCursorMainAgentTranscriptPath,
  isCursorQuestionToolName,
  scanCursorQuestionState,
  viewportShowsCursorQuestion,
} from "./cursor-question.ts";

const MAX_BACKFILL_BYTES = 1024 * 1024;

interface CursorTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  /** 默认 `~/.cursor/projects`。 */
  projectsRoot?: string;
  /** 读终端当前屏；缺省则只靠 jsonl。 */
  readViewportText?: (panelId: string, windowId: string) => string | null;
}

async function readTranscriptTail(
  path: string,
  maxBytes = MAX_BACKFILL_BYTES
): Promise<string | null> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }
  const start = Math.max(0, fileStat.size - maxBytes);
  const fd = await open(path, "r");
  try {
    const length = fileStat.size - start;
    const buffer = Buffer.alloc(length);
    const result = await fd.read(buffer, 0, length, start);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await fd.close();
  }
}

function isQuestionClosingEvent(event: string): boolean {
  return (
    event === "SessionEnd" ||
    event === "TurnCompleted" ||
    event === "TurnInterrupted" ||
    event === "error" ||
    event === "Stop"
  );
}

function scopeKey(event: AgentHookEventPayload): string {
  return `${event.windowId}\0${event.panelId}`;
}

/**
 * Cursor AskQuestion 对账器。
 *
 * AskQuestion 不走 preToolUse。jsonl 末条同步问卷 → waiting；确认后
 * Grep/Read 解除。jsonl 常晚于 TUI，同时认 viewport 问卷框。
 */
export function createCursorTranscriptReconciler(
  opts: CursorTranscriptReconcilerOpts
): CursorTranscriptReconciler {
  const projectsRoot = resolve(
    opts.projectsRoot ?? defaultCursorProjectsRoot()
  );
  const pathCache = new Map<string, string>();
  const attachSeed = new Map<
    string,
    CursorQuestionScanState & { sessionId: string }
  >();
  const pendingByScope = new Map<
    string,
    { generation: number; sessionId: string }
  >();
  const jsonlPendingByScope = new Map<string, boolean>();
  const viewportPendingByScope = new Map<string, boolean>();
  const viewportTimers = new Map<string, ReturnType<typeof setInterval>>();
  const lastContextByScope = new Map<string, AgentHookEventPayload>();

  const VIEWPORT_POLL_MS = 250;

  const questionGeneration = (event: AgentHookEventPayload): number => {
    if (!("interactionId" in event && event.interactionId)) {
      return 1;
    }
    const generation = Number(event.interactionId.split(":").at(-1));
    return Number.isFinite(generation) && generation > 0 ? generation : 1;
  };

  const emitResolved = (
    context: AgentHookEventPayload,
    sessionId: string,
    generation: number,
    outcome: "completed" | "cancelled"
  ): void => {
    emitTranscriptEvent(
      {
        contextsByTurnId: new Map(),
        pendingRecords: [],
        seenTerminalEvents: new Set(),
        seenTranscriptEvents: new Set(),
      },
      { ...context, sessionId, toolName: "AskQuestion" },
      resolvedCursorQuestion(sessionId, generation, outcome),
      opts.onTerminalEvent
    );
  };

  const emit = (event: AgentHookEventPayload): void => {
    const key = scopeKey(event);
    if (event.event === "InteractionRequested") {
      const latest = lastContextByScope.get(key);
      if (latest && opts.readViewportText) {
        const text = opts.readViewportText(latest.panelId, latest.windowId);
        if (text != null && !viewportShowsCursorQuestion(text)) {
          return;
        }
      }
      const generation = questionGeneration(event);
      const sessionId =
        event.sessionId?.trim() ||
        pendingByScope.get(key)?.sessionId ||
        "viewport";
      const current = pendingByScope.get(key);
      const nextId = cursorQuestionInteractionId(sessionId, generation);
      if (
        current &&
        cursorQuestionInteractionId(current.sessionId, current.generation) ===
          nextId
      ) {
        return;
      }
      if (current) {
        emitResolved(event, current.sessionId, current.generation, "completed");
      }
      pendingByScope.set(key, { generation, sessionId });
    }
    if (event.event === "InteractionResolved") {
      pendingByScope.delete(key);
    }
    opts.onTerminalEvent(event);
  };

  const inner = createTranscriptTailReconciler({
    agent: "cursor",
    createLineClassifier: (path) => {
      const seed = path ? attachSeed.get(path) : undefined;
      const sessionId = seed?.sessionId ?? "unknown";
      const state: CursorQuestionScanState = seed
        ? { generation: seed.generation, pending: seed.pending }
        : { generation: 0, pending: false };
      return (line) => applyCursorTranscriptLine(state, line, sessionId);
    },
    onTerminalEvent: emit,
    transcriptRoot: projectsRoot,
  });

  const emitRecord = (
    context: AgentHookEventPayload,
    record: TranscriptTerminalRecord
  ): void => {
    emitTranscriptEvent(
      {
        contextsByTurnId: new Map(),
        pendingRecords: [],
        seenTerminalEvents: new Set(),
        seenTranscriptEvents: new Set(),
      },
      { ...context, toolName: "AskQuestion" },
      record,
      emit
    );
  };

  const closePending = (
    context: AgentHookEventPayload,
    outcome: "completed" | "cancelled"
  ): void => {
    const pending = pendingByScope.get(scopeKey(context));
    if (!pending) {
      return;
    }
    emitRecord(
      { ...context, sessionId: pending.sessionId },
      resolvedCursorQuestion(pending.sessionId, pending.generation, outcome)
    );
  };

  const readViewportState = (
    context: AgentHookEventPayload
  ): { known: boolean; pending: boolean } => {
    const key = scopeKey(context);
    const text = opts.readViewportText?.(context.panelId, context.windowId);
    if (text == null) {
      return {
        known: false,
        pending: viewportPendingByScope.get(key) === true,
      };
    }
    const pending = viewportShowsCursorQuestion(text);
    viewportPendingByScope.set(key, pending);
    return { known: true, pending };
  };

  const syncPendingQuestion = (
    context: AgentHookEventPayload,
    sessionId: string,
    scanned: CursorQuestionScanState,
    fresh: boolean
  ): void => {
    const key = scopeKey(context);
    const jsonlPending = scanned.pending && fresh;
    jsonlPendingByScope.set(key, jsonlPending);
    const viewport = readViewportState(context);
    const pending = composeCursorQuestionPending({
      jsonlPending,
      viewportKnown: viewport.known,
      viewportPending: viewport.pending,
    });
    const current = pendingByScope.get(key);
    if (pending) {
      const generation = jsonlPending
        ? Math.max(scanned.generation, 1)
        : (current?.generation ?? 1);
      if (
        current &&
        current.generation === generation &&
        current.sessionId === sessionId
      ) {
        return;
      }
      emitRecord(context, requestedCursorQuestion(sessionId, generation));
      return;
    }
    if (current) {
      emitRecord(
        { ...context, sessionId: current.sessionId },
        resolvedCursorQuestion(
          current.sessionId,
          current.generation,
          "completed"
        )
      );
    }
  };

  const syncFromViewport = (context: AgentHookEventPayload): void => {
    const key = scopeKey(context);
    const sessionId =
      context.sessionId?.trim() ||
      attachSeed.get(context.transcriptPath ?? "")?.sessionId ||
      "viewport";
    const scanned = jsonlPendingByScope.get(key)
      ? { generation: pendingByScope.get(key)?.generation ?? 1, pending: true }
      : { generation: 0, pending: false };
    syncPendingQuestion(context, sessionId, scanned, true);
  };

  const startViewportWatch = (context: AgentHookEventPayload): void => {
    if (!opts.readViewportText) {
      return;
    }
    const key = scopeKey(context);
    lastContextByScope.set(key, context);
    if (viewportTimers.has(key)) {
      return;
    }
    const timer = setInterval(() => {
      const latest = lastContextByScope.get(key);
      if (latest) {
        syncFromViewport(latest);
      }
    }, VIEWPORT_POLL_MS);
    timer.unref();
    viewportTimers.set(key, timer);
    syncFromViewport(context);
  };

  const stopViewportWatch = (key: string): void => {
    const timer = viewportTimers.get(key);
    if (timer) {
      clearInterval(timer);
      viewportTimers.delete(key);
    }
    lastContextByScope.delete(key);
    viewportPendingByScope.delete(key);
    jsonlPendingByScope.delete(key);
  };

  const resolvePath = async (
    event: AgentHookEventPayload
  ): Promise<string | null> => {
    const sessionId = event.sessionId?.trim();
    const explicit = event.transcriptPath?.trim();
    if (explicit) {
      if (sessionId && !isCursorMainAgentTranscriptPath(explicit, sessionId)) {
        return null;
      }
      if (
        !(
          sessionId ||
          isCursorMainAgentTranscriptPath(
            explicit,
            basename(explicit, ".jsonl")
          )
        )
      ) {
        return null;
      }
      return explicit;
    }
    if (!sessionId) {
      return null;
    }
    const cached = pathCache.get(sessionId);
    if (cached) {
      const cachedStat = await stat(cached).catch(() => null);
      if (cachedStat?.isFile()) {
        return cached;
      }
      pathCache.delete(sessionId);
    }
    const resolved = await findCursorAgentTranscript(projectsRoot, sessionId);
    if (resolved) {
      pathCache.set(sessionId, resolved);
      if (pathCache.size > 256) {
        const first = pathCache.keys().next().value;
        if (first !== undefined) {
          pathCache.delete(first);
        }
      }
    }
    return resolved;
  };

  return {
    dispose: () => {
      for (const key of [...viewportTimers.keys()]) {
        stopViewportWatch(key);
      }
      pathCache.clear();
      attachSeed.clear();
      pendingByScope.clear();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "cursor") {
        return;
      }
      startViewportWatch(event);
      if (event.event === "SessionEnd") {
        closePending(event, "cancelled");
        stopViewportWatch(scopeKey(event));
        await inner.observe(event);
        return;
      }
      const resolved = await resolvePath(event);
      if (!resolved) {
        if (isQuestionClosingEvent(event.event)) {
          closePending(event, "cancelled");
          await inner.observe(event);
        }
        return;
      }
      const sessionId = event.sessionId?.trim() || basename(resolved, ".jsonl");
      const fileStat = await stat(resolved).catch(() => null);
      const text = await readTranscriptTail(resolved);
      const scanned = text
        ? scanCursorQuestionState(text, sessionId)
        : { generation: 0, pending: false };
      const fresh =
        fileStat !== null &&
        Date.now() - fileStat.mtimeMs <= CURSOR_QUESTION_BACKFILL_MAX_AGE_MS;
      attachSeed.set(resolved, { ...scanned, sessionId });
      await inner.observe({ ...event, transcriptPath: resolved });
      syncPendingQuestion(event, sessionId, scanned, fresh);
    },
    releasePanel: (panelId, windowId) => {
      for (const [key, context] of lastContextByScope) {
        if (
          context.panelId === panelId &&
          (windowId === undefined || context.windowId === windowId)
        ) {
          stopViewportWatch(key);
        }
      }
      inner.releasePanel(panelId, windowId);
    },
    releasePanelsWhere: (predicate) => {
      for (const [key, context] of lastContextByScope) {
        if (predicate(context.panelId, context.windowId)) {
          stopViewportWatch(key);
        }
      }
      inner.releasePanelsWhere(predicate);
    },
    releaseWindow: (windowId) => {
      for (const [key, context] of lastContextByScope) {
        if (context.windowId === windowId) {
          stopViewportWatch(key);
        }
      }
      inner.releaseWindow(windowId);
    },
    transferPanelOwnership: (input) => {
      const { panelId, sourceWindowId, targetWindowId } = input;
      if (
        panelId.trim().length === 0 ||
        sourceWindowId.trim().length === 0 ||
        targetWindowId.trim().length === 0 ||
        sourceWindowId === targetWindowId
      ) {
        inner.transferPanelOwnership(input);
        return;
      }
      const sourceKey = `${sourceWindowId}\0${panelId}`;
      const targetKey = `${targetWindowId}\0${panelId}`;
      const move = <T>(map: Map<string, T>): T | undefined => {
        const value = map.get(sourceKey);
        if (value === undefined) {
          return;
        }
        map.delete(sourceKey);
        map.set(targetKey, value);
        return value;
      };
      const timer = viewportTimers.get(sourceKey);
      if (timer) {
        clearInterval(timer);
        viewportTimers.delete(sourceKey);
      }
      move(pendingByScope);
      move(jsonlPendingByScope);
      move(viewportPendingByScope);
      const context = move(lastContextByScope);
      if (context) {
        lastContextByScope.set(targetKey, {
          ...context,
          windowId: targetWindowId,
        });
      }
      inner.transferPanelOwnership(input);
      const moved = lastContextByScope.get(targetKey);
      if (moved && timer) {
        startViewportWatch(moved);
      }
    },
  };
}
