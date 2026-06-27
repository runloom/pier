import type { TerminalOperation } from "@shared/contracts/terminal.ts";
import { X } from "lucide-react";
import { registerActionContributions } from "@/lib/actions/contribution-runtime.ts";
import type { ActionContribution } from "@/lib/actions/contribution-types.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  activeTerminalPanelId,
  rendererActionContributionRuntime,
} from "@/lib/actions/renderer-action-runtime.ts";

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
  terminalOperationContribution({
    id: "pier.terminal.clearScreen",
    operation: "clearScreen",
    sortOrder: 4,
    titleKey: "contextMenu.action.clearScreen",
  }),
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

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
