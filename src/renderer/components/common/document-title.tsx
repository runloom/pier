import { useEffect } from "react";
import {
  type PanelDescriptor,
  useActiveDescriptor,
} from "@/stores/panel-descriptor.store.ts";

/**
 * 解析"长形式"字符串 — sink 共享的 fallback 链.
 *
 * 优先级:long > path > short.
 *
 * - long 由 panel 主动计算 (terminal 内部已做 sequenceTitle ?? cwd 优先级),
 *   是 sink "应该显示什么"的权威来源.
 * - path 是真实绝对路径, 给没填 long 的 panel 类型兜底 (理论上 terminal 也会
 *   走这里, 但 terminal 一定填 long).
 * - short 是最终兜底, descriptor 契约保证必填.
 *
 * 注意: 不能让 path 排在 long 前面 — 否则 terminal 的 sequenceTitle 永远被
 * 真实 cwd 覆盖, OSC 0/2 失效.
 */
export function resolveLong(d: PanelDescriptor): string {
  return d.long ?? d.path ?? d.short;
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
