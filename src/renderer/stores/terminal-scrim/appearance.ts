import type {
  TerminalBoxShadow,
  TerminalFrame,
  TerminalScrimBorder,
  TerminalScrimColor,
} from "@shared/contracts/terminal.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import {
  parseCssColor,
  readScrimColor,
  sameScrim,
} from "@/stores/terminal-scrim/color.ts";
import { readOverlayShadows } from "@/stores/terminal-scrim/shadow.ts";

export interface OverlayAppearance {
  radius: number;
  scrim: TerminalScrimColor | undefined;
  scrimBorder: TerminalScrimBorder | undefined;
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
  options: { paints: boolean; scrim: boolean; scrimBorder?: boolean }
): OverlayAppearance {
  const scrim = options.scrim ? readScrimColor(element) : undefined;
  return {
    radius: readOverlayRadiusPx(element, windowZoomLevel),
    scrim,
    // 没有有效蒙层色时不发布边框：native 的 scrim 通道以蒙层条目为入口，
    // 边框不能脱离 scrim 单独存在（契约与 host snapshot 校验同此约束）。
    scrimBorder:
      scrim !== undefined && options.scrimBorder === true
        ? readScrimBorder(element, windowZoomLevel)
        : undefined,
    shadows: options.paints
      ? readOverlayShadows(element, windowZoomLevel)
      : undefined,
  };
}

/**
 * 采样蒙层边框。只有四边同宽、同色、可见且已绘制时才交给 native；
 * 任一边缺失 / 不同就整份放弃，避免 native 画出与网页不一致的框。
 */
export function readScrimBorder(
  element: HTMLElement,
  windowZoomLevel: number
): TerminalScrimBorder | undefined {
  const style = getComputedStyle(element);
  const sides = [
    [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
    [style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
    [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
    [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
  ] as const;
  let width = 0;
  let color: TerminalScrimColor | undefined;
  for (const [rawWidth, rawStyle, rawColor] of sides) {
    if (rawStyle === "none" || rawStyle === "hidden") {
      return;
    }
    const nextWidth = Number.parseFloat(rawWidth);
    if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
      return;
    }
    const nextColor = parseCssColor(rawColor);
    if (!nextColor) {
      return;
    }
    if (color === undefined) {
      width = nextWidth;
      color = nextColor;
      continue;
    }
    if (Math.abs(nextWidth - width) > 0.01 || !sameScrim(color, nextColor)) {
      return;
    }
  }
  if (color === undefined || width <= 0) {
    return;
  }
  const opacity = Number(style.opacity);
  const alpha = color.a * (Number.isFinite(opacity) ? clamp01(opacity) : 1);
  const scaledWidth = cssRectToContentViewRect(
    { height: 0, width, x: 0, y: 0 },
    windowZoomLevel
  ).width;
  if (alpha <= 0 || scaledWidth <= 0) {
    return;
  }
  return { color: { ...color, a: alpha }, width: scaledWidth };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function sameScrimBorder(
  left: TerminalScrimBorder | undefined,
  right: TerminalScrimBorder | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.width === right.width && sameScrim(left.color, right.color);
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
 *
 * Chromium 对 rounded-full 的 computed radius 是 `1.67772e+07px`（指数记法），
 * 且 CSS used radius 会被浏览器钳到 border box 短边的一半。按字面十进制 px
 * 正则解析会得到 0，洞按直角回填——胶囊四角露不透明 backing。
 */
export function readOverlayRadiusPx(
  element: HTMLElement,
  windowZoomLevel: number
): number {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const box = { height: rect.height, width: rect.width };
  const css = Math.max(
    parseRadiusComponent(style.borderTopLeftRadius, box),
    parseRadiusComponent(style.borderTopRightRadius, box),
    parseRadiusComponent(style.borderBottomRightRadius, box),
    parseRadiusComponent(style.borderBottomLeftRadius, box)
  );
  if (css <= 0) {
    return 0;
  }
  const scaled = cssRectToContentViewRect(
    { height: 0, width: css, x: 0, y: 0 },
    windowZoomLevel
  ).width;
  const scaledBox = cssRectToContentViewRect(
    { height: rect.height, width: rect.width, x: 0, y: 0 },
    windowZoomLevel
  );
  const limit = Math.min(scaledBox.width, scaledBox.height) / 2;
  return limit > 0 ? Math.min(scaled, limit) : scaled;
}

const CSS_PX = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px$/i;
const CSS_PERCENT = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)%$/;

/**
 * border-radius 的 computed 值可能是 `24px`、`1.67772e+07px` 或 `50%`；
 * 单个角还可能序列化成椭圆两值 `水平 垂直`。百分比横向按宽、纵向按高
 * 解析；契约只要一个均匀圆角，取短边作基准，椭圆两值取较大者——宁可多
 * 挖一个楔露出终端，也不因欠挖在圆角上留下不透明 backing 角。
 */
function parseRadiusComponent(
  value: string,
  box: { height: number; width: number }
): number {
  return Math.max(
    0,
    ...value
      .trim()
      .split(/\s+/u)
      .map((token) => parseRadiusToken(token, box))
  );
}

function parseRadiusToken(
  token: string,
  box: { height: number; width: number }
): number {
  const px = CSS_PX.exec(token);
  if (px) {
    const parsed = Number(px[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const percent = CSS_PERCENT.exec(token);
  if (percent) {
    const parsed = Number(percent[1]);
    return Number.isFinite(parsed)
      ? (Math.min(box.width, box.height) * parsed) / 100
      : 0;
  }
  return 0;
}
