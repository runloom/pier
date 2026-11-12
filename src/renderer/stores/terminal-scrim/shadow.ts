import type {
  TerminalBoxShadow,
  TerminalScrimColor,
} from "@shared/contracts/terminal.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { parseCssColor, sameScrim } from "@/stores/terminal-scrim/color.ts";

// 与 parseCssColor 已支持的记法保持一致（legacy/modern rgb、srgb、oklab）。
// Chromium computed boxShadow 会把 color 归一化成 rgb()/rgba()，不列 oklch 等
// 只因 parseCssColor 也不认——认不出时静默丢这一层，native 不画（fail-quiet，
// 不猜颜色）。当前产品阴影色都走 rgba token，覆盖足够。
const COLOR_FN = /(?:rgba?|color)\(\s*[^)]*\)|#[0-9a-fA-F]{3,8}/;
const LENGTH = /(-?(?:\d+\.?\d*|\.\d+))px/g;

/**
 * 外扩 box-shadow，单位换成和 frame 同一套 content-view px。
 * inset 画在 border box 里，web 回填已经看得见，不送。
 * alpha 乘元素 opacity：淡入改的是 opacity，不是阴影色。
 */
export function readOverlayShadows(
  element: HTMLElement,
  windowZoomLevel: number
): TerminalBoxShadow[] {
  const style = getComputedStyle(element);
  const opacity = Number(style.opacity);
  if (!(opacity > 0)) {
    return [];
  }
  const raw = style.boxShadow;
  if (!raw || raw === "none") {
    return [];
  }
  const shadows: TerminalBoxShadow[] = [];
  for (const piece of splitShadows(raw)) {
    const shadow = parseShadow(piece, opacity, windowZoomLevel);
    if (shadow) {
      shadows.push(shadow);
    }
  }
  return shadows;
}

export function sameOverlayShadows(
  left: TerminalBoxShadow[] | undefined,
  right: TerminalBoxShadow[] | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((shadow, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      shadow.x === other.x &&
      shadow.y === other.y &&
      shadow.blur === other.blur &&
      shadow.spread === other.spread &&
      sameScrim(shadow.color, other.color)
    );
  });
}

function splitShadows(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseShadow(
  piece: string,
  opacity: number,
  windowZoomLevel: number
): TerminalBoxShadow | undefined {
  if (/\binset\b/i.test(piece)) {
    return;
  }
  const colorMatch = COLOR_FN.exec(piece);
  if (!colorMatch) {
    return;
  }
  const color = parseCssColor(colorMatch[0]);
  if (!color) {
    return;
  }
  const lengths = [...piece.matchAll(LENGTH)].map((match) => Number(match[1]));
  if (lengths.length < 2) {
    return;
  }
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
  if (blur < 0) {
    return;
  }
  // 完全落在 border box 里的投影看不见，送出去只会在圆角洞里衬一块实色。
  if (blur === 0 && spread <= 0 && x === 0 && y === 0) {
    return;
  }
  const scaled = scalePx(color, opacity);
  return {
    blur: scaleLength(blur, windowZoomLevel),
    color: scaled,
    spread: scaleLength(spread, windowZoomLevel),
    x: scaleLength(x, windowZoomLevel),
    y: scaleLength(y, windowZoomLevel),
  };
}

function scalePx(
  color: TerminalScrimColor,
  opacity: number
): TerminalScrimColor {
  return { ...color, a: color.a * opacity };
}

function scaleLength(value: number, windowZoomLevel: number): number {
  return cssRectToContentViewRect(
    { height: 0, width: value, x: 0, y: 0 },
    windowZoomLevel
  ).width;
}
