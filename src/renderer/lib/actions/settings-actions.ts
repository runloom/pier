/**
 * 设置相关 action: 打开设置弹窗. useSettingsDialogStore 是 zustand 全局 store,
 * 不依赖 React tree, main.tsx bootstrap 同步注册即可.
 *
 * 默认快捷键 Mod+Comma (Cmd+,) 在 defaults.ts 中声明, 与 macOS / VS Code 通行约定
 * 对齐.
 */
import i18next from "i18next";
import { SlidersHorizontal } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

export function registerSettingsActions(): () => void {
  return actionRegistry.register({
    id: "pier.settings.open",
    category: "Settings",
    title: () => i18next.t("commandPalette.action.openSettings"),
    surfaces: ["command-palette"],
    metadata: {
      group: "5_appearance",
      iconComponent: SlidersHorizontal,
      sortOrder: 5,
      keywords: ["settings", "preferences", "设置", "偏好"],
    },
    handler: () => {
      useSettingsDialogStore.getState().open();
    },
  });
}
