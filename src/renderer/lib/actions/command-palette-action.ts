/**
 * 命令面板自身的 toggle action.
 *
 * surfaces 为空: 不在面板里展示 (在面板里看到 "显示命令面板" 自指条目对用户没价值
 * — 已在面板里了). 仍然保留 action 注册以便键盘 dispatch (Cmd+Shift+P) 通过
 * actionRegistry.get 找到 handler.
 */
import i18next from "i18next";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";

export function registerCommandPaletteAction(): () => void {
  return actionRegistry.register({
    id: "pier.commandPalette.toggle",
    category: "View",
    metadata: { group: "9_other" },
    title: () => i18next.t("commandPalette.action.toggleCommandPalette"),
    surfaces: [],
    handler: () => {
      useCommandPaletteController.getState().toggle();
    },
  });
}
