import type { PanelContext } from "@shared/contracts/panel.ts";
import { beforeEach, describe, expect, it } from "vitest";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import {
  captureAnchoredTerminalTarget,
  hasProjectPathAnchor,
  inheritedActiveTerminalContext,
  resolvePanelPathAnchor,
  resolveWorkspaceAnchor,
} from "@/stores/workspace-panel-helpers.ts";

function makeContext(id: string, cwd: string, updatedAt: number): PanelContext {
  return {
    contextId: id,
    cwd,
    gitRoot: cwd,
    openedPath: cwd,
    projectRootPath: cwd,
    source: "panel",
    updatedAt,
    worktreeKey: cwd,
    worktreeRoot: cwd,
  };
}

const repoA = makeContext("ctx:a", "/repo/a", 10);
const repoB = makeContext("ctx:b", "/repo/b", 20);

interface MockPanel {
  id: string;
  view: { contentComponent: "terminal" | "welcome" };
}

interface MockGroup {
  activePanel?: MockPanel;
  id: string;
  panels: MockPanel[];
}

function terminalPanel(id: string): MockPanel {
  return { id, view: { contentComponent: "terminal" } };
}

function welcomePanel(id: string): MockPanel {
  return { id, view: { contentComponent: "welcome" } };
}

function createApi(options: {
  activeGroupId?: string;
  activePanelId: string;
  groups: MockGroup[];
}) {
  const panels = options.groups.flatMap((group) => group.panels);
  const activePanel =
    panels.find((panel) => panel.id === options.activePanelId) ?? panels[0];
  const activeGroup =
    options.groups.find((group) => group.id === options.activeGroupId) ??
    options.groups.find((group) =>
      group.panels.some((panel) => panel.id === options.activePanelId)
    ) ??
    options.groups[0];
  return {
    activeGroup,
    activePanel,
    groups: options.groups,
    panels,
  };
}

describe("resolveWorkspaceAnchor", () => {
  beforeEach(() => {
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
  });

  it("uses the source panel context when present", () => {
    const api = createApi({
      activePanelId: "welcome-1",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-1"), terminalPanel("terminal-1")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "a" },
    });

    expect(
      resolveWorkspaceAnchor({
        api: api as never,
        sourcePanelContext: {
          ...repoA,
          contextId: "ctx:explicit",
          cwd: "/explicit",
        },
        sourcePanelGroupId: "group-a",
        sourcePanelId: "welcome-1",
      })
    ).toEqual({
      context: expect.objectContaining({
        contextId: "ctx:explicit",
        cwd: "/explicit",
      }),
      groupId: "group-a",
    });
  });

  it("treats welcome as a global pathless panel (no sibling terminal fallback)", () => {
    const terminalOld = terminalPanel("terminal-old");
    const terminalActive = terminalPanel("terminal-active");
    const welcome = welcomePanel("welcome-1");
    const api = createApi({
      activePanelId: "welcome-1",
      groups: [
        {
          activePanel: terminalActive,
          id: "group-a",
          panels: [terminalOld, welcome, terminalActive],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-old", {
      context: repoA,
      display: { short: "old" },
    });
    usePanelDescriptorStore.getState().upsert("terminal-active", {
      context: repoB,
      display: { short: "active" },
    });
    // Welcome intentionally has no descriptor context.

    expect(
      resolveWorkspaceAnchor({
        api: api as never,
        sourcePanelGroupId: "group-a",
        sourcePanelId: "welcome-1",
      })
    ).toEqual({
      groupId: "group-a",
    });
    expect(
      hasProjectPathAnchor({
        api: api as never,
        sourcePanelId: "welcome-1",
      })
    ).toBe(false);
  });

  it("does not read a foreign activePanel when only sourcePanelGroupId is set", () => {
    const api = createApi({
      activeGroupId: "group-b",
      activePanelId: "terminal-b",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-a"), terminalPanel("terminal-a")],
        },
        {
          id: "group-b",
          panels: [terminalPanel("terminal-b")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-a", {
      context: repoA,
      display: { short: "a" },
    });
    usePanelDescriptorStore.getState().upsert("terminal-b", {
      context: repoB,
      display: { short: "b" },
    });
    usePanelDescriptorStore.getState().upsert("welcome-a", {
      context: repoA,
      display: { short: "wb" },
    });

    expect(
      resolveWorkspaceAnchor({
        api: api as never,
        sourcePanelGroupId: "group-a",
        sourcePanelId: "welcome-a",
      })
    ).toEqual({
      context: repoA,
      groupId: "group-a",
    });
  });

  it("does not steal a sibling terminal cwd when the source terminal has no context", () => {
    const api = createApi({
      activePanelId: "terminal-empty",
      groups: [
        {
          id: "group-a",
          panels: [
            terminalPanel("terminal-empty"),
            terminalPanel("terminal-1"),
          ],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "a" },
    });

    expect(
      resolveWorkspaceAnchor({
        api: api as never,
        sourcePanelGroupId: "group-a",
        sourcePanelId: "terminal-empty",
      })
    ).toEqual({ groupId: "group-a" });
  });

  it("capture pins null context for empty source terminal", () => {
    const api = createApi({
      activePanelId: "terminal-empty",
      groups: [
        {
          id: "group-a",
          panels: [
            terminalPanel("terminal-empty"),
            terminalPanel("terminal-1"),
          ],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "a" },
    });

    expect(
      captureAnchoredTerminalTarget(api as never, {
        sourcePanelGroupId: "group-a",
        sourcePanelId: "terminal-empty",
      })
    ).toEqual({ context: null, groupId: "group-a" });
  });

  it("captureAnchoredTerminalTarget from global welcome pins null context", () => {
    const api = createApi({
      activePanelId: "welcome-1",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-1"), terminalPanel("terminal-1")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "a" },
    });

    expect(
      captureAnchoredTerminalTarget(api as never, {
        sourcePanelGroupId: "group-a",
        sourcePanelId: "welcome-1",
      })
    ).toEqual({
      context: null,
      groupId: "group-a",
    });
  });

  it("inheritedActiveTerminalContext is empty on global welcome", () => {
    const api = createApi({
      activePanelId: "welcome-1",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-1"), terminalPanel("terminal-1")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoB,
      display: { short: "b" },
    });

    expect(inheritedActiveTerminalContext(api as never)).toBeUndefined();
  });

  it("omits context under shellDefault policy for terminal inheritance", () => {
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "shellDefault",
    });
    const api = createApi({
      activePanelId: "terminal-1",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-1"), terminalPanel("terminal-1")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "t" },
    });

    expect(
      resolveWorkspaceAnchor({
        api: api as never,
        sourcePanelGroupId: "group-a",
        sourcePanelId: "terminal-1",
      })
    ).toEqual({ groupId: "group-a" });

    // Panel path anchor still available for tasks / agents (not cwd policy).
    expect(
      resolvePanelPathAnchor({
        api: api as never,
        sourcePanelGroupId: "group-a",
        sourcePanelId: "terminal-1",
      })
    ).toEqual({
      context: repoA,
      groupId: "group-a",
    });
  });

  it("hasProjectPathAnchor is false for global pathless panels", () => {
    const api = createApi({
      activePanelId: "welcome-1",
      groups: [
        {
          id: "group-a",
          panels: [welcomePanel("welcome-1"), terminalPanel("terminal-1")],
        },
      ],
    });
    usePanelDescriptorStore.getState().upsert("terminal-1", {
      context: repoA,
      display: { short: "a" },
    });

    expect(
      hasProjectPathAnchor({
        api: api as never,
        sourcePanelId: "welcome-1",
      })
    ).toBe(false);
  });
});
