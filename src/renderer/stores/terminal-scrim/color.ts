import type { TerminalScrimColor } from "@shared/contracts/terminal.ts";

const LEGACY_RGB =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/;
const MODERN_RGB =
  /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/;
const SRGB =
  /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;
const OKLAB =
  /^oklab\(\s*([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 把 computed background 收成 0–1 sRGB。alpha 为 0 或认不出的写法返回
 * undefined，native 就不压暗（保持现在的洞），而不是猜一个颜色。
 */
export function parseCssColor(value: string): TerminalScrimColor | undefined {
  const text = value.trim();
  const oklab = OKLAB.exec(text);
  if (oklab) {
    const [r, g, b] = oklabToSrgb(
      Number(oklab[1]),
      Number(oklab[2]),
      Number(oklab[3])
    );
    return finish(r, g, b, oklab[4], 1);
  }
  const srgb = SRGB.exec(text);
  if (srgb) {
    return finish(
      Number(srgb[1]),
      Number(srgb[2]),
      Number(srgb[3]),
      srgb[4],
      1
    );
  }
  const rgb = LEGACY_RGB.exec(text) ?? MODERN_RGB.exec(text);
  if (!rgb) {
    return;
  }
  return finish(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4], 255);
}

/** CSS Color 4 OKLab → sRGB。Electron 把 color-mix 结果序列化成 OKLab 记法。 */
function oklabToSrgb(
  L: number,
  a: number,
  b: number
): [number, number, number] {
  const l = (L + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (L - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (L - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    encodeSrgb(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    encodeSrgb(
      -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
    ),
    encodeSrgb(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s),
  ];
}

function encodeSrgb(channel: number): number {
  const linear = Math.min(1, Math.max(0, channel));
  if (linear <= 0.003_130_8) {
    return 12.92 * linear;
  }
  return 1.055 * linear ** (1 / 2.4) - 0.055;
}

function finish(
  r: number,
  g: number,
  b: number,
  alpha: string | undefined,
  scale: number
): TerminalScrimColor | undefined {
  const a = alpha === undefined ? 1 : alphaOf(alpha);
  if (![r, g, b, a].every(Number.isFinite)) {
    return;
  }
  const color = {
    a: clamp01(a),
    b: clamp01(b / scale),
    g: clamp01(g / scale),
    r: clamp01(r / scale),
  };
  return color.a > 0 ? color : undefined;
}

function alphaOf(raw: string): number {
  if (raw.endsWith("%")) {
    return Number(raw.slice(0, -1)) / 100;
  }
  return Number(raw);
}

export function readScrimColor(
  element: HTMLElement
): TerminalScrimColor | undefined {
  // 淡入淡出改的是 opacity，background 不变。不乘 opacity 的话，洞里的
  // native 蒙层第一帧就是终值，洞外的底部状态栏还在跟着网页淡。
  const style = getComputedStyle(element);
  const color = parseCssColor(style.backgroundColor);
  if (!color) {
    return;
  }
  const opacity = Number(style.opacity);
  if (!Number.isFinite(opacity)) {
    return color;
  }
  const a = color.a * clamp01(opacity);
  return a > 0 ? { ...color, a } : undefined;
}

export function sameScrim(
  left: TerminalScrimColor | undefined,
  right: TerminalScrimColor | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    left.a === right.a
  );
} /** 主题 class / 行内样式变了就重读蒙层色。 */
export function watchDocumentTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["class", "style"],
    attributes: true,
  });
  return () => observer.disconnect();
}
