import type {
  TerminalBoxShadow,
  TerminalScrimColor,
} from "@shared/contracts/terminal.ts";
import { cssRectToContentViewRect } from "@/lib/window-zoom/coordinates.ts";
import { findCssColor, sameScrim } from "@/stores/terminal-scrim/color.ts";

// computed boxShadow 里的长度一律 px；Chromium 对超大值会用指数记法。
const LENGTH = /(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)px/gi;
const seenShadowWarnings = new Set<string>();

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
  const lengths = [...piece.matchAll(LENGTH)].map((match) => Number(match[1]));
  if (lengths.length < 2) {
    return;
  }
  const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
  if (blur < 0) {
    return;
  }
  const extendsOutside = blur > 0 || spread > 0 || x !== 0 || y !== 0;
  if (!extendsOutside) {
    // 完全落在 border box 里的投影看不见，送出去只会在圆角洞里衬一块实色。
    return;
  }
  const color = findCssColor(piece);
  if (!color) {
    // 只认颜色语法单一来源；认不出时 native 不画（fail-quiet），但开发态
    // 必须留下线索——静默丢层正是圆角胶囊连续几轮没有阴影的原因。
    warnUnparsedShadow(piece);
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

function warnUnparsedShadow(piece: string): void {
  if (!import.meta.env.DEV || seenShadowWarnings.has(piece)) {
    return;
  }
  seenShadowWarnings.add(piece);
  console.warn("[terminal-overlay] unparsed box-shadow layer:", piece);
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
