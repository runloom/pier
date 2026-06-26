import { useEffect } from "react";
import {
  type PanelDescriptor,
  useActiveDescriptor,
} from "@/stores/panel-descriptor.store.ts";

/**
 * 解析"长形式"字符串 — sink 共享的 fallback 链.
 *
 * 优先级:display.long > display.short.
 */
export function resolveLong(d: PanelDescriptor): string {
  return d.display.long ?? d.display.short;
}

/**
 * DocumentTitle — 把当前 active panel 的 descriptor 同步到 document.title.
 *
 * Electron BrowserWindow.title 默认跟随 webContents.document.title 变化, 主进程
 * 不需要 IPC. 无 active panel 时 fallback "Pier".
 *
 * 渲染 null:这是个纯 side-effect 组件, 不占 DOM.
 */
export function DocumentTitle(): null {
  const active = useActiveDescriptor();
  useEffect(() => {
    const text = active ? resolveLong(active) : null;
    document.title = text ? `${text} — Pier` : "Pier";
  }, [active]);
  return null;
}
