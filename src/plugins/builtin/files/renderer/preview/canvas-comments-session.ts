/**
 * Bridge canvas body comments session → panel toolbar button.
 * Header and body are siblings; this module store shares one session per path.
 */
import type { useCanvasPreviewComments } from "./use-canvas-preview-comments.ts";

export type CanvasCommentsSession = ReturnType<typeof useCanvasPreviewComments>;

const sessions = new Map<string, CanvasCommentsSession>();
const signatures = new Map<string, string>();
let revision = 0;
const listeners = new Set<() => void>();

function bump(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

function sessionSignature(session: CanvasCommentsSession): string {
  const nodeCount = [...session.locatedByAnchorId.values()].reduce(
    (sum, list) => sum + list.length,
    0
  );
  const pickKey = session.draftPick
    ? `${session.draftPick.label}|${session.draftPick.anchorId ?? ""}`
    : "";
  return [
    session.threadsHydrated ? "1" : "0",
    session.draftOpen ? "1" : "0",
    session.pickMode ? "1" : "0",
    pickKey,
    String(session.fileThreads.length),
    String(nodeCount),
    String(session.pickedNodeThreads.length),
    String(session.driftNodeThreads.length),
    String(session.softMarkers.length),
  ].join("|");
}

export function publishCanvasCommentsSession(
  path: string,
  session: CanvasCommentsSession
): void {
  sessions.set(path, session);
  const next = sessionSignature(session);
  if (signatures.get(path) === next) {
    return;
  }
  signatures.set(path, next);
  bump();
}

export function clearCanvasCommentsSession(path: string): void {
  if (!sessions.has(path)) {
    return;
  }
  sessions.delete(path);
  signatures.delete(path);
  bump();
}

export function getCanvasCommentsSession(
  path: string
): CanvasCommentsSession | null {
  return sessions.get(path) ?? null;
}

export function subscribeCanvasCommentsSessions(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCanvasCommentsSessionsRevision(): number {
  return revision;
}
