// OKLCH / contrast helper 函数
// 全部 export，供 derive-tokens.ts 和单元测试使用。

// 移至模块顶层以满足 biome useTopLevelRegex 规则
const HEX_RE = /^#([0-9a-fA-F]{3,8})$/;
const HEX8_RE = /^#[0-9a-fA-F]{8}$/;

export function normalizeHex(value: string | undefined): string | undefined {
  if (!value) {
    return;
  }
  const raw = value.trim();
  const match = HEX_RE.exec(raw);
  // match[1] is guaranteed by the capture group, but TS needs the explicit check
  const h = match?.[1];
  if (!h) {
    return;
  }
  const lower = h.toLowerCase();
  if (lower.length === 3 || lower.length === 4) {
    return `#${lower
      .split("")
      .map((c) => c + c)
      .join("")}`;
  }
  return `#${lower}`;
}

// 简易饱和度：(max(R,G,B) - min(R,G,B)) / 255。中性灰返回 0,纯色返回 1。
// 用于跳过"假源色":如 min-light terminal.ansiBlue=#e0e0e0(灰)、Solarized
// terminal.ansiBrightBlue=#839496(灰),它们存在但不是真正的色。
export function chromaOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  return (max - min) / 255;
}

export function hexToRgb(hex: string): [number, number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }
  const body = normalized.slice(1);
  if (body.length !== 6 && body.length !== 8) {
    return null;
  }
  if (body.length === 6) {
    return [
      Number.parseInt(body.slice(0, 2), 16),
      Number.parseInt(body.slice(2, 4), 16),
      Number.parseInt(body.slice(4, 6), 16),
      255,
    ];
  }
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
    Number.parseInt(body.slice(6, 8), 16),
  ];
}

export function opaqueOn(value: string, background: string): string {
  const normalized = normalizeHex(value) ?? value;
  if (!HEX8_RE.test(normalized)) {
    return normalized;
  }
  const fgRgb = hexToRgb(normalized);
  const bgRgb = hexToRgb(background);
  if (!(fgRgb && bgRgb)) {
    return normalized.slice(0, 7);
  }
  const alpha = fgRgb[3] / 255;
  // Explicit element access (not .slice().map()) to preserve tuple types
  const r = Math.round(fgRgb[0] * alpha + bgRgb[0] * (1 - alpha));
  const g = Math.round(fgRgb[1] * alpha + bgRgb[1] * (1 - alpha));
  const b = Math.round(fgRgb[2] * alpha + bgRgb[2] * (1 - alpha));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function hexLuminance(hex: string): number {
  const normalized = (normalizeHex(hex) ?? "#000000").slice(1, 7);
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const linearize = (c: number) =>
    c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrast(a: string, b: string): number {
  const l1 = hexLuminance(a);
  const l2 = hexLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function readableText(background: string, preferred: string): string {
  if (contrast(background, preferred) >= 4.5) {
    return preferred;
  }
  return contrast(background, "#000000") >= contrast(background, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

// `--primary-foreground` 专用 on-color 派生器:按 OKLCH 感知亮度把 primary 投到 {#000, #fff}。
// 阈值 0.7 经 38 主题预设标定:catppuccin lavender(0.787)、everforest sage(0.773)、
// rose-pine pink(0.836)、pierre-soft 浅蓝(0.746)落"亮 pastel"侧得深字;pierre/vscode
// 饱和蓝(0.682)、github-hc 亮绿(0.670)、material 灰(0.579)落"深 saturated"侧得白字——
// 与 shadcn / Material 3 / iOS 的 filled-primary 文字惯例一致。NEVER 用 HSL L:HSL 报 saturated
// 蓝为 mid(50%),与感知偏差大。NEVER 退回 contrast 极值挑黑/白:对 saturated 蓝 contrast(black)
// 总比 contrast(white) 高,会复活原"暗模式 switch ON 后 thumb 反向变深"的 bug。
export function readableOnFilled(surface: string): string {
  return oklabLightness(surface) >= 0.7 ? "#000000" : "#ffffff";
}

// sRGB hex → OKLab L（感知亮度，0..1）。算法见 https://bottosson.github.io/posts/oklab/
// 仅 L 通道，所以省掉了 a/b 输出。
export function oklabLightness(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 0;
  }
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lr = linear(rgb[0]);
  const lg = linear(rgb[1]);
  const lb = linear(rgb[2]);
  const l_ = 0.412_221_470_8 * lr + 0.536_332_536_3 * lg + 0.051_445_992_9 * lb;
  const m_ = 0.211_903_498_2 * lr + 0.680_699_545_1 * lg + 0.107_396_956_6 * lb;
  const s_ = 0.088_302_461_9 * lr + 0.281_718_837_6 * lg + 0.629_978_700_5 * lb;
  return (
    0.210_454_255_3 * Math.cbrt(l_) +
    0.793_617_785 * Math.cbrt(m_) -
    0.004_072_046_8 * Math.cbrt(s_)
  );
}

// 主题色优先严格保留 Shiki / Pierre 源值；只有关键 UI/终端组合低于最低对比度时才修正。
// 推导逻辑：先判断源色与背景是否达标；不达标时保持源色色相作为起点，按 5% 步长向
// 当前背景下更可读的黑/白方向混合，取第一个过线颜色，避免无条件替换导致主题失真。
export function visibleColor(
  background: string,
  preferred: string,
  minimumContrast: number
): string {
  if (contrast(background, preferred) >= minimumContrast) {
    return preferred;
  }
  const target =
    contrast(background, "#000000") >= contrast(background, "#ffffff")
      ? "#000000"
      : "#ffffff";
  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mix(preferred, target, amount);
    if (contrast(background, candidate) >= minimumContrast) {
      return candidate;
    }
  }
  return target;
}

export function mix(a: string, b: string, amount: number): string {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!(rgbA && rgbB)) {
    return b;
  }
  // Explicit element access (not .slice().map()) to preserve tuple types
  const r = Math.round(rgbA[0] * (1 - amount) + rgbB[0] * amount);
  const g = Math.round(rgbA[1] * (1 - amount) + rgbB[1] * amount);
  const bVal = Math.round(rgbA[2] * (1 - amount) + rgbB[2] * amount);
  return `#${[r, g, bVal].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
