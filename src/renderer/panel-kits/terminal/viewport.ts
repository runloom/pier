/**
 * 终端视口坐标读取 —— 无副作用的纯几何工具。
 *
 * 单独从 terminal-layout-coordinator.ts 抽出来，是因为 terminal.store.ts 也
 * 需要在 flush 时读一次 viewport frame，而 coordinator 又反向依赖 store 的
 * 状态（suppressTerminals / placeholderVisible 等）——直接引会成环。此文件
 * 只吃 window 全局 + zoom store（后者在 store 依赖树的叶子），两边同时引都
 * 不会形成 cycle。
 */
import type { TerminalFrame } from "@shared/contracts/terminal.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

/** 当前浏览器 viewport 换算到 native content-view 坐标系的整帧。 */
export function readTerminalViewportFrame(): TerminalFrame {
  return cssRectToContentViewRect(
    {
      height: window.innerHeight,
      width: window.innerWidth,
      x: 0,
      y: 0,
    },
    useZoomStore.getState().windowZoomLevel
  );
}

/** 单个 anchor 元素 (`getBoundingClientRect`) 换算到 native content-view 坐标系。 */
export function readTerminalAnchorFrame(
  anchor: HTMLDivElement
): TerminalFrame | null {
  const r = anchor.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) {
    return null;
  }
  return cssRectToContentViewRect(
    {
      height: r.height,
      width: r.width,
      x: r.x,
      y: r.y,
    },
    useZoomStore.getState().windowZoomLevel
  );
}
