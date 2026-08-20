import { realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { noteCursorLastTerminalBackfill } from "./cursor-last-terminal.ts";
import {
  applyCursorTranscriptLine,
  CURSOR_QUESTION_BACKFILL_MAX_AGE_MS,
  type CursorInteractionKind,
  type CursorQuestionScanState,
  composeCursorQuestionPending,
  cursorClosingHookEvent,
  cursorInteractionGenerationOf,
  cursorInteractionId,
  cursorInteractionKindOf,
  cursorInteractionToolName,
  cursorTranscriptScopeKey,
  defaultCursorProjectsRoot,
  readCursorTranscriptTail,
  requestedCursorInteraction,
  resolvedCursorInteraction,
  scanCursorQuestionState,
} from "./cursor-question.ts";
import {
  type CursorBoundTranscript,
  cursorTranscriptObserveTarget,
  isStaleCursorSessionEnd,
  nextCursorBoundTranscript,
  resolveCursorMainTranscriptPath,
} from "./cursor-transcript-bind.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import {
  createTranscriptTailReconciler,
  type TranscriptTailReconciler,
  type TranscriptTerminalRecord,
} from "./tail-reconciler.ts";
import { createViewportKindCache } from "./viewport-kind-cache.ts";

export type CursorTranscriptReconciler = TranscriptTailReconciler;
export type { CursorQuestionScanState } from "./cursor-question.ts";
export {
  applyCursorTranscriptLine,
  CURSOR_QUESTION_BACKFILL_MAX_AGE_MS,
  CURSOR_TRANSCRIPT_INTERACTION_EVIDENCE,
  CURSOR_TRANSCRIPT_TERMINAL_EVIDENCE,
  composeCursorQuestionPending,
  cursorQuestionInteractionId,
  defaultCursorProjectsRoot,
  findCursorAgentTranscript,
  isCursorMainAgentTranscriptPath,
  isCursorPlanToolName,
  isCursorQuestionToolName,
  scanCursorQuestionState,
  viewportShowsCursorInteraction,
  viewportShowsCursorPlan,
  viewportShowsCursorQuestion,
} from "./cursor-question.ts";

interface CursorTranscriptReconcilerOpts {
  onTerminalEvent: Parameters<
    typeof createTranscriptTailReconciler
  >[0]["onTerminalEvent"];
  projectsRoot?: string;
  readViewportText?: (panelId: string, windowId: string) => string | null;
}

