import { type Stats, unwatchFile, watchFile } from "node:fs";
import { resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  continuesPendingPrompt,
  matchesEndedSession,
  type PendingTranscriptObservation,
} from "./observation-scope.ts";
import type {
  TranscriptTailReconciler,
  TranscriptTailReconcilerConfig,
} from "./tail-contracts.ts";
import { createTranscriptDrainScheduler } from "./tail-drain.ts";
import {
  fileIdentity,
  MAX_READ_BYTES,
  type TranscriptEntry,
} from "./tail-entry.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import {
  type ResolvedTranscriptPath,
  resolveTranscriptPath,
  selectObservedTranscriptPath,
  statTranscriptFile,
} from "./tail-path.ts";
import {
  dropPromptWatermarks,
  movePromptWatermark,
  recordPromptWatermark,
} from "./tail-watermark.ts";

export type {
  TranscriptTailReconciler,
  TranscriptTailReconcilerConfig,
  TranscriptTerminalRecord,
} from "./tail-contracts.ts";
export type {
  TranscriptTitleListener,
  TranscriptTitleRecord,
} from "./title-routing.ts";

const POLL_INTERVAL_MS = 250;
const MAX_TRANSCRIPTS = 32;
const MAX_TURN_CONTEXTS = 64;
const MAX_PENDING_OBSERVATIONS = 64;
interface PendingObservation extends PendingTranscriptObservation {
  retry?: (() => Promise<void>) | undefined;
}

/**
 * Agent transcript 尾读终态对账核心（agent 私有适配器共用的机械层）。
 *
 * 职责边界：只把适配器分类出的完成 / 中断 / 失败可信终态
 * 回投聚合器，不把 transcript 当工具、processing 或 permission 状态的
 * 权威源。格式知识全部在各适配器的 classifyLine 内；格式变化时静默失效，
 * hook 与 PTY 退出兜底仍然有效。
 */
