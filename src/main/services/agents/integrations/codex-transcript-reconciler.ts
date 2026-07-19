import { type Stats, unwatchFile, watchFile } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { codexHomeDir } from "./codex.ts";

const POLL_INTERVAL_MS = 250;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TRANSCRIPTS = 32;
const MAX_TURN_CONTEXTS = 64;
const MAX_PENDING_TERMINALS = 64;
const MAX_SEEN_TERMINALS = 256;

type TerminalType = "task_complete" | "turn_aborted";

interface TranscriptEntry {
  contextsByTurnId: Map<string, AgentHookEventPayload>;
  disposed: boolean;
  initialScanEnd: number;
  offset: number;
  owners: Map<string, AgentHookEventPayload>;
  pending: boolean;
  pendingTerminalsByTurnId: Map<string, TerminalType>;
  processing: boolean;
  seenTerminalEvents: Set<string>;
  watcher: (curr: Stats, prev: Stats) => void;
}

export interface CodexTranscriptReconciler {
  dispose(): void;
  observe(event: AgentHookEventPayload): Promise<void>;
  releasePanel(panelId: string, windowId?: string): void;
  releasePanelsWhere(
    predicate: (panelId: string, windowId: string) => boolean
  ): void;
  releaseWindow(windowId: string): void;
  transferPanelOwnership(input: {
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
  }): void;
}

interface CodexTranscriptReconcilerOpts {
  onTerminalEvent: (event: AgentHookEventPayload) => void;
  transcriptRoot?: string;
}

/**
 * Codex TUI 兼容性终态对账器。
 *
 * hooks 当前没有独立的 interrupt 事件；Esc 中断会写入 transcript 的
 * `event_msg/turn_aborted`。这里仅消费 task_complete / turn_aborted 两种终态，
 * 不把 transcript 当工具或过程状态的权威源。格式变化时静默失效，hook 与
 * PTY 退出兜底仍然有效。
 */
