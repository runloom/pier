import type { FilesDocumentPanelSource } from "./files-document-types.ts";

/**
 * per-group 文件导航历史(chrome 里的 ←/→)。
 * push 记录 active source 变化;back/forward 返回目标 source,
 * 由调用方经 panels.openInstance 重新打开(不直接操作 dockview)。
 */
interface NavHistorySession {
  entries: FilesDocumentPanelSource[];
  index: number;
  listeners: Set<() => void>;
  /** navigate() 触发的打开会回流成 push;此标志让那次 push 变成 no-op。 */
  suppressNextPush: boolean;
}

const sessions = new Map<string, NavHistorySession>();

function sessionForGroup(groupId: string): NavHistorySession {
  const existing = sessions.get(groupId);
  if (existing) {
    return existing;
  }
  const session: NavHistorySession = {
    entries: [],
    index: -1,
    listeners: new Set(),
    suppressNextPush: false,
  };
  sessions.set(groupId, session);
  return session;
}

function sameSource(
  left: FilesDocumentPanelSource | undefined,
  right: FilesDocumentPanelSource
): boolean {
  if (!left || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "untitled" && right.kind === "untitled") {
    return left.id === right.id;
  }
  if (left.kind === "disk" && right.kind === "disk") {
    return left.root === right.root && left.path === right.path;
  }
  return false;
}

function emit(session: NavHistorySession): void {
  for (const listener of session.listeners) {
    listener();
  }
}

export function pushFilesNavEntry(
  groupId: string,
  source: FilesDocumentPanelSource
): void {
  const session = sessionForGroup(groupId);
  if (session.suppressNextPush) {
    session.suppressNextPush = false;
    emit(session);
    return;
  }
  if (sameSource(session.entries[session.index], source)) {
    return;
  }
  session.entries = [...session.entries.slice(0, session.index + 1), source];
  session.index = session.entries.length - 1;
  emit(session);
}

export function filesNavBack(groupId: string): FilesDocumentPanelSource | null {
  const session = sessionForGroup(groupId);
  if (session.index <= 0) {
    return null;
  }
  session.index -= 1;
  session.suppressNextPush = true;
  emit(session);
  return session.entries[session.index] ?? null;
}

export function filesNavForward(
  groupId: string
): FilesDocumentPanelSource | null {
  const session = sessionForGroup(groupId);
  if (session.index >= session.entries.length - 1) {
    return null;
  }
  session.index += 1;
  session.suppressNextPush = true;
  emit(session);
  return session.entries[session.index] ?? null;
}

export function getFilesNavState(groupId: string | null): {
  canBack: boolean;
  canForward: boolean;
} {
  if (!groupId) {
    return { canBack: false, canForward: false };
  }
  const session = sessions.get(groupId);
  if (!session) {
    return { canBack: false, canForward: false };
  }
  return {
    canBack: session.index > 0,
    canForward: session.index < session.entries.length - 1,
  };
}

export function subscribeFilesNavHistory(
  groupId: string | null,
  listener: () => void
): () => void {
  if (!groupId) {
    return () => undefined;
  }
  const session = sessionForGroup(groupId);
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function clearFilesNavHistory(): void {
  sessions.clear();
}
