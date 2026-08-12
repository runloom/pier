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

/** worktree / 项目根叶子名，供窗标题消歧（多窗同文件时 OS 标题可扫）。 */
export function resolveWorkspaceLeaf(d: PanelDescriptor): string | null {
  const anchor =
    d.context?.worktreeRoot ??
    d.context?.projectRootPath ??
    d.context?.gitRoot ??
    d.context?.cwd;
  if (!anchor) {
    return null;
  }
  const segments = anchor.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

function pathBasename(value: string): string | null {
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? null;
}

/**
 * OS / document.title 主文案：长标题 + 工作区叶子（若有且不与主文案重复）。
 * 例：`panel.tsx — feature-canvas-capabilities` 或绝对路径 + worktree 短名。
 */
export function resolveWindowTitlePrimary(d: PanelDescriptor): string {
  const primary = resolveLong(d);
  const leaf = resolveWorkspaceLeaf(d);
  if (!(leaf && leaf !== primary)) {
    return primary;
  }
  // 主文案已以「— leaf」结尾，或路径末段已是 leaf（cwd/worktree 绝对路径）时不重复
  if (primary.endsWith(` — ${leaf}`) || primary.endsWith(`— ${leaf}`)) {
    return primary;
  }
  if (pathBasename(primary) === leaf) {
    return primary;
  }
  if (primary.endsWith(`/${leaf}`) || primary.endsWith(`\\${leaf}`)) {
    return primary;
  }
  return `${primary} — ${leaf}`;
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
    const text = active ? resolveWindowTitlePrimary(active) : null;
    document.title = text ? `${text} — Pier` : "Pier";
  }, [active]);
  return null;
}
