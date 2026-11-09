import { ensureTuiInputFocus } from "@/panel-kits/terminal/tui-input-focus.ts";
import type { PanelKind } from "@/stores/keybinding-scope.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { terminalComposerTakeoverFocus } from "@/stores/terminal-composer-takeover.ts";
import {
  requestTerminalFocusIntent,
  setTerminalBasePanel,
} from "@/stores/terminal-input-routing-slice.ts";

interface ActivePanelLike {
  id: string;
  view: { contentComponent: string };
}

/**
 * dockview active panel → keybinding scope + 终端焦点 base。
 *
 * basePanel 永远反映「前台是哪个终端」，无论键盘归 composer / 搜索还是 native。
 * 缺失这一步时 basePanel 停在初始 web，宿主无法定位需要藏 hardware cursor 的
 * 那个终端（webRequestCount>0 但没有 anchor panel）。
 */
export function syncActivePanelScope(
  panel: ActivePanelLike | null | undefined,
  kindOfComponent: (component: string) => PanelKind
): void {
  if (!panel) {
    useKeybindingScope.getState().setActivePanel(null, null, null);
    setTerminalBasePanel({ kind: "web" });
    return;
  }
  const component = panel.view.contentComponent;
  const kind = kindOfComponent(component);
  useKeybindingScope.getState().setActivePanel(kind, component, panel.id);
  if (kind === "terminal") {
    setTerminalBasePanel({ kind: "terminal", panelId: panel.id });
    // Rich Input 打开时：激活终端面板应 refocus 输入框（reason=activate）；
    // 未接管则走原生焦点归还路径。
    if (!terminalComposerTakeoverFocus(panel.id, "activate")) {
      requestTerminalFocusIntent(panel.id);
      // crush 等 TUI 内部输入框可能失焦（paste/Enter 会被静默丢弃）：
      // 探针确认后按 catalog 白名单恢复。fire-and-forget，内部 per-panel 互斥。
      ensureTuiInputFocus(panel.id).catch(() => undefined);
    }
  } else {
    setTerminalBasePanel({ kind: "web" });
  }
}
