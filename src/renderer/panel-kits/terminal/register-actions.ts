import type { TerminalOperation } from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { Paperclip, Pencil, PenLine, Search, X } from "lucide-react";
import { toast } from "sonner";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  activeTerminalPanelId,
  rendererActionContributionRuntime,
} from "@/lib/actions/renderer-action-runtime.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import {
  canRenameAgentSession,
  promptRenameAgentSession,
} from "@/lib/agent-runtime/rename-agent-session.ts";
import { selectedTextFromInvocation } from "@/lib/context-menu/selection-text.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { isTerminalComposerOpen } from "@/stores/terminal-composer-takeover.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import {
  dispatchTerminalComposerAttach,
  dispatchTerminalOpenComposer,
} from "./composer-events.ts";
import { isAgentComposerEligibleForPanel } from "./composer-mount.ts";
import { dispatchTerminalOpenSearch } from "./search-events.ts";

function resolveTerminalPanelId(invocation?: ActionInvocation): string | null {
  return invocation?.sourcePanelId ?? activeTerminalPanelId();
}

function agentComposerTitle(invocation?: ActionInvocation): string {
  const panelId = resolveTerminalPanelId(invocation);
  return i18next.t(
    panelId != null && isTerminalComposerOpen(panelId)
      ? "contextMenu.action.closeRichInput"
      : "contextMenu.action.openRichInput"
  );
}

async function runTerminalOperation(
  panelId: string,
  operation: TerminalOperation
): Promise<void> {
  const result = await window.pier.terminal.performOperation(
    panelId,
    operation
  );
  if (result.ok) {
    return;
  }
  await showAppAlert({
    body: result.error,
    title: i18next.t("contextMenu.action.terminalOperationFailed"),
  });
}

function terminalOperationContribution(opts: {
  enabled?: (invocation?: ActionInvocation) => boolean;
  id: string;
  operation: TerminalOperation;
  sortOrder: number;
  titleKey: string;
}): ActionContribution {
  return {
    categoryKey: "terminal",
    ...(opts.enabled ? { enabled: opts.enabled } : {}),
    group: "0_edit",
    handler: async (invocation) => {
      const panelId = resolveTerminalPanelId(invocation);
      if (!panelId) {
        return;
      }
      await runTerminalOperation(panelId, opts.operation);
    },
    id: opts.id,
    sortOrder: opts.sortOrder,
    surfaces: ["terminal/content"],
    titleKey: opts.titleKey,
    when: "terminal.hasActivePanel",
  };
}

function hasPinnedTerminalSelection(invocation?: ActionInvocation): boolean {
  return selectedTextFromInvocation(invocation).length > 0;
}

export const TERMINAL_ACTION_CONTRIBUTIONS: readonly ActionContribution[] = [
  terminalOperationContribution({
    // 无选区禁用；打开菜单时由 panel 钉 selectedText。
    enabled: hasPinnedTerminalSelection,
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
    handler: (invocation) => {
      const panelId = resolveTerminalPanelId(invocation);
      if (!panelId) {
        return;
      }
      dispatchTerminalOpenSearch(panelId);
    },
    iconComponent: Search,
    id: "pier.terminal.search",
    shortcutSourceId: "pier.find",
    sortOrder: 4,
    surfaces: ["terminal/content"],
    titleKey: "contextMenu.action.find",
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
    enabled: hasPinnedTerminalSelection,
    group: "0_edit",
    handler: async (invocation) => {
      const panelId = resolveTerminalPanelId(invocation);
      const text = selectedTextFromInvocation(invocation);
      if (!(panelId && text.length > 0)) {
        return;
      }
      // paste 文本后注入 Return（sendText submit 语义）。
      const result = await window.pier.terminal.sendText({
        panelId,
        submit: true,
        text: text.replace(/\n+$/u, ""),
      });
      if (!result.ok) {
        await showAppAlert({
          body: result.error,
          title: i18next.t("contextMenu.action.terminalOperationFailed"),
        });
      }
    },
    id: "pier.terminal.runSelection",
    sortOrder: 6,
    surfaces: ["terminal/content"],
    titleKey: "contextMenu.action.runSelection",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    enabled: () => {
      const id = activeTerminalPanelId();
      return id != null && isAgentComposerEligibleForPanel(id);
    },
    group: "2_agent",
    handler: () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        toast.error(i18next.t("terminal.composer.noActiveTerminal"));
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
    sortOrder: 2,
    surfaces: ["terminal/content", "command-palette"],
    title: agentComposerTitle,
    titleKey: "contextMenu.action.openRichInput",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    enabled: () => {
      const id = activeTerminalPanelId();
      return id != null && isAgentComposerEligibleForPanel(id);
    },
    group: "2_agent",
    handler: () => {
      const panelId = activeTerminalPanelId();
      if (!panelId) {
        return;
      }
      dispatchTerminalComposerAttach(panelId);
    },
    iconComponent: Paperclip,
    id: "pier.terminal.composerAttach",
    sortOrder: 3,
    surfaces: ["command-palette"],
    titleKey: "contextMenu.action.attachRichInputFile",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    enabled: (invocation) => {
      const id = resolveTerminalPanelId(invocation);
      return id != null && canRenameAgentSession(id);
    },
    group: "2_agent",
    handler: async (invocation) => {
      const panelId = resolveTerminalPanelId(invocation);
      if (!panelId) {
        return;
      }
      const panel = useWorkspaceStore
        .getState()
        .api?.panels.find((candidate) => candidate.id === panelId);
      panel?.api.setActive();
      await promptRenameAgentSession({ panelId });
    },
    iconComponent: Pencil,
    id: "pier.terminal.renameAgentSession",
    menuHidden: (invocation) => {
      const id = resolveTerminalPanelId(invocation);
      return id == null || !canRenameAgentSession(id);
    },
    sortOrder: 1,
    surfaces: ["terminal/content", "dockview-tab", "command-palette"],
    titleKey: "contextMenu.action.renameAgentSession",
    when: "terminal.hasActivePanel",
  },
  {
    categoryKey: "terminal",
    group: "9_close",
    handler: (invocation) => {
      const panelId = resolveTerminalPanelId(invocation);
      if (panelId) {
        useWorkspaceStore
          .getState()
          .closePanel(panelId)
          .catch((err: unknown) => {
            console.error("[terminal] closePanel failed:", err);
          });
        return;
      }
      const closeAction = actionRegistry.get("pier.panel.close");
      if (!closeAction) {
        return;
      }
      Promise.resolve(closeAction.handler(invocation)).catch((err: unknown) => {
        console.error("[terminal] pier.panel.close failed:", err);
      });
    },
    iconComponent: X,
    id: "pier.terminal.close",
    sortOrder: 1,
    surfaces: ["terminal/content", "terminal/restored"],
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
      actionRegistry.get("pier.find")?.handler();
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
