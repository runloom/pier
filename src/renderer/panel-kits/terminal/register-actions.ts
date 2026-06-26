/**
 * Terminal panel-kit 自有 actions — surface="terminal/content" 投影到终端内右键菜单.
 *
 * 这是 "panel-kit 作为后续插件" 的样板: kit 自己 import actionRegistry, 在自己模块
 * 内 register, 主程序 bootstrap 调一次 registerTerminalActions(). 未来第三方 kit
 * 同样模式 (panel-kits/<name>/register-actions.ts), 不需改 main.tsx.
 *
 * terminal 内容操作由 kit 自己注册; newTerminal 在 panel-actions.ts 内通过 surfaces
 * 扩到 "terminal/content" 直接复用, 不在此文件重复注册.
 */
import type { TerminalOperation } from "@shared/contracts/terminal.ts";
import i18next from "i18next";
import { X } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function activeTerminalPanelId(): string | null {
  const panel = useWorkspaceStore.getState().api?.activePanel;
  return panel?.view.contentComponent === "terminal" ? panel.id : null;
}

function registerTerminalOperationAction(opts: {
  id: string;
  i18nKey: string;
  operation: TerminalOperation;
  sortOrder: number;
}): () => void {
  return actionRegistry.register({
    category: "Terminal",
    enabled: () => activeTerminalPanelId() != null,
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
    metadata: { group: "0_edit", sortOrder: opts.sortOrder },
    surfaces: ["terminal/content"],
    title: () => i18next.t(opts.i18nKey),
  });
}

export function registerTerminalActions(): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    registerTerminalOperationAction({
      id: "pier.terminal.copy",
      i18nKey: "contextMenu.action.copy",
      operation: "copy",
      sortOrder: 1,
    })
  );
  disposers.push(
    registerTerminalOperationAction({
      id: "pier.terminal.paste",
      i18nKey: "contextMenu.action.paste",
      operation: "paste",
      sortOrder: 2,
    })
  );
  disposers.push(
    registerTerminalOperationAction({
      id: "pier.terminal.selectAll",
      i18nKey: "contextMenu.action.selectAll",
      operation: "selectAll",
      sortOrder: 3,
    })
  );
  disposers.push(
    registerTerminalOperationAction({
      id: "pier.terminal.clearScreen",
      i18nKey: "contextMenu.action.clearScreen",
      operation: "clearScreen",
      sortOrder: 4,
    })
  );

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => {
        // alias: 把 close 行为统一委派给 pier.panel.close handler.
        // 未来给"关闭"加 dirty-check / confirm 时只需改一处.
        actionRegistry.get("pier.panel.close")?.handler();
      },
      id: "pier.terminal.close",
      metadata: { group: "9_close", iconComponent: X, sortOrder: 1 },
      surfaces: ["terminal/content"],
      title: () => i18next.t("contextMenu.action.closeTerminal"),
    })
  );

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
