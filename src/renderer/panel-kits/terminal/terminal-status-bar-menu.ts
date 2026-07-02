/**
 * 终端状态栏右键菜单 — 走原生 Menu.popup(window.pier.menu.popup)而非 Radix
 * ContextMenu:终端面板主体是原生 WebContentsView,层级恒在 base web content
 * 之上,web popover 自状态栏向上展开会被原生视图遮挡;原生菜单也是终端面板
 * 既有右键通道(lib/context-menu/use-context-menu.ts)。
 *
 * 勾选列表数据源 = 已启用插件 manifest 声明的 terminalStatusItems(与设置页
 * 管理块一致,含当前未注册渲染的项);标题经 resolvePluginTerminalStatusItemDisplay
 * i18n 解析。
 */
import type { MenuItem } from "@shared/contracts/menu.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import i18next from "i18next";
import type { MouseEvent as ReactMouseEvent } from "react";
import { resolvePluginTerminalStatusItemDisplay } from "@/lib/plugins/display.ts";
import { cssPointToContentViewPoint } from "@/lib/window-zoom/coordinates.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { resolveEffectiveTerminalStatusItemConfig } from "./terminal-status-bar-merge.ts";

const MANAGE_ACTION_ID = "pier.terminalStatusBar.manage";
const TOGGLE_PREFIX = "pier.terminalStatusBar.toggle:";

interface DeclaredItemRow {
  hidden: boolean;
  itemId: string;
  title: string;
}

function declaredRows(
  plugins: readonly PluginRegistryEntry[],
  prefs: TerminalStatusBarPrefs
): DeclaredItemRow[] {
  const locale = i18next.language || "en";
  const rows: DeclaredItemRow[] = [];
  for (const entry of plugins) {
    if (!entry.enabled) {
      continue;
    }
    for (const item of entry.manifest.terminalStatusItems) {
      const config = resolveEffectiveTerminalStatusItemConfig(
        item,
        prefs.items[item.id]
      );
      rows.push({
        hidden: config.hidden,
        itemId: item.id,
        title: resolvePluginTerminalStatusItemDisplay(
          entry.manifest,
          item,
          locale
        ).title,
      });
    }
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

export async function openTerminalStatusBarContextMenu(
  event: ReactMouseEvent
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  const coords = cssPointToContentViewPoint(
    { x: event.clientX, y: event.clientY },
    useZoomStore.getState().windowZoomLevel
  );
  const rows = declaredRows(
    usePluginRegistryStore.getState().plugins,
    useTerminalStatusBarPrefsStore.getState().prefs
  );
  const template: MenuItem[] = [
    ...rows.map<MenuItem>((row) => ({
      checked: !row.hidden,
      id: `${TOGGLE_PREFIX}${row.itemId}`,
      label: row.title,
      type: "checkbox",
    })),
    ...(rows.length > 0 ? [{ type: "separator" } satisfies MenuItem] : []),
    {
      id: MANAGE_ACTION_ID,
      label: i18next.t("terminal.statusBar.manage"),
      type: "action",
    },
  ];
  const result = await window.pier.menu.popup(template, coords);
  if (!result.actionId) {
    return;
  }
  if (result.actionId === MANAGE_ACTION_ID) {
    useSettingsDialogStore.getState().openSection("terminal");
    return;
  }
  if (result.actionId.startsWith(TOGGLE_PREFIX)) {
    const itemId = result.actionId.slice(TOGGLE_PREFIX.length);
    const row = rows.find((entry) => entry.itemId === itemId);
    if (!row) {
      return;
    }
    // 取消勾选 → hidden: true;重新勾选 → 清除 hidden 字段(回落默认可见)。
    await useTerminalStatusBarPrefsStore
      .getState()
      .patchItemOverride(itemId, { hidden: row.hidden ? null : true });
  }
}
