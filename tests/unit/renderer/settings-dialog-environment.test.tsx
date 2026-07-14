import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

// ---------------------------------------------------------------------------
// Local type mirrors (avoid importing runtime contracts into test harness)
// ---------------------------------------------------------------------------

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

interface EnvironmentUpdateRequest {
  cleanupCommand: string;
  copyPatterns: string[];
  env: Record<string, string>;
  projectRootPath: string;
  setupCommand: string;
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

interface EnvironmentStoreState {
  addProject: (request: {
    projectRootPath: string;
  }) => Promise<LocalEnvironmentState>;
  projects: LocalEnvironmentProject[];
  removeProject: (request: {
    projectRootPath: string;
  }) => Promise<LocalEnvironmentState>;
  updateProject: (
    request: EnvironmentUpdateRequest
  ) => Promise<LocalEnvironmentState>;
  version: 1;
  worktreeBinding: (request: {
    worktreePath: string;
  }) => Promise<WorktreeBindingSnapshot | null>;
  worktreeBindings: LocalEnvironmentWorktreeBinding[];
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const environmentStore = vi.hoisted(() => ({
  state: null as EnvironmentStoreState | null,
}));

vi.mock("@/stores/local-environments.store.ts", () => ({
  useLocalEnvironmentsStore: <T,>(
    selector?: (state: EnvironmentStoreState) => T
  ) => {
    if (!environmentStore.state) {
      throw new Error("local environment store fixture was not initialized");
    }
    return selector ? selector(environmentStore.state) : environmentStore.state;
  },
}));

const appDialogMocks = vi.hoisted(() => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppConfirm: vi
    .fn<
      (options: {
        body?: string;
        intent: string;
        size: string;
        title: string;
      }) => Promise<boolean>
    >()
    .mockResolvedValue(true),
}));

vi.mock("@/stores/app-dialog.store.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/app-dialog.store.ts")>();
  return {
    ...actual,
    showAppAlert: appDialogMocks.showAppAlert,
    showAppConfirm: appDialogMocks.showAppConfirm,
  };
});

const sonnerMocks = vi.hoisted(() => ({
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: sonnerMocks.success,
  },
}));

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const REGISTRY_INITIAL_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const PLUGIN_SETTINGS_INITIAL_STATE = {
  error: null,
  initialized: false,
  values: {},
};

const DIALOG_INITIAL_STATE = {
  activeSection: "appearance",
  isOpen: false,
};

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function projectFixture(
  rootPath: string,
  overrides?: Partial<LocalEnvironmentProject>
): LocalEnvironmentProject {
  return {
    cleanupCommand: "pnpm cleanup:worktree",
    copyPatterns: [".env*"],
    env: { NODE_ENV: "development" },
    projectRootPath: rootPath,
    setupCommand: "pnpm setup:worktree",
    updatedAt: 1,
    ...overrides,
  };
}

const DEFAULT_SNAPSHOT: LocalEnvironmentState = {
  projects: [projectFixture("/Users/xyz/ABC/pier")],
  version: 1,
  worktreeBindings: [],
};

function pierMock() {
  return {
    environments: {
      onChanged: vi.fn(() => () => undefined),
      pickProjectDirectory: vi.fn(async () => "/Users/xyz/new-project"),
      project: {
        add: vi.fn(async () => DEFAULT_SNAPSHOT),
        remove: vi.fn(async () => DEFAULT_SNAPSHOT),
      },
      snapshot: vi.fn(async () => DEFAULT_SNAPSHOT),
      update: vi.fn(async () => DEFAULT_SNAPSHOT),
      worktreeBinding: vi.fn(async () => null),
    },
    pluginSettings: {
      getAll: vi.fn(async () => ({ values: {}, version: 1 })),
      onChanged: vi.fn(() => () => undefined),
      reset: vi.fn(async () => ({ values: {}, version: 1 })),
      set: vi.fn(async (key: string, value: unknown) => ({
        values: { [key]: value },
        version: 1,
      })),
    },
    preferences: {
      onChanged: vi.fn(() => () => undefined),
      read: vi.fn(async () => makeFakePreferences()),
      update: vi.fn(async () => makeFakePreferences()),
    },
    settings: {
      onOpenRequest: vi.fn(() => () => undefined),
    },
  };
}

