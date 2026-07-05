import type { DockviewReadyEvent } from "dockview-react";
import {
  clearFreshTerminalPanel,
  markFreshTerminalPanel,
} from "@/stores/terminal-panel-session-hints.store.ts";

/** 默认布局: 单 terminal panel. 当持久化 layout 不存在或恢复失败时使用. */
export function applyDefaultLayout(api: DockviewReadyEvent["api"]): void {
  markFreshTerminalPanel("terminal-1");
  try {
    api.addPanel({
      component: "terminal",
      id: "terminal-1",
      title: "Terminal",
    });
  } catch (err) {
    clearFreshTerminalPanel("terminal-1");
    throw err;
  }
}
