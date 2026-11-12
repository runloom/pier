import type {
  TerminalBoxShadow,
  TerminalFrame,
  TerminalScrimColor,
} from "@shared/contracts/terminal.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { readScrimColor } from "@/stores/terminal-scrim/color.ts";
import { readOverlayShadows } from "@/stores/terminal-scrim/shadow.ts";

export interface OverlayAppearance {
  radius: number;
  scrim: TerminalScrimColor | undefined;
  shadows: TerminalBoxShadow[] | undefined;
}

/**
 * 浮层外观采样（圆角 / 蒙层色 / 阴影），并记住最近一次结果。
 * animationend 只补几何：淡出结束（fill-mode none，opacity 回 1）再整份重读
 * 会把蒙层/阴影按全强度重发一帧，终端上闪一下；逐帧链已发过当前 opacity
 * 的终帧，色强沿用缓存即可。
 */
export function readOverlayAppearance(
  element: HTMLElement,
  windowZoomLevel: number,
  options: { paints: boolean; scrim: boolean }
): OverlayAppearance {
  return {
    radius: readOverlayRadiusPx(element, windowZoomLevel),
    scrim: options.scrim ? readScrimColor(element) : undefined,
    shadows: options.paints
      ? readOverlayShadows(element, windowZoomLevel)
      : undefined,
  };
}

export function readOverlayFrame(
  element: HTMLElement,
  windowZoomLevel: number
): TerminalFrame | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return cssRectToContentViewRect(
    { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
    windowZoomLevel
  );
}

/**
 * 浮层均匀圆角，换成和 frame 同一套 content-view px。四角不一致取最大：
 * 宁可在 painted 直角上多挖一个楔（洞里露终端），也不在圆角上留兜底色楔。
 * 契约只传一个数；若未来出现 sheet 形（上圆下方）再升级成四角数组。
 */
export function readOverlayRadiusPx(
  element: HTMLElement,
  windowZoomLevel: number
): number {
  const style = getComputedStyle(element);
  const css = Math.max(
    parsePx(style.borderTopLeftRadius),
    parsePx(style.borderTopRightRadius),
    parsePx(style.borderBottomRightRadius),
    parsePx(style.borderBottomLeftRadius)
  );
  if (css <= 0) {
    return 0;
  }
  return cssRectToContentViewRect(
    { height: 0, width: css, x: 0, y: 0 },
    windowZoomLevel
  ).width;
}

const CSS_PX = /^([\d.]+)px$/;

function parsePx(value: string): number {
  const match = CSS_PX.exec(value.trim());
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}