function setEnvironmentStoreSnapshot(snapshot: LocalEnvironmentState): void {
  environmentStore.state = {
    ...snapshot,
    addProject: async (request) =>
      window.pier.environments.project.add(request),
    removeProject: async (request) =>
      window.pier.environments.project.remove(request),
    updateProject: async (request) => window.pier.environments.update(request),
    worktreeBinding: async (request) =>
      window.pier.environments.worktreeBinding(request),
  };
}

function registryEntry(): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      workbenchWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test Plugin",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

function openEnvironmentSettings(): void {
  usePluginRegistryStore.setState({
    initialized: true,
    plugins: [registryEntry()],
  });
  act(() => {
    useSettingsDialogStore.setState({
      activeSection: "environment",
      isOpen: true,
    });
  });
  render(<SettingsDialog />);
}

function setActivePanelProjectRootPath(path: string | null): void {
  if (path === null) {
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.setState({ api: null });
    return;
  }
  usePanelDescriptorStore.setState({
    activeId: "panel-1",
    descriptors: {
      "panel-1": {
        context: {
          contextId: "ctx-1",
          projectRootPath: path,
          updatedAt: 1,
        },
        display: { short: "Active Project" },
      },
    },
  });
  useWorkspaceStore.setState({
    api: { activePanel: { id: "panel-1" } } as never,
  });
}

