import { type Stats, unwatchFile, watchFile } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type {
  TranscriptTailReconciler,
  TranscriptTailReconcilerConfig,
  TranscriptTerminalRecord,
} from "./tail-contracts.ts";
import { emitTranscriptEvent } from "./tail-event.ts";
import { processTranscriptTitleLine } from "./title-routing.ts";

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
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TRANSCRIPTS = 32;
const MAX_TURN_CONTEXTS = 64;
const MAX_PENDING_TRANSCRIPT_RECORDS = 64;
type TranscriptLineClassifier = (
  line: string
) => TranscriptTerminalRecord | null;
interface TranscriptEntry {
  classifyLine: TranscriptLineClassifier | null;
  contextsByTurnId: Map<string, AgentHookEventPayload>;
  disposed: boolean;
  initialScanEnd: number;
  /** 每个 owner 最近一次派发过的 provider 标题（同值连发直接丢弃）。 */
  lastTitleByScope: Map<string, string>;
  offset: number;
  owners: Map<string, AgentHookEventPayload>;
  pending: boolean;
  pendingRecords: TranscriptTerminalRecord[];
  processing: boolean;
  seenTerminalEvents: Set<string>;
  seenTranscriptEvents: Set<string>;
  watcher: (curr: Stats, prev: Stats) => void;
}

/**
 * Agent transcript 尾读终态对账核心（agent 私有适配器共用的机械层）。
 *
 * 职责边界：只把适配器分类出的 TurnCompleted / TurnInterrupted 可信终态
 * 回投聚合器，不把 transcript 当工具、processing 或 permission 状态的
 * 权威源。格式知识全部在各适配器的 classifyLine 内；格式变化时静默失效，
 * hook 与 PTY 退出兜底仍然有效。
 */
export function createTranscriptTailReconciler(
  config: TranscriptTailReconcilerConfig
): TranscriptTailReconciler {
  const entries = new Map<string, TranscriptEntry>();
  const entryCreations = new Map<string, Promise<TranscriptEntry | null>>();
  const pendingScopeTokens = new Map<string, symbol>();
  const transcriptRoot = resolve(config.transcriptRoot);
  let disposed = false;

  function createEntryLineClassifier(): TranscriptLineClassifier {
    const classifyLine = config.createLineClassifier?.() ?? config.classifyLine;
    if (!classifyLine) {
      throw new Error("transcript reconciler requires a line classifier");
    }
    return classifyLine;
  }

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
        entry.classifyLine = createEntryLineClassifier();
        entry.pendingRecords.length = 0;
        entry.seenTerminalEvents.clear();
        entry.seenTranscriptEvents.clear();
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
          // transcript 可能包含超大 tool output 单行。跳过固定大小片段
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
    if (allowOwnerFallback) {
      try {
        const classifyTitleLine = config.classifyTitleLine;
        const listener = config.onTitleRecord;
        if (classifyTitleLine && listener) {
          processTranscriptTitleLine({
            classifyLine: classifyTitleLine,
            lastTitleByScope: entry.lastTitleByScope,
            line,
            listener,
            owners: entry.owners,
          });
        }
      } catch {
        // 标题是纯装饰通路，坏行不得连带影响终态对账。
      }
    }
    try {
      const record = entry.classifyLine?.(line);
      if (!record) {
        return;
      }
      let context: AgentHookEventPayload | undefined;
      if (record.turnId) context = entry.contextsByTurnId.get(record.turnId);
      else if (allowOwnerFallback && entry.owners.size === 1) {
        context = entry.owners.values().next().value;
      }
      if (!context) {
        if (record.turnId) {
          entry.pendingRecords.push(record);
          if (entry.pendingRecords.length > MAX_PENDING_TRANSCRIPT_RECORDS) {
            entry.pendingRecords.shift();
          }
        }
        return;
      }
      emitTranscriptEvent(entry, context, record, config.onTerminalEvent);
    } catch {
      // transcript 是兼容性对账源；坏行和格式升级不得影响主 hook 通路。
    }
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
      entry.classifyLine = null;
      entry.pendingRecords.length = 0;
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
      for (const key of releasedKeys) {
        entry.lastTitleByScope.delete(key);
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
      classifyLine: createEntryLineClassifier(),
      contextsByTurnId: new Map(),
      disposed: false,
      initialScanEnd: initial.size,
      lastTitleByScope: new Map(),
      // 首次绑定有限回扫尾部，覆盖 terminal 已写入、watcher 稍后建立的竞态。
      // 起点可能落在一行中间；processLine 的 JSON 解析失败会安全忽略该残片。
      offset: Math.max(0, initial.size - MAX_READ_BYTES),
      owners: new Map(),
      pending: false,
      pendingRecords: [],
      processing: false,
      seenTerminalEvents: new Set(),
      seenTranscriptEvents: new Set(),
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
        entry.classifyLine = null;
        entry.pendingRecords.length = 0;
        unwatchFile(path, entry.watcher);
      }
      entries.clear();
      entryCreations.clear();
      pendingScopeTokens.clear();
    },
    async observe(event) {
      if (disposed || event.agent !== config.agent) {
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
        otherEntry.lastTitleByScope.delete(key);
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
            event,
            pendingRecord,
            config.onTerminalEvent
          );
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
        const lastTitle = entry.lastTitleByScope.get(sourceKey);
        if (lastTitle !== undefined) {
          entry.lastTitleByScope.delete(sourceKey);
          entry.lastTitleByScope.set(targetKey, lastTitle);
        }
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
