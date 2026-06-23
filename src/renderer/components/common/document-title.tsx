import { useEffect } from "react";
import {
  type PanelDescriptor,
  useActiveDescriptor,
} from "@/stores/panel-descriptor.store.ts";

/**
 * 解析"长形式"字符串 — sink 共享的 fallback 链.
 *
 * 优先级:path (绝对路径, 信息密度最高) > long > short.
 * terminal panel cd 后 sink 自然显示完整 cwd; 没 path 的 panel 走 long; 都没
 * 兜底 short (descriptor 契约保证 short 必填).
 */
export function resolveLong(d: PanelDescriptor): string {
  return d.path ?? d.long ?? d.short;
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
