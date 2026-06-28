import type { DockviewTheme } from "dockview-react";

/**
 * Pier dockview theme 对象 — 配合 CSS class dockview-theme-pier 使用。
 *
 * gap: 0 — Pier 透明 WKWebView + 终端 NSView 架构下, panel content 区域被 NSView
 * 视觉覆盖. 新 sash ::before 内线方案直接渲染在 .dv-sash 容器上 (sash z-index: 99
 * 在 NSView 之上), 不再依赖 panel 间空隙暴露视觉线; gap 改 0 避免 panel 之间透明缝隙
 * 跟 sash 内线并列显示成"两条线"伪影.
 *
 * dndOverlayMounting: 'absolute' — 让 root drop UI 渲染到 shell 根层级,
 * 配合 input routing 拖拽监听让 group drop UI 可接收输入.
 */
export const pierTheme: DockviewTheme = {
  name: "pier",
  className: "dockview-theme-pier",
  gap: 0,
  dndOverlayMounting: "absolute",
};
