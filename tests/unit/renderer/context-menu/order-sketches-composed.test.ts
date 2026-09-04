import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
  FILES_REVEAL_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import { createFilesMarkdownPreviewActions } from "@plugins/builtin/files/renderer/markdown/preview-actions.ts";
import {
  writeMarkdownMeasureMode,
  writeMarkdownReadingAppearance,
} from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { createFilesTreeActions } from "@plugins/builtin/files/renderer/tree/actions.ts";
import {
  GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
  registerGitReviewDiffActions,
} from "@plugins/builtin/git/renderer/review/diff-actions.ts";
import { registerGitReviewTreeActions } from "@plugins/builtin/git/renderer/review/tree-actions.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPanelActions } from "@/lib/actions/panel-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import type { Action } from "@/lib/actions/types.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
import { registerTerminalActions } from "@/panel-kits/terminal/register-actions.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function menuSketch(
  surface: string,
  invocation: {
    metadata?: Record<string, unknown>;
    sourcePanelId?: string;
  } = {}
): Array<"|" | string> {
  const out: Array<"|" | string> = [];
  for (const entry of buildMenuEntries(surface, { ...invocation, surface })) {
    if (entry.type === "separator") {
      out.push("|");
      continue;
    }
    if (entry.type === "action" || entry.type === "checkbox") {
      out.push(entry.id);
      continue;
    }
    if (entry.type === "submenu") {
      for (const child of entry.submenu) {
        if (child.type === "action") {
          out.push(child.id);
        }
      }
    }
  }
  return out;
}

function firstEnabledAction(
  surface: string,
  invocation: {
    metadata?: Record<string, unknown>;
    sourcePanelId?: string;
  } = {}
): string | undefined {
  for (const entry of buildMenuEntries(surface, { ...invocation, surface })) {
    if (entry.type === "action" && entry.enabled) {
      return entry.id;
    }
    if (entry.type === "submenu") {
      for (const child of entry.submenu) {
        if (child.type === "action" && child.enabled) {
          return child.id;
        }
      }
    }
  }
}