interface PendingInteraction {
  generation: number;
  kind: CursorInteractionKind;
  sessionId: string;
}

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
  const pendingByScope = new Map<string, PendingInteraction>();
  const jsonlPendingByScope = new Map<string, boolean>();
  const viewportPendingByScope = new Map<string, boolean>();
  const viewportTimers = new Map<string, ReturnType<typeof setInterval>>();
  const lastContextByScope = new Map<string, AgentHookEventPayload>();
  const lastTerminalSeenByScope = new Map<string, string>();
  const boundTranscriptByScope = new Map<string, CursorBoundTranscript>();
  const viewportKindCache = createViewportKindCache();

  const emitResolved = (
    context: AgentHookEventPayload,
    pending: PendingInteraction,
    outcome: "completed" | "cancelled"
  ): void => {
    emitTranscriptEvent(
      {
        contextsByTurnId: new Map(),
        pendingRecords: [],
        seenTerminalEvents: new Set(),
        seenTranscriptEvents: new Set(),
      },
      {
        ...context,
        sessionId: pending.sessionId,
        toolName: cursorInteractionToolName(pending.kind),
      },
      resolvedCursorInteraction(
        pending.kind,
        pending.sessionId,
        pending.generation,
        outcome
      ),
      opts.onTerminalEvent
    );
  };

  const emit = (event: AgentHookEventPayload): void => {
    const key = cursorTranscriptScopeKey(event);
    if (event.event === "InteractionRequested") {
      const latest = lastContextByScope.get(key);
      if (latest && opts.readViewportText) {
        const text = opts.readViewportText(latest.panelId, latest.windowId);
        if (text != null && viewportKindCache.kindFor(key, text) === null) {
          return;
        }
      }
      const generation = cursorInteractionGenerationOf(event);
      const kind = cursorInteractionKindOf(event);
      const sessionId =
        event.sessionId?.trim() ||
        pendingByScope.get(key)?.sessionId ||
        "viewport";
      const current = pendingByScope.get(key);
      const nextId = cursorInteractionId(kind, sessionId, generation);
      if (
        current &&
        cursorInteractionId(
          current.kind,
          current.sessionId,
          current.generation
        ) === nextId
      ) {
        return;
      }
      if (current) {
        emitResolved(event, current, "completed");
      }
      pendingByScope.set(key, { generation, kind, sessionId });
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
        ? { ...seed }
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
    const interactive =
      record.pierEvent === "InteractionRequested" ||
      record.pierEvent === "InteractionResolved";
    emitTranscriptEvent(
      {
        contextsByTurnId: new Map(),
        pendingRecords: [],
        seenTerminalEvents: new Set(),
        seenTranscriptEvents: new Set(),
      },
      {
        ...context,
        toolName: interactive
          ? cursorInteractionToolName(
              record.interactionKind === "permission" ? "plan" : "question"
            )
          : context.toolName,
      },
      record,
      emit
    );
  };

  const closePending = (
    context: AgentHookEventPayload,
    outcome: "completed" | "cancelled"
  ): void => {
    const pending = pendingByScope.get(cursorTranscriptScopeKey(context));
    if (!pending) {
      return;
    }
    emitRecord(
      { ...context, sessionId: pending.sessionId },
      resolvedCursorInteraction(
        pending.kind,
        pending.sessionId,
        pending.generation,
        outcome
      )
    );
  };

  const readViewportState = (context: AgentHookEventPayload) => {
    const key = cursorTranscriptScopeKey(context);
    const text = opts.readViewportText?.(context.panelId, context.windowId);
    if (text == null) {
      return {
        known: false,
        kind: null,
        pending: viewportPendingByScope.get(key) === true,
      };
    }
    const kind = viewportKindCache.kindFor(key, text);
    viewportPendingByScope.set(key, kind !== null);
    return { known: true, kind, pending: kind !== null };
  };

  const syncPendingQuestion = (
    context: AgentHookEventPayload,
    sessionId: string,
    scanned: CursorQuestionScanState,
    fresh: boolean
  ): boolean => {
    const key = cursorTranscriptScopeKey(context);
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
      const kind: CursorInteractionKind = jsonlPending
        ? (scanned.kind ?? current?.kind ?? "question")
        : (viewport.kind ?? current?.kind ?? "question");
      if (
        current &&
        current.generation === generation &&
        current.kind === kind &&
        current.sessionId === sessionId
      ) {
        return pending;
      }
      emitRecord(
        context,
        requestedCursorInteraction(kind, sessionId, generation)
      );
      return pending;
    }
    if (current) {
      emitRecord(
        { ...context, sessionId: current.sessionId },
        resolvedCursorInteraction(
          current.kind,
          current.sessionId,
          current.generation,
          "completed"
        )
      );
    }
    return pending;
  };

  const syncFromViewport = (context: AgentHookEventPayload): void => {
    const key = cursorTranscriptScopeKey(context);
    const current = pendingByScope.get(key);
    const sessionId =
      context.sessionId?.trim() ||
      attachSeed.get(context.transcriptPath ?? "")?.sessionId ||
      "viewport";
    const scanned: CursorQuestionScanState = jsonlPendingByScope.get(key)
      ? {
          generation: current?.generation ?? 1,
          kind: current?.kind,
          pending: true,
        }
      : { generation: 0, pending: false };
    syncPendingQuestion(context, sessionId, scanned, true);
  };

  const startViewportWatch = (context: AgentHookEventPayload): void => {
    if (!opts.readViewportText) {
      return;
    }
    const key = cursorTranscriptScopeKey(context);
    lastContextByScope.set(key, context);
    if (viewportTimers.has(key)) {
      return;
    }
    const timer = setInterval(() => {
      const latest = lastContextByScope.get(key);
      if (latest) {
        syncFromViewport(latest);
      }
    }, 250);
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
    lastTerminalSeenByScope.delete(key);
    boundTranscriptByScope.delete(key);
    viewportKindCache.clear(key);
  };

  return {
    dispose: () => {
      for (const key of [...viewportTimers.keys()]) {
        stopViewportWatch(key);
      }
      pathCache.clear();
      attachSeed.clear();
      pendingByScope.clear();
      lastTerminalSeenByScope.clear();
      boundTranscriptByScope.clear();
      viewportKindCache.clearAll();
      inner.dispose();
    },
    observe: async (event) => {
      if (event.agent !== "cursor") {
        return;
      }
      const scopeKey = cursorTranscriptScopeKey(event);
      if (
        isStaleCursorSessionEnd(boundTranscriptByScope.get(scopeKey), event)
      ) {
        return;
      }
      if (event.event === "SessionEnd") {
        closePending(event, "cancelled");
        stopViewportWatch(scopeKey);
        await inner.observe(event);
        return;
      }
      startViewportWatch(event);
      const resolved = await resolveCursorMainTranscriptPath({
        event,
        pathCache,
        projectsRoot,
      });
      const nextBound = nextCursorBoundTranscript({
        bound: boundTranscriptByScope.get(scopeKey),
        event,
        resolvedPath: resolved,
      });
      if (nextBound) {
        boundTranscriptByScope.set(scopeKey, nextBound);
      }
      const target = cursorTranscriptObserveTarget({
        bound: boundTranscriptByScope.get(scopeKey),
        event,
        resolvedPath: resolved,
      });
      if (!target) {
        if (cursorClosingHookEvent(event.event)) {
          closePending(event, "cancelled");
          await inner.observe(event);
        }
        return;
      }
      const sessionId = target.sessionId || basename(target.path, ".jsonl");
      const fileStat = await stat(target.path).catch(() => null);
      const text = await readCursorTranscriptTail(target.path);
      const scanned = text
        ? scanCursorQuestionState(text, sessionId)
        : { generation: 0, pending: false };
      const fresh =
        fileStat !== null &&
        Date.now() - fileStat.mtimeMs <= CURSOR_QUESTION_BACKFILL_MAX_AGE_MS;
      const seed = { ...scanned, sessionId };
      attachSeed.set(target.path, seed);
      attachSeed.set(
        await realpath(target.path).catch(() => target.path),
        seed
      );
      await inner.observe({
        ...event,
        sessionId,
        transcriptPath: target.path,
      });
      const waiting = syncPendingQuestion(event, sessionId, scanned, fresh);
      const backfill = noteCursorLastTerminalBackfill({
        eventName: event.event,
        fresh,
        resolvedPath: target.path,
        scanned,
        seenByScope: lastTerminalSeenByScope,
        scopeKey,
        waiting,
      });
      if (backfill) {
        emitRecord({ ...event, sessionId }, backfill);
      }
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
      move(lastTerminalSeenByScope);
      move(boundTranscriptByScope);
      viewportKindCache.rekey(sourceKey, targetKey);
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
