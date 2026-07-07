import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detachLocalEnvironmentsListener,
  initLocalEnvironments,
  useLocalEnvironmentsStore,
} from "@/stores/local-environments.store.ts";

interface LocalEnvironmentProject {
  cleanupCommand: string;
  copyPatterns: string[];
  env: Record<string, string>;
  projectRootPath: string;
  setupCommand: string;
  updatedAt: number;
}

interface LocalEnvironmentWorktreeBinding {
  createdAt: number;
  projectRootPath: string;
  worktreePath: string;
}

interface LocalEnvironmentState {
  projects: LocalEnvironmentProject[];
  version: 1;
  worktreeBindings: LocalEnvironmentWorktreeBinding[];
}

interface WorktreeBindingSnapshot {
  cleanupCommand: string;
  copyPatterns: string[];
  env: Record<string, string>;
  hasCleanupScript: boolean;
  projectRootPath: string;
  setupCommand: string;
  worktreePath: string;
}

type EnvironmentsChangedCallback = (next: LocalEnvironmentState) => void;

const EMPTY_SNAPSHOT: LocalEnvironmentState = {
  projects: [],
  version: 1,
  worktreeBindings: [],
};

const PROJECT_SNAPSHOT: LocalEnvironmentState = {
  projects: [
    {
      cleanupCommand: "pnpm cleanup:worktree",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "pnpm setup:worktree",
      updatedAt: 21,
    },
  ],
  version: 1,
  worktreeBindings: [
    {
      createdAt: 22,
      projectRootPath: "/repo/pier",
      worktreePath: "/repo/pier.worktree/feature",
    },
  ],
};

describe("useLocalEnvironmentsStore", () => {
  let changedCallback: EnvironmentsChangedCallback | null;
  const detachMock = vi.fn();
  const projectAddMock =
    vi.fn<
      (request: { projectRootPath: string }) => Promise<LocalEnvironmentState>
    >();
  const projectRemoveMock =
    vi.fn<
      (request: { projectRootPath: string }) => Promise<LocalEnvironmentState>
    >();
  const snapshotMock = vi.fn<() => Promise<LocalEnvironmentState>>();
  const updateMock =
    vi.fn<
      (request: {
        cleanupCommand: string;
        copyPatterns: string[];
        env: Record<string, string>;
        projectRootPath: string;
        setupCommand: string;
      }) => Promise<LocalEnvironmentState>
    >();
  const worktreeBindingMock =
    vi.fn<
      (request: {
        worktreePath: string;
      }) => Promise<WorktreeBindingSnapshot | null>
    >();

  beforeEach(() => {
    changedCallback = null;
    detachLocalEnvironmentsListener();
    detachMock.mockReset();
    projectAddMock.mockReset();
    projectRemoveMock.mockReset();
    snapshotMock.mockReset();
    updateMock.mockReset();
    worktreeBindingMock.mockReset();
    useLocalEnvironmentsStore.setState(EMPTY_SNAPSHOT as never);
    vi.stubGlobal("window", {
      ...window,
      pier: {
        environments: {
          onChanged: (cb: EnvironmentsChangedCallback) => {
            changedCallback = cb;
            return detachMock;
          },
          project: {
            add: projectAddMock,
            remove: projectRemoveMock,
          },
          snapshot: snapshotMock,
          update: updateMock,
          worktreeBinding: worktreeBindingMock,
        },
      },
    });
  });

  afterEach(() => {
    detachLocalEnvironmentsListener();
    vi.unstubAllGlobals();
  });

  it("starts from the empty local-environment snapshot before IPC hydration", () => {
    expect(useLocalEnvironmentsStore.getInitialState()).toMatchObject(
      EMPTY_SNAPSHOT
    );
  });

  it("initLocalEnvironments hydrates from environments.snapshot and attaches one broadcast listener", async () => {
    snapshotMock.mockResolvedValue(PROJECT_SNAPSHOT);

    await initLocalEnvironments();

    expect(snapshotMock).toHaveBeenCalledTimes(1);
    expect(useLocalEnvironmentsStore.getState().projects).toEqual(
      PROJECT_SNAPSHOT.projects
    );
    expect(useLocalEnvironmentsStore.getState().worktreeBindings).toEqual(
      PROJECT_SNAPSHOT.worktreeBindings
    );
    expect(changedCallback).not.toBeNull();
  });

  it("environments.onChanged broadcasts replace the local environment snapshot", async () => {
    snapshotMock.mockResolvedValue(EMPTY_SNAPSHOT);
    await initLocalEnvironments();

    changedCallback?.(PROJECT_SNAPSHOT);

    expect(useLocalEnvironmentsStore.getState().projects).toEqual(
      PROJECT_SNAPSHOT.projects
    );
    expect(useLocalEnvironmentsStore.getState().worktreeBindings).toEqual(
      PROJECT_SNAPSHOT.worktreeBindings
    );
  });

  it("addProject dispatches through window.pier.environments.project.add", async () => {
    vi.mocked(window.pier.environments.project.add).mockResolvedValueOnce(
      PROJECT_SNAPSHOT
    );
    const store = useLocalEnvironmentsStore.getState();
    await store.addProject({ projectRootPath: "/repo/pier" });
    expect(window.pier.environments.project.add).toHaveBeenCalledWith({
      projectRootPath: "/repo/pier",
    });
    expect(useLocalEnvironmentsStore.getState().projects).toEqual(
      PROJECT_SNAPSHOT.projects
    );
  });

  it("removeProject dispatches through window.pier.environments.project.remove", async () => {
    vi.mocked(window.pier.environments.project.remove).mockResolvedValueOnce(
      EMPTY_SNAPSHOT
    );
    const store = useLocalEnvironmentsStore.getState();
    await store.removeProject({ projectRootPath: "/repo/pier" });
    expect(window.pier.environments.project.remove).toHaveBeenCalledWith({
      projectRootPath: "/repo/pier",
    });
    expect(useLocalEnvironmentsStore.getState().projects).toEqual(
      EMPTY_SNAPSHOT.projects
    );
  });

  it("updateProject sends flat payload without environmentId or name", async () => {
    updateMock.mockResolvedValue(PROJECT_SNAPSHOT);

    const state = useLocalEnvironmentsStore.getState();
    await state.updateProject({
      cleanupCommand: "cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    });
    expect(window.pier.environments.update).toHaveBeenCalledWith({
      cleanupCommand: "cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo/pier",
      setupCommand: "setup",
    });
  });

  it("worktreeBinding delegates to environments.worktreeBinding and returns the binding snapshot", async () => {
    const binding: WorktreeBindingSnapshot = {
      cleanupCommand: "pnpm cleanup:worktree",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      hasCleanupScript: true,
      projectRootPath: "/repo/pier",
      setupCommand: "pnpm setup:worktree",
      worktreePath: "/repo/pier.worktree/feature",
    };
    worktreeBindingMock.mockResolvedValue(binding);

    await expect(
      useLocalEnvironmentsStore
        .getState()
        .worktreeBinding({ worktreePath: "/repo/pier.worktree/feature" })
    ).resolves.toEqual(binding);

    expect(worktreeBindingMock).toHaveBeenCalledWith({
      worktreePath: "/repo/pier.worktree/feature",
    });
  });
});