function pluginContext(): RendererPluginContext {
  return {
    actions: {
      register: (action: Action) => actionRegistry.register(action),
    },
    configuration: { get: () => undefined, set: async () => undefined },
    dialogs: {
      alert: async () => undefined,
      choice: async () => "cancel",
      confirm: async () => false,
      prompt: async () => null,
    },
    files: {
      exists: async () => ({ exists: false, path: "", root: "" }),
      openInEditor: () => true,
      openProjectDirectory: async () => ({
        instanceId: "x",
        ok: true,
        reused: false,
      }),
      reveal: async () => undefined,
    },
    i18n: {
      commandDescription: () => undefined,
      commandTitle: (_id: string, fallback?: string) => fallback ?? "",
      language: () => "en",
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
    notifications: {
      error: () => undefined,
      info: () => undefined,
      success: () => undefined,
    },
    panels: {
      getActiveContext: () => null,
      getActiveInstanceId: () => "p1",
      listInstances: () => [],
    },
  } as unknown as RendererPluginContext;
}

function setWorkspace(options: {
  groupCount: number;
  panel: {
    id: string;
    params?: Record<string, unknown>;
    contentComponent: string;
  };
}): void {
  const extraGroups = Array.from(
    { length: Math.max(0, options.groupCount - 1) },
    (_, index) => ({
      id: `g${index + 2}`,
      panels: [],
    })
  );
  const panel = {
    id: options.panel.id,
    params: options.panel.params ?? {},
    view: { contentComponent: options.panel.contentComponent },
  };
  useWorkspaceStore.getState().setApi({
    activeGroup: { id: "g1", panels: [panel] },
    activePanel: panel,
    groups: [{ id: "g1", panels: [panel] }, ...extraGroups],
    panels: [panel],
    totalPanels: 1,
  } as never);
}

function setAgentActivity(panelId: string): void {
  useForegroundActivityStore.setState({
    activities: {
      [panelId]: {
        agentId: "codex",
        kind: "agent",
        panelId,
        source: "hook",
        spawnedAt: 1,
        status: "processing",
        subagentCount: 0,
        updatedAt: 2,
        windowId: "win-1",
      },
    },
    ts: 1,
  });
}

describe("context-menu composed sketches", () => {
  const disposers: Array<() => void> = [];

  beforeEach(() => {
    actionRegistry.clearForTests();
    writeMarkdownMeasureMode("comfortable");
    writeMarkdownReadingAppearance("auto");
    const context = pluginContext();
    const controller = {} as FileEditorController;
    disposers.push(
      registerPanelActions(),
      registerTerminalActions(),
      registerRunActions(),
      registerGitReviewTreeActions(context),
      registerGitReviewDiffActions(context)
    );
    for (const action of [
      ...createFilesTreeActions(context, controller),
      ...createFilesMarkdownPreviewActions(context, controller),
    ]) {
      actionRegistry.register(action as Action);
    }
  });

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
    actionRegistry.clearForTests();
    useWorkspaceStore.getState().setApi(null);
    useForegroundActivityStore.setState({ activities: {}, ts: 0 });
  });

  it("uses the first enabled item when copy is greyed out", () => {
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "terminal", id: "terminal-1" },
    });
    expect(
      firstEnabledAction("terminal/content", { sourcePanelId: "terminal-1" })
    ).toBe("pier.terminal.paste");
    expect(
      firstEnabledAction("terminal/content", {
        metadata: { selectedText: "ls" },
        sourcePanelId: "terminal-1",
      })
    ).toBe("pier.terminal.copy");
    const diffMeta = {
      contextId: "ctx",
      gitRootPath: "/repo",
      path: "a.ts",
    };
    expect(firstEnabledAction("git/review-diff", { metadata: diffMeta })).toBe(
      "pier.panel.selectAll"
    );
    expect(
      firstEnabledAction("git/review-diff", {
        metadata: { ...diffMeta, selectedText: "line" },
      })
    ).toBe("pier.panel.copySelection");
  });

  it("sketches git/review-diff with host clipboard and multi-group layout", () => {
    const metadata = {
      contextId: "ctx",
      gitRootPath: "/repo",
      path: "a.ts",
    };
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "pier.git.changes", id: "review-1" },
    });
    expect(menuSketch("git/review-diff", { metadata })).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
      "|",
      "pier.git.review.openDirectory",
      "|",
      "pier.git.review.copyPathWithRange",
      "pier.git.review.revealInFinder",
    ]);
    setWorkspace({
      groupCount: 2,
      panel: { contentComponent: "pier.git.changes", id: "review-1" },
    });
    expect(menuSketch("git/review-diff", { metadata })).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      GIT_REVIEW_OPEN_IN_EDITOR_COMMAND_ID,
      "|",
      "pier.panel.focusRight",
      "pier.panel.focusDown",
      "pier.panel.focusLeft",
      "pier.panel.focusUp",
      "pier.panel.equalizeSplits",
      "|",
      "pier.git.review.openDirectory",
      "|",
      "pier.git.review.copyPathWithRange",
      "pier.git.review.revealInFinder",
    ]);
  });

  it("sketches terminal/content with find, split, and clear after clipboard", () => {
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "terminal", id: "terminal-1" },
    });
    expect(
      menuSketch("terminal/content", { sourcePanelId: "terminal-1" })
    ).toEqual([
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.runSelection",
      "|",
      "pier.terminal.search",
      "|",
      "pier.panel.newTerminal",
      "|",
      "pier.panel.splitRight",
      "pier.panel.splitDown",
      "pier.panel.splitLeft",
      "pier.panel.splitUp",
      "|",
      "pier.terminal.clearScreen",
      "|",
      "pier.terminal.close",
    ]);
  });

  it("sketches terminal/content session and layout without singleton separators", () => {
    setAgentActivity("terminal-1");
    setWorkspace({
      groupCount: 2,
      panel: { contentComponent: "terminal", id: "terminal-1" },
    });
    expect(
      menuSketch("terminal/content", { sourcePanelId: "terminal-1" })
    ).toEqual([
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.runSelection",
      "|",
      "pier.terminal.search",
      "|",
      "pier.panel.newTerminal",
      "pier.terminal.renameAgentSession",
      "pier.terminal.openAgentComposer",
      "|",
      "pier.panel.splitRight",
      "pier.panel.splitDown",
      "pier.panel.splitLeft",
      "pier.panel.splitUp",
      "pier.panel.focusRight",
      "pier.panel.focusDown",
      "pier.panel.focusLeft",
      "pier.panel.focusUp",
      "pier.panel.equalizeSplits",
      "|",
      "pier.terminal.clearScreen",
      "|",
      "pier.terminal.close",
    ]);
  });

  it("sketches terminal/content file link actions before clipboard", () => {
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "terminal", id: "terminal-1" },
    });
    expect(
      menuSketch("terminal/content", {
        metadata: { linkUrl: "file:///tmp/notes.md" },
        sourcePanelId: "terminal-1",
      })
    ).toEqual([
      "pier.terminal.openLink",
      "pier.terminal.copyLink",
      "pier.terminal.revealLink",
      "|",
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.runSelection",
      "|",
      "pier.terminal.search",
      "|",
      "pier.panel.newTerminal",
      "|",
      "pier.panel.splitRight",
      "pier.panel.splitDown",
      "pier.panel.splitLeft",
      "pier.panel.splitUp",
      "|",
      "pier.terminal.clearScreen",
      "|",
      "pier.terminal.close",
    ]);
    expect(
      menuSketch("terminal/content", {
        metadata: { linkUrl: "https://example.com" },
        sourcePanelId: "terminal-1",
      })
    ).toEqual([
      "pier.terminal.openLink",
      "pier.terminal.copyLink",
      "|",
      "pier.terminal.copy",
      "pier.terminal.paste",
      "pier.terminal.selectAll",
      "pier.terminal.runSelection",
      "|",
      "pier.terminal.search",
      "|",
      "pier.panel.newTerminal",
      "|",
      "pier.panel.splitRight",
      "pier.panel.splitDown",
      "pier.panel.splitLeft",
      "pier.panel.splitUp",
      "|",
      "pier.terminal.clearScreen",
      "|",
      "pier.terminal.close",
    ]);
    expect(
      menuSketch("terminal/content", {
        metadata: { linkUrl: "file:///tmp/shot.png" },
        sourcePanelId: "terminal-1",
      })
    ).toContain("pier.terminal.openWithSystemApp");
  });

  it("sketches terminal/restored with host clipboard then close", () => {
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "terminal", id: "restored-1" },
    });
    expect(menuSketch("terminal/restored")).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      "pier.terminal.close",
    ]);
  });

  it("sketches files/canvas-preview without markdown appearance", () => {
    expect(
      menuSketch("files/canvas-preview", {
        metadata: { path: "a.canvas.tsx", root: "/repo" },
      })
    ).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
      "|",
      FILES_REVEAL_COMMAND_ID,
    ]);
  });

  it("sketches panel/content clipboard then layout when multi-group", () => {
    setWorkspace({
      groupCount: 1,
      panel: { contentComponent: "welcome", id: "p1" },
    });
    expect(menuSketch("panel/content")).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
    ]);
    setWorkspace({
      groupCount: 2,
      panel: { contentComponent: "welcome", id: "p1" },
    });
    expect(menuSketch("panel/content")).toEqual([
      "pier.panel.copySelection",
      "pier.panel.selectAll",
      "|",
      "pier.panel.focusRight",
      "pier.panel.focusDown",
      "pier.panel.focusLeft",
      "pier.panel.focusUp",
      "pier.panel.equalizeSplits",
    ]);
  });

  it("sketches dockview-tab preview keep-open before copy path", () => {
    setWorkspace({
      groupCount: 1,
      panel: {
        contentComponent: "pier.files.filePanel",
        id: "file-1",
        params: {
          pinned: false,
          source: { kind: "disk", path: "a.ts", root: "/repo" },
        },
      },
    });
    const sketch = menuSketch("dockview-tab", { sourcePanelId: "file-1" });
    expect(sketch.slice(0, 5)).toEqual([
      "pier.panel.keepOpen",
      "pier.panel.copyPath",
      "pier.panel.copyRelativePath",
      "|",
      "pier.panel.newTerminal",
    ]);
    expect(sketch).toContain("pier.panel.splitRight");
    expect(sketch.at(-1)).toBe("pier.panel.close");
    const keep = sketch.indexOf("pier.panel.keepOpen");
    const copy = sketch.indexOf("pier.panel.copyPath");
    const split = sketch.indexOf("pier.panel.splitRight");
    const close = sketch.indexOf("pier.panel.close");
    expect(keep).toBeLessThan(copy);
    expect(copy).toBeLessThan(split);
    expect(split).toBeLessThan(close);
  });
});
