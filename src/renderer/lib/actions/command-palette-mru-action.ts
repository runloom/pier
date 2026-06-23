/**
 * "清空命令面板使用记录" 元命令.
 *
 * 自身设 excludeFromMru = true, 避免清空后立刻把自己写回 MRU 顶部
 * (体感上违反 "清空" 语义).
 */
import i18next from "i18next";
import { Eraser } from "lucide-react";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteMru } from "@/stores/command-palette-mru.store.ts";

export function registerCommandPaletteMruAction(): () => void {
  return actionRegistry.register({
    id: "pier.commandPalette.clearRecent",
    category: "Settings",
    title: () => i18next.t("commandPalette.action.clearRecent"),
    surfaces: ["command-palette"],
    metadata: {
      iconComponent: Eraser,
      sortOrder: 30,
      excludeFromMru: true,
      keywords: ["clear", "reset", "history", "清空", "重置", "历史"],
    },
    handler: () => {
      useCommandPaletteMru
        .getState()
        .clear()
        .catch(() => undefined);
    },
  });
}