function openProjectRow(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsDialog — Environment section", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.setState({ api: null });
    setEnvironmentStoreSnapshot(DEFAULT_SNAPSHOT);
    appDialogMocks.showAppAlert.mockClear();
    appDialogMocks.showAppConfirm.mockResolvedValue(true);
    sonnerMocks.success.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: pierMock(),
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    usePluginRegistryStore.setState(REGISTRY_INITIAL_STATE);
    usePluginSettingsStore.setState(PLUGIN_SETTINGS_INITIAL_STATE);
    useSettingsDialogStore.setState(DIALOG_INITIAL_STATE);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.setState({ api: null });
    environmentStore.state = null;
  });

  it("shows empty state when there are no projects", () => {
    setEnvironmentStoreSnapshot({
      projects: [],
      version: 1,
      worktreeBindings: [],
    });

    openEnvironmentSettings();

    expect(
      screen.getByRole("heading", { name: "Environment" })
    ).toBeInTheDocument();
    expect(screen.getByText("No environment settings")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add environment setting" })
    ).toHaveAttribute("data-size", "default");
    expect(screen.queryByRole("textbox", { name: "Setup command" })).toBeNull();
  });

  it("shows the project list when there is no active project match", () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    const p2 = projectFixture("/Users/xyz/project-b", {
      setupCommand: "pnpm setup:b",
    });
    setEnvironmentStoreSnapshot({
      projects: [p1, p2],
      version: 1,
      worktreeBindings: [],
    });

    openEnvironmentSettings();

    expect(screen.getByText("/Users/xyz/project-a")).toBeInTheDocument();
    expect(screen.getByText("/Users/xyz/project-b")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Setup command" })).toBeNull();
  });

  it("clicking a project row opens its detail view", () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });

    openEnvironmentSettings();

    openProjectRow("project-a");

    expect(screen.getByRole("textbox", { name: "Setup command" })).toHaveValue(
      "pnpm setup:worktree"
    );
  });

  it("opens detail directly when activeProjectRootPath matches a project", () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    const p2 = projectFixture("/Users/xyz/project-b", {
      setupCommand: "pnpm setup:b",
    });
    setEnvironmentStoreSnapshot({
      projects: [p1, p2],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/project-b");

    openEnvironmentSettings();

    expect(screen.getByRole("textbox", { name: "Setup command" })).toHaveValue(
      "pnpm setup:b"
    );
  });

  it("stays on list when activeProjectRootPath is not in projects", () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/unknown-project");

    openEnvironmentSettings();

    expect(screen.queryByRole("textbox", { name: "Setup command" })).toBeNull();
    expect(screen.getByText("/Users/xyz/project-a")).toBeInTheDocument();
  });

  it("Add environment setting picks folder, adds project and auto-opens detail", async () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    const newPath = "/Users/xyz/new-project";
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });

    const addedSnapshot: LocalEnvironmentState = {
      projects: [p1, projectFixture(newPath)],
      version: 1,
      worktreeBindings: [],
    };
    vi.mocked(window.pier.environments.pickProjectDirectory).mockResolvedValue(
      newPath
    );
    vi.mocked(window.pier.environments.project.add).mockImplementation(() => {
      setEnvironmentStoreSnapshot(addedSnapshot);
      return Promise.resolve(addedSnapshot);
    });

    openEnvironmentSettings();

    fireEvent.click(
      screen.getByRole("button", { name: "Add environment setting" })
    );

    await waitFor(() => {
      expect(
        window.pier.environments.pickProjectDirectory
      ).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(window.pier.environments.project.add).toHaveBeenCalledWith({
        projectRootPath: newPath,
      });
    });
    await waitFor(() => {
      expect(screen.getByText(newPath)).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: "Setup command" })
      ).toBeInTheDocument();
    });
  });

  it("Save dispatches flat updateProject payload after opening detail", async () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/project-a");

    openEnvironmentSettings();

    const setupInput = screen.getByRole("textbox", { name: "Setup command" });
    fireEvent.change(setupInput, { target: { value: "pnpm run dev" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(window.pier.environments.update).toHaveBeenCalledWith({
        cleanupCommand: "pnpm cleanup:worktree",
        copyPatterns: [".env*"],
        env: { NODE_ENV: "development" },
        projectRootPath: "/Users/xyz/project-a",
        setupCommand: "pnpm run dev",
      });
    });
    await waitFor(() => {
      expect(sonnerMocks.success).toHaveBeenCalledWith("Saved");
    });
  });

  it("Save failure surfaces a showAppAlert with the error message", async () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/project-a");

    vi.mocked(window.pier.environments.update).mockRejectedValueOnce(
      new Error("disk full")
    );

    openEnvironmentSettings();

    fireEvent.change(screen.getByRole("textbox", { name: "Setup command" }), {
      target: { value: "pnpm run dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(appDialogMocks.showAppAlert).toHaveBeenCalledWith({
        body: "disk full",
        title: "Save failed",
      });
    });
  });

  it("Back prompts before returning to list when editor is dirty", async () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/project-a");

    openEnvironmentSettings();

    const setupInput = screen.getByRole("textbox", { name: "Setup command" });
    fireEvent.change(setupInput, { target: { value: "dirty" } });

    appDialogMocks.showAppConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(appDialogMocks.showAppConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: "destructive",
          size: "sm",
        })
      );
    });

    expect(screen.getByRole("textbox", { name: "Setup command" })).toHaveValue(
      "dirty"
    );
  });

  it("Delete confirms, removes the project and returns to list", async () => {
    const p1 = projectFixture("/Users/xyz/project-a");
    setEnvironmentStoreSnapshot({
      projects: [p1],
      version: 1,
      worktreeBindings: [],
    });
    setActivePanelProjectRootPath("/Users/xyz/project-a");

    const emptyState: LocalEnvironmentState = {
      projects: [],
      version: 1,
      worktreeBindings: [],
    };
    vi.mocked(window.pier.environments.project.remove).mockImplementation(
      () => {
        setEnvironmentStoreSnapshot(emptyState);
        return Promise.resolve(emptyState);
      }
    );

    openEnvironmentSettings();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete this environment setting" })
    );

    await waitFor(() => {
      expect(appDialogMocks.showAppConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: "destructive",
          size: "sm",
        })
      );
    });
    await waitFor(() => {
      expect(window.pier.environments.project.remove).toHaveBeenCalledWith({
        projectRootPath: "/Users/xyz/project-a",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("No environment settings")).toBeInTheDocument();
    });
  });
});
