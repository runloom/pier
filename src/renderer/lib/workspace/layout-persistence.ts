import type { PierCommandErrorCode } from "@shared/contracts/commands.ts";

type WorkspaceLayoutFlusher = () => Promise<void>;
type WorkspaceLayoutPersistenceState = "ready" | "starting" | "unavailable";

interface FlusherRegistration {
  flusher: WorkspaceLayoutFlusher;
  id: number;
}

export class WorkspaceLayoutPersistenceError extends Error {
  readonly code: PierCommandErrorCode = "platform_unavailable";
  readonly state: Exclude<WorkspaceLayoutPersistenceState, "ready">;

  constructor(state: Exclude<WorkspaceLayoutPersistenceState, "ready">) {
    super(
      state === "starting"
        ? "Workspace layout persistence is still starting"
        : "Workspace layout persistence is unavailable"
    );
    this.name = "WorkspaceLayoutPersistenceError";
    this.state = state;
  }
}

let activeRegistration: FlusherRegistration | null = null;
let hasEverBeenReady = false;
let nextRegistrationId = 1;
let state: WorkspaceLayoutPersistenceState = "starting";

export function markWorkspaceLayoutPersistenceStarting(): void {
  if (activeRegistration) {
    return;
  }
  state = "starting";
}

export function markWorkspaceLayoutPersistenceUnavailable(): void {
  activeRegistration = null;
  state = "unavailable";
}

export function registerWorkspaceLayoutFlusher(
  flusher: WorkspaceLayoutFlusher
): () => void {
  const registration = { flusher, id: nextRegistrationId };
  nextRegistrationId += 1;
  activeRegistration = registration;
  hasEverBeenReady = true;
  state = "ready";
  return () => {
    if (activeRegistration?.id === registration.id) {
      activeRegistration = null;
      state = "starting";
    }
  };
}

export function canSkipWorkspaceLayoutFlushForInitialClose(): boolean {
  return !hasEverBeenReady && state === "starting";
}

export function resetWorkspaceLayoutPersistenceForTests(): void {
  activeRegistration = null;
  hasEverBeenReady = false;
  state = "starting";
}

export async function flushWorkspaceLayout(): Promise<void> {
  const registration = activeRegistration;
  if (!registration) {
    throw new WorkspaceLayoutPersistenceError(
      state === "unavailable" ? "unavailable" : "starting"
    );
  }
  await registration.flusher();
}
