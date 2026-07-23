import {
  agentSessionTitleInput,
  normalizeAgentSessionTitle,
  resolveAgentSessionTitle,
} from "@shared/agent-session-title.ts";
import type { TerminalOperation } from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { Paperclip, Pencil, PenLine, Search, X } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  activeTerminalPanelId,
  rendererActionContributionRuntime,
} from "@/lib/actions/renderer-action-runtime.ts";
import { showAppAlert, showAppPrompt } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import {
  dispatchTerminalComposerAttach,
  dispatchTerminalOpenComposer,
} from "./terminal-composer-events.ts";
import { isAgentComposerEligibleForPanel } from "./terminal-composer-mount.ts";
import { dispatchTerminalOpenSearch } from "./terminal-search-events.ts";

function terminalOperationContribution(opts: {
  id: string;
  operation: TerminalOperation;
  sortOrder: number;
  titleKey: string;
}): ActionContribution {
  return {
    categoryKey: "terminal",
    group: "0_edit",
    handler: async () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      const result = await window.pier.terminal.performOperation(
        panelId,
        opts.operation
      );
      if (!result.ok) {
        console.error("[terminal-actions] operation failed:", result.error);
      }
    },
    id: opts.id,
    sortOrder: opts.sortOrder,
    surfaces: ["terminal/content"],
    titleKey: opts.titleKey,
    when: "terminal.hasActivePanel",
  };
}

export const TERMINAL_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  terminalOperationContribution({
    id: "pier.terminal.copy",
    operation: "copy",
    sortOrder: 1,
    titleKey: "contextMenu.action.copy",
  }),
  terminalOperationContribution({
    id: "pier.terminal.paste",
    operation: "paste",
    sortOrder: 2,
    titleKey: "contextMenu.action.paste",
  }),
  terminalOperationContribution({
    id: "pier.terminal.selectAll",
    operation: "selectAll",
    sortOrder: 3,
    titleKey: "contextMenu.action.selectAll",
  }),
  {
    categoryKey: "terminal",
    group: "0_edit",
    handler: () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      dispatchTerminalOpenSearch(panelId);
    },
    iconComponent: Search,
    id: "pier.terminal.search",
    sortOrder: 4,
    surfaces: ["terminal/content"],
    titleKey: "contextMenu.action.find",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    enabled: () => {
      const id = activeTerminalPanelId();
      return id != null && isAgentComposerEligibleForPanel(id);
    },
    group: "0_edit",
    handler: () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      dispatchTerminalOpenComposer(panelId);
    },
    iconComponent: PenLine,
    id: "pier.terminal.openAgentComposer",
    menuHidden: () => {
      const id = activeTerminalPanelId();
      return id == null || !isAgentComposerEligibleForPanel(id);
    },
    // After Find(4), Clear(5), Preview Selected Text(6).
    sortOrder: 7,
    surfaces: ["terminal/content", "command-palette"],
    titleKey: "contextMenu.action.openRichInput",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    enabled: () => {
      const id = activeTerminalPanelId();
      return id != null && isAgentComposerEligibleForPanel(id);
    },
    group: "0_edit",
    handler: () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      dispatchTerminalComposerAttach(panelId);
    },
    iconComponent: Paperclip,
    id: "pier.terminal.composerAttach",
    // Attach lives on the Rich Input paperclip + ⌘⇧A; keep command palette,
    // but do not crowd the terminal context menu.
    sortOrder: 8,
    surfaces: ["command-palette"],
    titleKey: "contextMenu.action.attachRichInputFile",
    when: "terminal.hasActivePanel",
  },
  terminalOperationContribution({
    id: "pier.terminal.clearScreen",
    operation: "clearScreen",
    sortOrder: 5,
    titleKey: "contextMenu.action.clearScreen",
  }),
  {
    categoryKey: "terminal",
    enabled: () => {
      const id = activeTerminalPanelId();
      if (!id) {
        return false;
      }
      const activity = useForegroundActivityStore.getState().activities[id];
      return activity?.kind === "agent";
    },
    group: "0_edit",
    handler: async () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      const activity =
        useForegroundActivityStore.getState().activities[panelId];
      if (activity?.kind !== "agent") {
        return;
      }
      const current = resolveAgentSessionTitle(
        agentSessionTitleInput({
          agentId: activity.agentId,
          sessionTitle: activity.sessionTitle,
          sessionTitleSource: activity.sessionTitleSource,
        })
      ).primary;
      const next = await showAppPrompt({
        initialValue: current,
        intent: "default",
        placeholder: i18next.t("contextMenu.action.renameAgentSessionPrompt"),
        size: "sm",
        title: i18next.t("contextMenu.action.renameAgentSession"),
        validate: (value) => {
          const normalized = normalizeAgentSessionTitle(value);
          if (!normalized) {
            return i18next.t("contextMenu.action.renameAgentSessionPrompt");
          }
          return null;
        },
      });
      if (next == null) {
        return;
      }
      const normalized = normalizeAgentSessionTitle(next);
      if (!normalized) {
        return;
      }
      try {
        const result = await window.pier.terminal.setSessionTitle(panelId, {
          source: "user",
          title: normalized,
        });
        if (!(result.ok && result.applied)) {
          showAppAlert({
            title: i18next.t("contextMenu.action.renameAgentSessionFailed"),
          });
        }
      } catch (error) {
        showAppAlert({
          body: error instanceof Error ? error.message : String(error),
          title: i18next.t("contextMenu.action.renameAgentSessionFailed"),
        });
      }
    },
    iconComponent: Pencil,
    id: "pier.terminal.renameAgentSession",
    menuHidden: () => {
      const id = activeTerminalPanelId();
      if (!id) {
        return true;
      }
      const activity = useForegroundActivityStore.getState().activities[id];
      return activity?.kind !== "agent";
    },
    sortOrder: 6,
    surfaces: ["dockview-tab", "command-palette"],
    titleKey: "contextMenu.action.renameAgentSession",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    group: "9_close",
    handler: () => {
      actionRegistry.get("pier.panel.close")?.handler();
    },
    iconComponent: X,
    id: "pier.terminal.close",
    sortOrder: 1,
    surfaces: ["terminal/content"],
    titleKey: "contextMenu.action.closeTerminal",
    when: "terminal.hasActivePanel",
  },
];

export function registerTerminalActions(): () => void {
  const disposers = registerActionContributions(
    TERMINAL_ACTION_CONTRIBUTIONS,
    rendererActionContributionRuntime
  );
  const searchOpenRequestDispose = window.pier?.terminal?.onSearchOpenRequest?.(
    () => {
      actionRegistry.get("pier.terminal.search")?.handler();
    }
  );

  if (searchOpenRequestDispose) {
    disposers.push(searchOpenRequestDispose);
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
