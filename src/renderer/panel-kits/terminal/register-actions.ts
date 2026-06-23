/**
 * Terminal panel-kit 自有 actions — surface="terminal/content" 投影到终端内右键菜单.
 *
 * 这是 "panel-kit 作为后续插件" 的样板: kit 自己 import actionRegistry, 在自己模块
 * 内 register, 主程序 bootstrap 调一次 registerTerminalActions(). 未来第三方 kit
 * 同样模式 (panel-kits/<name>/register-actions.ts), 不需改 main.tsx.
 *
 * Phase 1 只放 1 个 kit 独有 action (close terminal); newTerminal / resetLayout 在
 * panel-actions.ts 内通过 surfaces 数组扩到 "terminal/content" 直接复用, 不在此文件
 * 重复注册. copy / paste / clear 等需要 Ghostty SDK 配合的操作留 Phase 2.
 */
import i18next from "i18next";
import { X } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

export function registerTerminalActions(): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    actionRegistry.register({
      category: "Panel",
      enabled: () => useWorkspaceStore.getState().api?.activePanel != null,
      handler: () => useWorkspaceStore.getState().closeActivePanel(),
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