export function createCodexTranscriptReconciler(
  opts: CodexTranscriptReconcilerOpts
): CodexTranscriptReconciler {
  const entries = new Map<string, TranscriptEntry>();
  const entryCreations = new Map<string, Promise<TranscriptEntry | null>>();
  const pendingScopeTokens = new Map<string, symbol>();
  const transcriptRoot = resolve(
    opts.transcriptRoot ?? resolve(codexHomeDir(), "sessions")
  );
  let disposed = false;

  async function drain(path: string, entry: TranscriptEntry): Promise<void> {
    do {
      entry.pending = false;
      const current = await stat(path).catch(() => null);
      if (!current) {
        continue;
      }
      if (current.size < entry.offset) {
        entry.initialScanEnd = current.size;
        entry.offset = Math.max(0, current.size - MAX_READ_BYTES);
        entry.pendingTerminalsByTurnId.clear();
        entry.seenTerminalEvents.clear();
      }
      if (current.size === entry.offset) {
        continue;
      }
      const readSize = Math.min(current.size - entry.offset, MAX_READ_BYTES);
      const fd = await open(path, "r");
      let chunk: Buffer;
      try {
        chunk = Buffer.alloc(readSize);
        const result = await fd.read(chunk, 0, chunk.length, entry.offset);
        chunk = chunk.subarray(0, result.bytesRead);
      } finally {
        await fd.close();
      }
      const lastNewline = chunk.lastIndexOf(0x0a);
      if (lastNewline === -1) {
        if (chunk.length >= MAX_READ_BYTES) {
          // Codex transcript 可能包含超大 tool output 单行。跳过固定大小片段
          // 直到下一个换行，保证后续终态可达且内存有界。
          entry.offset += chunk.length;
          entry.pending = true;
        }
        continue;
      }
      const consumed = chunk.subarray(0, lastNewline + 1);
      const chunkStart = entry.offset;
      entry.offset += consumed.length;
      let lineStart = 0;
      for (let index = 0; index < consumed.length; index += 1) {
        if (consumed[index] !== 0x0a) continue;
        const line = consumed.subarray(lineStart, index).toString("utf8");
        const lineEnd = chunkStart + index + 1;
        processLine(entry, line, lineEnd > entry.initialScanEnd);
        lineStart = index + 1;
      }
      if (entry.offset < current.size) {
        entry.pending = true;
      }
    } while (!(disposed || entry.disposed) && entry.pending);
  }

  function processLine(
    entry: TranscriptEntry,
    line: string,
    allowOwnerFallback: boolean
  ): void {
    if (disposed || entry.disposed || !line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line) as {
        payload?: { reason?: unknown; turn_id?: unknown; type?: unknown };
        type?: unknown;
      };
      if (parsed.type !== "event_msg") {
        return;
      }
      const payload = parsed.payload;
      const terminalType = payload?.type;
      if (terminalType !== "task_complete" && terminalType !== "turn_aborted") {
        return;
      }
      if (
        terminalType === "turn_aborted" &&
        payload?.reason !== undefined &&
        payload.reason !== "interrupted"
      ) {
        return;
      }
      const turnId =
        typeof payload?.turn_id === "string" ? payload.turn_id : "";
      let context: AgentHookEventPayload | undefined;
      if (turnId) context = entry.contextsByTurnId.get(turnId);
      else if (allowOwnerFallback && entry.owners.size === 1) {
        context = entry.owners.values().next().value;
      }
      if (!context) {
        if (turnId && !entry.pendingTerminalsByTurnId.has(turnId)) {
          entry.pendingTerminalsByTurnId.set(turnId, terminalType);
          if (entry.pendingTerminalsByTurnId.size > MAX_PENDING_TERMINALS) {
            entry.pendingTerminalsByTurnId.delete(
              entry.pendingTerminalsByTurnId.keys().next().value ?? ""
            );
          }
        }
        return;
      }
      emitTerminalEvent(entry, context, terminalType, turnId);
    } catch {
      // transcript 是兼容性对账源；坏行和格式升级不得影响主 hook 通路。
    }
  }

  function emitTerminalEvent(
    entry: TranscriptEntry,
    context: AgentHookEventPayload,
    terminalType: TerminalType,
    turnId: string
  ): void {
    if (turnId) {
      // 同一 turn 第一个可信终态获胜；complete/abort 冲突不得二次迁移。
      if (entry.seenTerminalEvents.has(turnId)) return;
      entry.seenTerminalEvents.add(turnId);
      if (entry.seenTerminalEvents.size > MAX_SEEN_TERMINALS) {
        entry.seenTerminalEvents.delete(
          entry.seenTerminalEvents.values().next().value ?? ""
        );
      }
      entry.contextsByTurnId.delete(turnId);
      entry.pendingTerminalsByTurnId.delete(turnId);
    }
    opts.onTerminalEvent({
      ...context,
      event:
        terminalType === "turn_aborted" ? "TurnInterrupted" : "TurnCompleted",
      nativeEvent: `codex.transcript.${terminalType}`,
      ...(turnId ? { turnId } : {}),
      v: 2,
    });
  }

  function scheduleDrain(path: string, entry: TranscriptEntry): void {
    if (disposed || entry.disposed) {
      return;
    }
    if (entry.processing) {
      entry.pending = true;
      return;
    }
    entry.processing = true;
    drain(path, entry).finally(() => {
      entry.processing = false;
    });
  }

  function disposeEntry(path: string, entry: TranscriptEntry): void {
    if (entries.get(path) === entry) {
      entry.disposed = true;
      unwatchFile(path, entry.watcher);
      entries.delete(path);
    }
  }

  const scopeKey = (event: AgentHookEventPayload): string =>
    `${event.windowId}\0${event.panelId}`;

  function releaseScope(panelId: string, windowId?: string): void {
    const releasedKeys = new Set<string>();
    for (const key of pendingScopeTokens.keys()) {
      const [scopeWindowId, scopePanelId] = key.split("\0");
      if (
        scopePanelId === panelId &&
        (windowId === undefined || scopeWindowId === windowId)
      ) {
        pendingScopeTokens.delete(key);
        releasedKeys.add(key);
      }
    }
    for (const [path, entry] of entries) {
      for (const [key, context] of entry.owners) {
        if (
          context.panelId === panelId &&
          (windowId === undefined || context.windowId === windowId)
        ) {
          entry.owners.delete(key);
          releasedKeys.add(key);
        }
      }
      for (const [turnId, context] of entry.contextsByTurnId) {
        if (releasedKeys.has(scopeKey(context))) {
          entry.contextsByTurnId.delete(turnId);
        }
      }
      if (entry.owners.size === 0) disposeEntry(path, entry);
    }
  }

  async function createEntry(
    canonicalPath: string
  ): Promise<TranscriptEntry | null> {
    if (entries.size + entryCreations.size >= MAX_TRANSCRIPTS) {
      return null;
    }
    const initial = await stat(canonicalPath).catch(() => null);
    if (!(initial?.isFile() && !disposed)) {
      return null;
    }
    const watcher = (): void => {
      const current = entries.get(canonicalPath);
      if (current) {
        scheduleDrain(canonicalPath, current);
      }
    };
    const entry: TranscriptEntry = {
      contextsByTurnId: new Map(),
      disposed: false,
      initialScanEnd: initial.size,
      // 首次绑定有限回扫尾部，覆盖 terminal 已写入、watcher 稍后建立的竞态。
      // 起点可能落在一行中间；processLine 的 JSON 解析失败会安全忽略该残片。
      offset: Math.max(0, initial.size - MAX_READ_BYTES),
      owners: new Map(),
      pending: false,
      pendingTerminalsByTurnId: new Map(),
      processing: false,
      seenTerminalEvents: new Set(),
      watcher,
    };
    entries.set(canonicalPath, entry);
    watchFile(canonicalPath, { interval: POLL_INTERVAL_MS }, watcher);
    return entry;
  }

  async function canonicalTranscriptPath(path: string): Promise<string | null> {
    const resolvedPath = resolve(path);
    const relativePath = relative(transcriptRoot, resolvedPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(transcriptRoot).catch(() => null),
      realpath(resolvedPath).catch(() => null),
    ]);
    if (!(canonicalRoot && canonicalPath)) return null;
    const canonicalRelative = relative(canonicalRoot, canonicalPath);
    return canonicalRelative.startsWith("..") || isAbsolute(canonicalRelative)
      ? null
      : canonicalPath;
  }

  return {
    dispose() {
      disposed = true;
      for (const [path, entry] of entries) {
        entry.disposed = true;
        unwatchFile(path, entry.watcher);
      }
      entries.clear();
      entryCreations.clear();
      pendingScopeTokens.clear();
    },
    async observe(event) {
      if (disposed || event.agent !== "codex") {
        return;
      }
      if (event.event === "SessionEnd") {
        releaseScope(event.panelId, event.windowId);
        return;
      }
      const path = event.transcriptPath?.trim();
      if (!path) {
        return;
      }
      const key = scopeKey(event);
      const token = Symbol(key);
      pendingScopeTokens.set(key, token);
      const canonicalPath = await canonicalTranscriptPath(path);
      if (!canonicalPath || pendingScopeTokens.get(key) !== token) {
        if (pendingScopeTokens.get(key) === token)
          pendingScopeTokens.delete(key);
        return;
      }
      let entry: TranscriptEntry | null | undefined =
        entries.get(canonicalPath);
      if (!entry) {
        let creation = entryCreations.get(canonicalPath);
        if (!creation) {
          creation = createEntry(canonicalPath).finally(() => {
            entryCreations.delete(canonicalPath);
          });
          entryCreations.set(canonicalPath, creation);
        }
        entry = await creation;
      }
      if (!entry || pendingScopeTokens.get(key) !== token) {
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
      for (const [otherPath, otherEntry] of entries) {
        if (otherEntry === entry || !otherEntry.owners.delete(key)) continue;
        for (const [turnId, context] of otherEntry.contextsByTurnId) {
          if (scopeKey(context) === key) {
            otherEntry.contextsByTurnId.delete(turnId);
          }
        }
        if (otherEntry.owners.size === 0) disposeEntry(otherPath, otherEntry);
      }
      entry.owners.set(key, event);
      const turnId = event.turnId?.trim();
      if (turnId) {
        entry.contextsByTurnId.set(turnId, event);
        if (entry.contextsByTurnId.size > MAX_TURN_CONTEXTS) {
          entry.contextsByTurnId.delete(
            entry.contextsByTurnId.keys().next().value ?? ""
          );
        }
        const pendingTerminal = entry.pendingTerminalsByTurnId.get(turnId);
        if (pendingTerminal) {
          emitTerminalEvent(entry, event, pendingTerminal, turnId);
        }
      }
      scheduleDrain(canonicalPath, entry);
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
