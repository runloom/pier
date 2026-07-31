import { useSyncExternalStore } from "react";

export type FilesLanguageServiceStatus =
  | {
      state: "disabled";
      reason: "editor-disabled" | "globally-disabled" | "worktrees-disabled";
    }
  | {
      state: "unsupported";
      reason: "non-disk" | "no-provider" | "unsupported-root";
    }
  | { state: "starting"; serverId?: string }
  | { state: "ready"; serverId: string }
  | {
      state: "retrying";
      serverId: string;
      attempt: 1 | 2 | 3;
      delayMs: 250 | 1000 | 4000;
      reason: "exited" | "failed" | "send-failed" | "initialize-failed";
    }
  | {
      state: "paused";
      serverId?: string;
      reason: "idle-release" | "workspace-evicted";
    }
  | {
      state: "error";
      serverId?: string;
      reason:
        | "limit-reached"
        | "server-unavailable"
        | "launch-failed"
        | "initialize-failed"
        | "cleanup-failed"
        | "bridge-unavailable"
        | "retry-exhausted";
    };

type Listener = () => void;

const statusByOwner = new Map<
  string,
  Map<string, FilesLanguageServiceStatus>
>();
const listeners = new Set<Listener>();
let revision = 0;

function statusesEqual(
  current: FilesLanguageServiceStatus,
  next: FilesLanguageServiceStatus
): boolean {
  if (current.state !== next.state) {
    return false;
  }

  switch (current.state) {
    case "disabled":
      return next.state === "disabled" && current.reason === next.reason;
    case "unsupported":
      return next.state === "unsupported" && current.reason === next.reason;
    case "starting":
      return next.state === "starting" && current.serverId === next.serverId;
    case "ready":
      return next.state === "ready" && current.serverId === next.serverId;
    case "retrying":
      return (
        next.state === "retrying" &&
        current.serverId === next.serverId &&
        current.attempt === next.attempt &&
        current.delayMs === next.delayMs &&
        current.reason === next.reason
      );
    case "paused":
      return (
        next.state === "paused" &&
        current.serverId === next.serverId &&
        current.reason === next.reason
      );
    case "error":
      return (
        next.state === "error" &&
        current.serverId === next.serverId &&
        current.reason === next.reason
      );
    default: {
      const exhaustiveStatus: never = current;
      return exhaustiveStatus;
    }
  }
}

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

function getRevision(): number {
  return revision;
}

export function publishFilesLanguageServiceStatus(
  ownerId: string,
  documentId: string,
  status: FilesLanguageServiceStatus
): void {
  const ownerStatuses = statusByOwner.get(ownerId);
  const current = ownerStatuses?.get(documentId);
  if (current && statusesEqual(current, status)) {
    return;
  }

  if (ownerStatuses) {
    ownerStatuses.set(documentId, status);
  } else {
    statusByOwner.set(ownerId, new Map([[documentId, status]]));
  }
  notify();
}

export function clearFilesLanguageServiceStatusOwner(ownerId: string): void {
  if (!statusByOwner.delete(ownerId)) {
    return;
  }
  notify();
}

export function subscribeFilesLanguageServiceStatus(
  listener: Listener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFilesLanguageServiceStatus(
  ownerId: string,
  documentId: string
): FilesLanguageServiceStatus | null {
  return statusByOwner.get(ownerId)?.get(documentId) ?? null;
}

export function useFilesLanguageServiceStatus(
  ownerId: string,
  documentId: string
): FilesLanguageServiceStatus | null {
  useSyncExternalStore(
    subscribeFilesLanguageServiceStatus,
    getRevision,
    getRevision
  );
  return getFilesLanguageServiceStatus(ownerId, documentId);
}

export function resetFilesLanguageServiceStatusForTests(): void {
  if (statusByOwner.size === 0) {
    return;
  }
  statusByOwner.clear();
  notify();
}
