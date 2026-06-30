import type { CSSProperties } from "react";

interface TerminalSurfacePlaceholderProps {
  className: string;
  style: CSSProperties;
}

/**
 * 终端表面占位：终端背景色纯色块，盖住 native 终端区域。两种时机显示——
 * native 终端首次就绪前，以及窗口 resize 期间（见 terminal-resize.store /
 * terminal-layout-coordinator 的 handleResizePhase）。
 *
 * 预留：resize 期间未来可在此渲染 native 终端快照替代纯色背景——数据流已就位，
 * 只需新增一个 snapshot data URL 入参、在此铺一张 <img>，无需改动占位结构。
 */
export function TerminalSurfacePlaceholder({
  className,
  style,
}: TerminalSurfacePlaceholderProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      data-testid="terminal-placeholder"
      style={style}
    />
  );
}
