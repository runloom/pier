import type {
  EnvironmentUpdateRequest,
  LocalEnvironmentState,
  LocalEnvironmentWorktreeBindingSnapshot,
} from "@shared/contracts/environment.ts";
import { create } from "zustand";

type LocalEnvironmentsHydration = "pending" | "ready" | "error";

interface LocalEnvironmentsStoreState extends LocalEnvironmentState {
  addProject: (request: {
    projectRootPath: string;
  }) => Promise<LocalEnvironmentState>;
  /** Settles after the first snapshot (or failed init). */
  hydration: LocalEnvironmentsHydration;
  removeProject: (request: {
    projectRootPath: string;
  }) => Promise<LocalEnvironmentState>;
  updateProject: (
    request: EnvironmentUpdateRequest
  ) => Promise<LocalEnvironmentState>;
  worktreeBinding: (request: {
    worktreePath: string;
  }) => Promise<LocalEnvironmentWorktreeBindingSnapshot | null>;
}

function hydrate(
  snapshot: LocalEnvironmentState,
  hydration: LocalEnvironmentsHydration = "ready"
): void {
  useLocalEnvironmentsStore.setState({
    projects: snapshot.projects,
    version: snapshot.version,
    worktreeBindings: snapshot.worktreeBindings,
    hydration,
  });
}

export const useLocalEnvironmentsStore = create<LocalEnvironmentsStoreState>(
  () => ({
    projects: [],
    version: 1,
    worktreeBindings: [],
    hydration: "pending",

    async addProject(request) {
      const snapshot = await window.pier.environments.project.add(request);
      hydrate(snapshot);
      return snapshot;
    },

    async removeProject(request) {
      const snapshot = await window.pier.environments.project.remove(request);
      hydrate(snapshot);
      return snapshot;
    },

    async updateProject(request) {
      const snapshot = await window.pier.environments.update(request);
      hydrate(snapshot);
      return snapshot;
    },

    worktreeBinding(request) {
      return window.pier.environments.worktreeBinding(request);
    },
  })
);

let listenerAttached = false;
let detachListener: (() => void) | null = null;

function attachListener(): void {
  if (listenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.environments?.onChanged?.((next) => {
    hydrate(next);
  });
  if (!detach) {
    return;
  }
  detachListener = detach;
  listenerAttached = true;
}

export function detachLocalEnvironmentsListener(): void {
  detachListener?.();
  detachListener = null;
  listenerAttached = false;
}

export async function initLocalEnvironments(): Promise<void> {
  attachListener();
  try {
    const snapshot = await window.pier.environments.snapshot();
    hydrate(snapshot, "ready");
  } catch (err) {
    console.error(
      "[local-environments.store] init IPC failed; keeping defaults:",
      err
    );
    useLocalEnvironmentsStore.setState({ hydration: "error" });
  }
}
