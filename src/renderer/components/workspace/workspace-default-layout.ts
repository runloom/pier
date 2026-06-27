import type { DockviewReadyEvent } from "dockview-react";

/** 默认布局: 单 terminal panel. 当持久化 layout 不存在或恢复失败时使用. */
export function applyDefaultLayout(api: DockviewReadyEvent["api"]): void {
  api.addPanel({
    component: "terminal",
    id: "terminal-1",
    title: "Terminal",
  });
}
