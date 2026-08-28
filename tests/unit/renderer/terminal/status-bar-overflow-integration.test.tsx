import type { PluginTerminalStatusItemContribution } from "@shared/contracts/plugin.ts";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TerminalStatusBar,
  terminalStatusItemRegistry,
} from "@/panel-kits/terminal/status-bar.tsx";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }

  disconnect(): void {}
  observe(): void {
    this.callback([], this);
  }
  unobserve(): void {}
}

class TestMutationObserver {
  static instances: TestMutationObserver[] = [];
  private readonly callback: MutationCallback;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    TestMutationObserver.instances.push(this);
  }

  disconnect(): void {}
  observe(): void {
    this.callback([], this);
  }
  takeRecords(): MutationRecord[] {
    return [];
  }
}

function rect(width: number): DOMRect {
  return {
    bottom: 28,
    height: 28,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
    x: 0,
    y: 0,
  } as DOMRect;
}

const INITIAL_PLUGIN_STATE = {
  diagnostics: [],
  error: null,
  initialized: false,
  plugins: [],
};

const STATUS_CONTEXT = {
  context: {
    branch: "main",
    contextId: "ctx",
    cwd: "/repo",
    gitRoot: "/repo",
    openedPath: "/repo",
    projectRootPath: "/repo",
    source: "command" as const,
    updatedAt: 1,
    worktreeKey: "/repo",
    worktreeRoot: "/repo",
  },
  cwd: "/repo",
  getGroupId: () => null,
  panelId: "terminal-1",
  title: null,
};

function pluginEntry(items: PluginTerminalStatusItemContribution[]) {
  return {
    effectivePermissions: [],
    enabled: true,
    manifest: {
      apiVersion: 1 as const,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.git",
      name: "git",
      panels: [],
      permissions: [],
      settingsPages: [],
      source: { kind: "builtin" as const },
      terminalStatusItems: items,
      version: "1.0.0",
      canvasActions: [],
      dataProjections: [],
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" as const },
  };
}

describe("TerminalStatusBar overflow integration", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.stubGlobal("MutationObserver", TestMutationObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    TestResizeObserver.instances = [];
    TestMutationObserver.instances = [];
    useTerminalStatusBarPrefsStore.setState({
      initialized: true,
      prefs: { items: {}, version: 1 },
    });
    usePluginRegistryStore.setState({
      ...INITIAL_PLUGIN_STATE,
      initialized: true,
      plugins: [
        pluginEntry([
          {
            alignment: "right",
            id: "pier.worktree.status",
            order: 12,
            overflowPinned: true,
            overflowPriority: 0,
            permissions: [],
            title: "Branch",
          },
          {
            alignment: "right",
            id: "pier.git.status.changes",
            order: 11,
            overflowPriority: 30,
            permissions: [],
            title: "Changes",
          },
          {
            alignment: "right",
            id: "pier.files.project",
            order: 9,
            overflowPriority: 40,
            permissions: [],
            title: "Project",
          },
        ]),
      ],
    });
  });

  afterEach(() => {
    cleanup();
    terminalStatusItemRegistry.clearForTests();
    usePluginRegistryStore.setState(INITIAL_PLUGIN_STATE);
    useTerminalStatusBarPrefsStore.setState({
      initialized: false,
      prefs: { items: {}, version: 1 },
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("测宽后把空壳与高 priority 项设为 hidden，空壳不占 gap", async () => {
    terminalStatusItemRegistry.register({
      id: "pier.worktree.status",
      render: () => <span data-testid="branch-slot">main</span>,
    });
    terminalStatusItemRegistry.register({
      id: "pier.git.status.changes",
      render: () => null,
    });
    terminalStatusItemRegistry.register({
      id: "pier.files.project",
      render: () => <span data-testid="project-slot">pier</span>,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        const slot = this.dataset.overflowSlot;
        if (slot === "pier.worktree.status") {
          return rect(100);
        }
        if (slot === "pier.files.project") {
          return rect(48);
        }
        if (slot === "pier.git.status.changes") {
          return rect(0);
        }
        if (this.dataset.testid === "terminal-status-bar") {
          return rect(200);
        }
        return rect(0);
      }
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.testid === "terminal-status-bar") {
          // 仅够 branch+project+gaps；若空壳仍计 gap 会误藏 project
          return 160;
        }
        return 0;
      },
    });

    render(<TerminalStatusBar {...STATUS_CONTEXT} />);

    await waitFor(() => {
      const changes = document.querySelector(
        '[data-overflow-slot="pier.git.status.changes"]'
      );
      const project = document.querySelector(
        '[data-overflow-slot="pier.files.project"]'
      );
      const branch = document.querySelector(
        '[data-overflow-slot="pier.worktree.status"]'
      );
      expect(changes).toHaveAttribute("hidden");
      expect(project).not.toHaveAttribute("hidden");
      expect(branch).not.toHaveAttribute("hidden");
    });
  });

  it("空间不足时按声明 overflowPriority 整项隐藏项目名", async () => {
    terminalStatusItemRegistry.register({
      id: "pier.worktree.status",
      render: () => <span>main</span>,
    });
    terminalStatusItemRegistry.register({
      id: "pier.git.status.changes",
      render: () => <span>+2</span>,
    });
    terminalStatusItemRegistry.register({
      id: "pier.files.project",
      render: () => <span>pier</span>,
    });

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        const slot = this.dataset.overflowSlot;
        if (slot === "pier.worktree.status") {
          return rect(100);
        }
        if (slot === "pier.git.status.changes") {
          return rect(60);
        }
        if (slot === "pier.files.project") {
          return rect(48);
        }
        return rect(0);
      }
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.dataset.testid === "terminal-status-bar") {
          return 120;
        }
        return 0;
      },
    });

    await act(async () => {
      render(<TerminalStatusBar {...STATUS_CONTEXT} />);
    });

    await waitFor(() => {
      expect(
        document.querySelector('[data-overflow-slot="pier.files.project"]')
      ).toHaveAttribute("hidden");
      expect(
        document.querySelector('[data-overflow-slot="pier.git.status.changes"]')
      ).toHaveAttribute("hidden");
      expect(
        document.querySelector('[data-overflow-slot="pier.worktree.status"]')
      ).not.toHaveAttribute("hidden");
    });
  });
});
