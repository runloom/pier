import type { AgentKind } from "@shared/contracts/agent.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { registerAgentStartActions } from "@/lib/actions/agent-start-actions.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const prepareLaunch = vi.fn();
const addTerminal = vi.fn(() => "terminal-1");
let disposeAgentStartActions: (() => void) | null = null;

function registeredAgentActions() {
  return actionRegistry
    .list()
    .filter((action) => action.id.startsWith("pier.agent.start."));
}

function seedAgents(
  detectedIds: AgentKind[],
  disabledAgentIds: AgentKind[] = []
): void {
  useAgentDetectStore.setState({
    detectedIds,
    hasDetected: true,
    isDetecting: false,
    isRefreshing: false,
  });
  useAgentPreferencesStore.setState({
    defaultAgentId: null,
    disabledAgentIds,
  });
}

describe("agent start actions", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    keybindingRegistry.loadUserKeymap([]);
    vi.clearAllMocks();
    resetAppDialogForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { agents: { prepareLaunch } },
    });
    seedAgents([]);
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
    useWorkspaceStore.setState({ addTerminal, api: null } as never);
    disposeAgentStartActions = registerAgentStartActions();
  });

  afterEach(async () => {
    disposeAgentStartActions?.();
    disposeAgentStartActions = null;
    seedAgents([]);
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
    useWorkspaceStore.setState({ api: null } as never);
    resetAppDialogForTests();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "pier");
    await i18next.changeLanguage("en");
  });

  it("keeps one action per detected and enabled agent", () => {
    seedAgents(["claude", "codex", "gemini"], ["codex"]);

    expect(registeredAgentActions().map((action) => action.id)).toEqual([
      "pier.agent.start.claude",
      "pier.agent.start.gemini",
    ]);
    for (const action of registeredAgentActions()) {
      expect(action.surfaces).toEqual(["command-palette", "create-menu"]);
    }

    seedAgents(["codex"]);
    expect(registeredAgentActions().map((action) => action.id)).toEqual([
      "pier.agent.start.codex",
    ]);
  });

  it("uses localized titles and searchable command aliases", async () => {
    seedAgents(["claude"]);
    const action = actionRegistry.get("pier.agent.start.claude");

    expect(action?.title()).toBe("Start Claude");
    expect(action?.metadata?.aliases?.()).toEqual(
      expect.arrayContaining(["Claude", "claude"])
    );

    await i18next.changeLanguage("zh-CN");
    expect(action?.title()).toBe("启动 Claude");
  });

  it("marks only the selected default agent with the default shortcut", () => {
    seedAgents(["claude", "codex"]);
    useAgentPreferencesStore.setState({ defaultAgentId: "codex" });

    expect(
      actionRegistry.get("pier.agent.start.claude")?.metadata?.shortcutSourceId
    ).toBeUndefined();
    expect(
      actionRegistry.get("pier.agent.start.codex")?.metadata?.shortcutSourceId
    ).toBe("pier.agent.new");

    useAgentPreferencesStore.setState({ defaultAgentId: "claude" });
    expect(
      actionRegistry.get("pier.agent.start.claude")?.metadata?.shortcutSourceId
    ).toBe("pier.agent.new");
    expect(
      actionRegistry.get("pier.agent.start.codex")?.metadata?.shortcutSourceId
    ).toBeUndefined();
  });

  it("keeps a bound unavailable agent manageable without launch surfaces", () => {
    keybindingRegistry.loadUserKeymap([
      {
        commandId: "pier.agent.start.claude",
        keys: "Mod+Alt+KeyA",
        scope: "global",
      },
    ]);

    const hidden = actionRegistry.get("pier.agent.start.claude");
    expect(hidden).toBeDefined();
    expect(hidden?.surfaces).toEqual([]);
    expect(hidden?.enabled?.()).toBe(false);

    useWorkspaceStore.setState({ api: { groups: [] } } as never);
    seedAgents(["claude"]);
    expect(actionRegistry.get("pier.agent.start.claude")?.surfaces).toEqual([
      "command-palette",
      "create-menu",
    ]);

    seedAgents([]);
    expect(actionRegistry.get("pier.agent.start.claude")?.surfaces).toEqual([]);
    expect(
      keybindingRegistry.getBindingsFor("pier.agent.start.claude")
    ).toHaveLength(1);
  });

  it("disables launch actions until the workspace API is ready", () => {
    seedAgents(["claude"]);
    const action = actionRegistry.get("pier.agent.start.claude");

    expect(action?.enabled?.()).toBe(false);

    useWorkspaceStore.setState({ api: { groups: [] } } as never);
    expect(action?.enabled?.()).toBe(true);
  });

  it("keeps the invoking panel context while launch preparation is pending", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const otherGroup = { id: "other-group", panels: [] };
    const sourceContext = {
      contextId: "ctx-source",
      cwd: "/repo/source",
      openedPath: "/repo/source",
      projectRootPath: "/repo/source",
      source: "panel" as const,
      updatedAt: 1,
      worktreeKey: "/repo/source",
    };
    useWorkspaceStore.setState({
      addTerminal,
      api: { activeGroup: sourceGroup, groups: [sourceGroup, otherGroup] },
    } as never);
    seedAgents(["claude"]);
    const launch = Promise.withResolvers<{ launchId: string | null }>();
    prepareLaunch.mockReturnValueOnce(launch.promise);

    const pending = actionRegistry.get("pier.agent.start.claude")?.handler({
      sourcePanelContext: sourceContext,
      sourcePanelGroupId: "source-group",
      sourcePanelId: "terminal-source",
    });
    useWorkspaceStore.setState({
      api: { activeGroup: otherGroup, groups: [sourceGroup, otherGroup] },
    } as never);
    launch.resolve({ launchId: "launch-source" });
    await pending;

    expect(addTerminal).toHaveBeenCalledWith({
      context: sourceContext,
      launchId: "launch-source",
      referenceGroup: sourceGroup,
    });
  });

  it("omits panel context when the shell-default CWD policy is selected", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const sourceContext = {
      contextId: "ctx-source",
      cwd: "/repo/source",
      openedPath: "/repo/source",
      projectRootPath: "/repo/source",
      source: "panel" as const,
      updatedAt: 1,
      worktreeKey: "/repo/source",
    };
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "shellDefault",
    });
    useWorkspaceStore.setState({
      addTerminal,
      api: { activeGroup: sourceGroup, groups: [sourceGroup] },
    } as never);
    seedAgents(["claude"]);
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-shell-default" });

    await actionRegistry.get("pier.agent.start.claude")?.handler({
      sourcePanelContext: sourceContext,
      sourcePanelGroupId: "source-group",
      sourcePanelId: "terminal-source",
    });

    expect(addTerminal).toHaveBeenCalledWith({
      launchId: "launch-shell-default",
      referenceGroup: sourceGroup,
    });
  });

  it("fails visibly when the invoking panel group closes during launch preparation", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const otherGroup = { id: "other-group", panels: [] };
    useWorkspaceStore.setState({
      addTerminal,
      api: { activeGroup: sourceGroup, groups: [sourceGroup] },
    } as never);
    seedAgents(["claude"]);
    const launch = Promise.withResolvers<{ launchId: string | null }>();
    prepareLaunch.mockReturnValueOnce(launch.promise);

    const pending = actionRegistry.get("pier.agent.start.claude")?.handler({
      sourcePanelGroupId: "source-group",
    });
    useWorkspaceStore.setState({
      api: { activeGroup: otherGroup, groups: [otherGroup] },
    } as never);
    launch.resolve({ launchId: "launch-orphaned" });
    await pending;

    expect(addTerminal).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn’t start agent");
  });

  it("creates the terminal in the invocation group", async () => {
    const group = { id: "group-1", panels: [] };
    useWorkspaceStore.setState({
      addTerminal,
      api: { groups: [group] },
    } as never);
    seedAgents(["claude"]);
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-1" });

    await actionRegistry.get("pier.agent.start.claude")?.handler({
      sourcePanelGroupId: "group-1",
    });

    expect(prepareLaunch).toHaveBeenCalledWith("claude");
    expect(addTerminal).toHaveBeenCalledWith({
      launchId: "launch-1",
      referenceGroup: group,
    });
  });

  it("reports a launch failure when preparation returns no launch", async () => {
    seedAgents(["claude"]);
    prepareLaunch.mockResolvedValueOnce({ launchId: null });

    await actionRegistry.get("pier.agent.start.claude")?.handler();

    expect(addTerminal).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Couldn’t start agent");
  });

  it("shows launch failures with the current locale and raw detail", async () => {
    await i18next.changeLanguage("zh-CN");
    seedAgents(["claude"]);
    prepareLaunch.mockRejectedValueOnce(new Error("launch detail"));

    const pending = actionRegistry.get("pier.agent.start.claude")?.handler();
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "launch detail",
        kind: "alert",
        title: "无法启动智能体",
      });
    });

    resetAppDialogForTests();
    await pending;
  });
});