export function createTranscriptTailReconciler(
  config: TranscriptTailReconcilerConfig
): TranscriptTailReconciler {
  const entries = new Map<string, TranscriptEntry>();
  const entryCreations = new Map<string, Promise<TranscriptEntry | null>>();
  const pendingScopeTokens = new Map<string, PendingObservation>();
  const transcriptRoot = resolve(config.transcriptRoot);
  let disposed = false;
  let retryQueued = false;

  function retryWaitingObservations(): void {
    if (disposed || retryQueued) return;
    retryQueued = true;
    queueMicrotask(() => {
      retryQueued = false;
      if (disposed) return;
      for (const token of pendingScopeTokens.values()) {
        const retry = token.retry;
        if (!retry) continue;
        token.retry = undefined;
        retry().catch(() => {
          const key = scopeKey(token.event);
          if (pendingScopeTokens.get(key) === token)
            pendingScopeTokens.delete(key);
        });
      }
    });
  }

  function atCapacity(): boolean {
    return (
      new Set([...entries.keys(), ...entryCreations.keys()]).size >=
      MAX_TRANSCRIPTS
    );
  }

  function createEntryLineClassifier(path: string) {
    const classifyLine =
      config.createLineClassifier?.(path) ?? config.classifyLine;
    if (!classifyLine) {
      throw new Error("transcript reconciler requires a line classifier");
    }
    return classifyLine;
  }

  const scheduleDrain = createTranscriptDrainScheduler({
    config,
    createLineClassifier: createEntryLineClassifier,
    isDisposed: () => disposed,
    hasPendingPrompt: (path) =>
      [...pendingScopeTokens.values()].some(
        (pending) => pending.prompt && pending.path === path
      ),
    isCurrentEntry: (path, entry) => entries.get(path) === entry,
  });

  function disposeEntry(path: string, entry: TranscriptEntry): void {
    // A newer conversation may already be binding this file while the old
    // owner ends. Its pending observation still needs this watcher.
    if (
      [...pendingScopeTokens.values()].some((pending) => pending.path === path)
    ) {
      return;
    }
    if (entries.get(path) === entry) {
      entry.disposed = true;
      entry.classifyLine = null;
      entry.pendingRecords.length = 0;
      if (entry.retryTimer) clearTimeout(entry.retryTimer);
      unwatchFile(path, entry.watcher);
      entries.delete(path);
      retryWaitingObservations();
    }
  }

  const scopeKey = (event: AgentHookEventPayload): string =>
    `${event.windowId}\0${event.panelId}`;

  function releaseScope(
    panelId: string,
    windowId?: string,
    endedSession?: AgentHookEventPayload
  ): void {
    const matches = (context: AgentHookEventPayload): boolean =>
      context.panelId === panelId &&
      (windowId === undefined || context.windowId === windowId) &&
      (!endedSession || matchesEndedSession(context, endedSession));
    for (const [key, pending] of pendingScopeTokens) {
      if (matches(pending.event)) {
        pendingScopeTokens.delete(key);
      }
    }
    for (const [path, entry] of entries) {
      const releasedKeys = new Set<string>();
      for (const [key, context] of entry.owners) {
        if (matches(context)) {
          entry.owners.delete(key);
          releasedKeys.add(key);
        }
      }
      for (const [turnId, context] of entry.contextsByTurnId) {
        if (matches(context)) {
          entry.contextsByTurnId.delete(turnId);
        }
      }
      for (const key of releasedKeys) {
        entry.lastTitleByScope.delete(key);
      }
      dropPromptWatermarks(
        entry.promptWatermarkByScope,
        releasedKeys,
        entry.promptFileIdentityByScope
      );
      if (entry.owners.size === 0) disposeEntry(path, entry);
      else scheduleDrain(path, entry);
    }
  }

  async function createEntry(
    resolution: ResolvedTranscriptPath
  ): Promise<TranscriptEntry | null> {
    const { path: canonicalPath, missing, root } = resolution;
    if (atCapacity()) {
      return null;
    }
    const initial = await statTranscriptFile(canonicalPath);
    if (disposed || initial === null || (initial && !initial.isFile())) {
      return null;
    }
    const watcher = (): void => {
      const current = entries.get(canonicalPath);
      if (current) {
        scheduleDrain(canonicalPath, current);
      }
    };
    const entry: TranscriptEntry = {
      classifyLine: createEntryLineClassifier(canonicalPath),
      contextsByTurnId: new Map(),
      disposed: false,
      initialScanEnd: missing || !initial ? null : initial.size,
      fileIdentity: initial ? fileIdentity(initial) : undefined,
      retryTimer: null,
      retryDelayMs: POLL_INTERVAL_MS,
      lastTitleByScope: new Map(),
      // 有限回扫覆盖终态早于 watcher 的竞态，起点残行由分类器安全忽略。
      offset: Math.max(0, (initial?.size ?? 0) - MAX_READ_BYTES),
      owners: new Map(),
      pending: false,
      pendingRecords: [],
      processing: false,
      root,
      promptWatermarkByScope: new Map(),
      promptFileIdentityByScope: new Map(),
      seenTerminalEvents: new Set(),
      seenTranscriptEvents: new Set(),
      watcher,
    };
    entries.set(canonicalPath, entry);
    watchFile(canonicalPath, { interval: POLL_INTERVAL_MS }, watcher);
    return entry;
  }

  return {
    dispose() {
      disposed = true;
      for (const [path, entry] of entries) {
        entry.disposed = true;
        entry.classifyLine = null;
        entry.pendingRecords.length = 0;
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        unwatchFile(path, entry.watcher);
      }
      entries.clear();
      entryCreations.clear();
      pendingScopeTokens.clear();
    },
    async observe(event) {
      if (
        disposed ||
        event.agent !== config.agent ||
        // Maintenance IDs pair maintenance events, never transcript turn owners.
        event.event === "MaintenanceStarted" ||
        event.event === "MaintenanceCompleted"
      ) {
        return;
      }
      if (event.event === "SessionEnd") {
        releaseScope(event.panelId, event.windowId, event);
        return;
      }
      const path = event.transcriptPath?.trim();
      if (!path) {
        return;
      }
      let key = scopeKey(event);
      const pending = pendingScopeTokens.get(key);
      if (continuesPendingPrompt(pending, event)) {
        pending.event = event;
        return;
      }
      if (!pending && pendingScopeTokens.size >= MAX_PENDING_OBSERVATIONS)
        return;
      const token: PendingObservation = {
        event,
        path: "",
        prompt: event.event === "PromptSubmit",
      };
      pendingScopeTokens.set(key, token);
      const resolution = await resolveTranscriptPath(
        path,
        transcriptRoot,
        true
      );
      key = scopeKey(token.event);
      if (!resolution || pendingScopeTokens.get(key) !== token) {
        if (pendingScopeTokens.get(key) === token)
          pendingScopeTokens.delete(key);
        return;
      }
      const targetResolution = resolution;
      // 晚创建的根内链接可能改变 realpath，沿同一 owner 的原路径保留水位。
      let canonicalPath = await selectObservedTranscriptPath(
        resolution,
        [...entries].find(
          ([, entry]) =>
            entry.owners.get(key)?.transcriptPath === token.event.transcriptPath
        )?.[0]
      );
      key = scopeKey(token.event);
      if (pendingScopeTokens.get(key) !== token) return;
      if (!entries.has(canonicalPath)) canonicalPath = resolution.path;
      token.path = canonicalPath;
      let promptFile: Stats | undefined | null = null;
      let promptBoundaryCaptured = false;
      async function capturePromptBoundary(): Promise<void> {
        if (promptBoundaryCaptured) return;
        promptFile =
          token.prompt && !targetResolution.missing
            ? await statTranscriptFile(canonicalPath)
            : null;
        promptBoundaryCaptured = true;
      }
      key = scopeKey(token.event);
      if (disposed || pendingScopeTokens.get(key) !== token) return;
      for (const [otherPath, otherEntry] of entries) {
        if (otherPath === canonicalPath || !otherEntry.owners.delete(key))
          continue;
        for (const [turnId, context] of otherEntry.contextsByTurnId) {
          if (scopeKey(context) === key) {
            otherEntry.contextsByTurnId.delete(turnId);
          }
        }
        otherEntry.lastTitleByScope.delete(key);
        dropPromptWatermarks(
          otherEntry.promptWatermarkByScope,
          [key],
          otherEntry.promptFileIdentityByScope
        );
        if (otherEntry.owners.size === 0) disposeEntry(otherPath, otherEntry);
      }
      async function bindEntry(): Promise<void> {
        key = scopeKey(token.event);
        if (disposed || pendingScopeTokens.get(key) !== token) return;
        let entry: TranscriptEntry | null | undefined =
          entries.get(canonicalPath);
        if (!entry) {
          if (!entryCreations.has(canonicalPath) && atCapacity()) {
            await capturePromptBoundary();
            if (
              disposed ||
              pendingScopeTokens.get(scopeKey(token.event)) !== token
            )
              return;
            token.retry = bindEntry;
            if (!atCapacity()) retryWaitingObservations();
            return;
          }
          let creation = entryCreations.get(canonicalPath);
          if (!creation) {
            creation = createEntry(targetResolution).finally(() => {
              entryCreations.delete(canonicalPath);
              retryWaitingObservations();
            });
            entryCreations.set(canonicalPath, creation);
          }
          entry = await creation;
        }
        if (entry) await capturePromptBoundary();
        key = scopeKey(token.event);
        if (
          !entry ||
          disposed ||
          entry.disposed ||
          pendingScopeTokens.get(key) !== token
        ) {
          if (pendingScopeTokens.get(key) === token)
            pendingScopeTokens.delete(key);
          if (entry?.owners.size === 0) {
            const cleanupTimer = setTimeout(() => {
              if (entry?.owners.size === 0) disposeEntry(canonicalPath, entry);
            }, 0);
            cleanupTimer.unref();
          }
          return;
        }
        pendingScopeTokens.delete(key);
        if (
          token.prompt &&
          (targetResolution.missing ||
            promptFile === undefined ||
            promptFile?.isFile())
        ) {
          recordPromptWatermark(
            entry.promptWatermarkByScope,
            key,
            promptFile?.size ?? 0,
            entry.promptFileIdentityByScope,
            promptFile ? fileIdentity(promptFile) : undefined
          );
        }
        entry.owners.set(key, token.event);
        const turnId = token.event.turnId?.trim();
        if (turnId) {
          entry.contextsByTurnId.set(turnId, token.event);
          if (entry.contextsByTurnId.size > MAX_TURN_CONTEXTS) {
            entry.contextsByTurnId.delete(
              entry.contextsByTurnId.keys().next().value ?? ""
            );
          }
          const pendingForTurn = entry.pendingRecords.filter(
            (record) => record.turnId === turnId
          );
          if (pendingForTurn.length > 0) {
            entry.pendingRecords = entry.pendingRecords.filter(
              (record) => record.turnId !== turnId
            );
          }
          for (const pendingRecord of pendingForTurn) {
            emitTranscriptEvent(
              entry,
              token.event,
              pendingRecord,
              config.onTerminalEvent
            );
          }
        }
        scheduleDrain(canonicalPath, entry);
      }
      await bindEntry();
    },
    releasePanel(panelId, windowId) {
      releaseScope(panelId, windowId);
    },
    releasePanelsWhere(predicate) {
      const scopes = new Set<string>();
      for (const key of pendingScopeTokens.keys()) {
        const [windowId, panelId] = key.split("\0");
        if (panelId && windowId && predicate(panelId, windowId)) {
          scopes.add(key);
        }
      }
      for (const entry of entries.values()) {
        for (const context of entry.owners.values()) {
          if (predicate(context.panelId, context.windowId)) {
            scopes.add(scopeKey(context));
          }
        }
      }
      for (const key of scopes) {
        const [windowId, panelId] = key.split("\0");
        if (panelId && windowId) releaseScope(panelId, windowId);
      }
    },
    releaseWindow(windowId) {
      const panelIds = new Set<string>();
      for (const key of pendingScopeTokens.keys()) {
        if (key.startsWith(`${windowId}\0`)) {
          panelIds.add(key.slice(windowId.length + 1));
        }
      }
      for (const entry of entries.values()) {
        for (const context of entry.owners.values()) {
          if (context.windowId === windowId) panelIds.add(context.panelId);
        }
      }
      for (const panelId of panelIds) releaseScope(panelId, windowId);
    },
    transferPanelOwnership({ panelId, sourceWindowId, targetWindowId }) {
      if (
        panelId.trim().length === 0 ||
        sourceWindowId.trim().length === 0 ||
        targetWindowId.trim().length === 0 ||
        sourceWindowId === targetWindowId
      ) {
        return;
      }
      const sourceKey = `${sourceWindowId}\0${panelId}`;
      const targetKey = `${targetWindowId}\0${panelId}`;
      const pending = pendingScopeTokens.get(sourceKey);
      if (pending) {
        pendingScopeTokens.delete(sourceKey);
        pending.event = { ...pending.event, windowId: targetWindowId };
        pendingScopeTokens.set(targetKey, pending);
      }
      for (const entry of entries.values()) {
        const owner = entry.owners.get(sourceKey);
        if (!owner) {
          continue;
        }
        entry.owners.delete(sourceKey);
        const moved = { ...owner, windowId: targetWindowId };
        entry.owners.set(targetKey, moved);
        const lastTitle = entry.lastTitleByScope.get(sourceKey);
        if (lastTitle !== undefined) {
          entry.lastTitleByScope.delete(sourceKey);
          entry.lastTitleByScope.set(targetKey, lastTitle);
        }
        movePromptWatermark(
          entry.promptWatermarkByScope,
          sourceKey,
          targetKey,
          entry.promptFileIdentityByScope
        );
        for (const [turnId, context] of entry.contextsByTurnId) {
          if (scopeKey(context) === sourceKey) {
            entry.contextsByTurnId.set(turnId, {
              ...context,
              windowId: targetWindowId,
            });
          }
        }
      }
    },
  };
}
