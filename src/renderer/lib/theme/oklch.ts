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

// `--primary-foreground` on-color for filled brand surfaces.
// Prefer white once it reaches ~4.0:1 (brand CTA policy; Ant/iOS blues land
// near here). Only use black for true light pastels where white stays weak.
export function readableOnFilled(surface: string): string {
  const white = contrast(surface, "#ffffff");
  const black = contrast(surface, "#000000");
  if (white >= 4) {
    return "#ffffff";
  }
  if (black >= 4.5) {
    return "#000000";
  }
  return white >= black ? "#ffffff" : "#000000";
}

// sRGB hex → OKLab L（感知亮度，0..1）。算法见 https://bottosson.github.io/posts/oklab/
// 仅 L 通道，所以省掉了 a/b 输出。
export function oklabLightness(hex: string): number {
  return hexToOklab(hex)?.[0] ?? 0;
}

type Oklab = readonly [number, number, number];
type Oklch = readonly [number, number, number];

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbChannel(linear: number): number {
  const c =
    linear <= 0.003_130_8
      ? 12.92 * linear
      : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function hexToOklab(hex: string): Oklab | null {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }
  const lr = srgbChannelToLinear(rgb[0]);
  const lg = srgbChannelToLinear(rgb[1]);
  const lb = srgbChannelToLinear(rgb[2]);
  const l = 0.412_221_470_8 * lr + 0.536_332_536_3 * lg + 0.051_445_992_9 * lb;
  const m = 0.211_903_498_2 * lr + 0.680_699_545_1 * lg + 0.107_396_956_6 * lb;
  const s = 0.088_302_461_9 * lr + 0.281_718_837_6 * lg + 0.629_978_700_5 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.210_454_255_3 * l_ + 0.793_617_785 * m_ - 0.004_072_046_8 * s_,
    1.977_998_495_1 * l_ - 2.428_592_205 * m_ + 0.450_593_709_9 * s_,
    0.025_904_037_1 * l_ + 0.782_771_766_2 * m_ - 0.808_675_766 * s_,
  ];
}

function oklabToHex(lab: Oklab): string {
  const [L, a, b] = lab;
  const l_ = L + 0.396_337_777_4 * a + 0.215_803_757_3 * b;
  const m_ = L - 0.105_561_345_8 * a - 0.063_854_172_8 * b;
  const s_ = L - 0.089_484_177_5 * a - 1.291_485_548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = +4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s;
  const g = -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s;
  const bLin = -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s;
  const hex = [r, g, bLin].map(linearToSrgbChannel);
  return `#${hex.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function oklabToOklch(lab: Oklab): Oklch {
  const [L, a, b] = lab;
  const C = Math.hypot(a, b);
  const h = C < 1e-8 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, C, h];
}

function oklchToOklab(lch: Oklch): Oklab {
  const [L, C, h] = lch;
  const hr = (h * Math.PI) / 180;
  return [L, C * Math.cos(hr), C * Math.sin(hr)];
}

/**
 * Adjust a color's OKLCH lightness (optionally chroma) while keeping hue.
 * Used for filled primary so contrast fixes do not gray-mix toward black/white.
 * Prefers white on-color (brand CTA convention); falls back to black for pastels.
 */
export function adjustOklchForContrasts(
  preferred: string,
  againstBackground: string,
  minBgContrast: number,
  minOnContrast: number
): string | null {
  // Prefer white labels (filled brand CTA). Only fall back to black for light
  // pastels that cannot support white without destroying the hue.
  return (
    searchOklchCandidate(
      preferred,
      againstBackground,
      minBgContrast,
      minOnContrast,
      "#ffffff"
    ) ??
    searchOklchCandidate(
      preferred,
      againstBackground,
      minBgContrast,
      minOnContrast,
      "#000000"
    )
  );
}

function searchOklchCandidate(
  preferred: string,
  againstBackground: string,
  minBgContrast: number,
  minOnContrast: number,
  onColor: "#ffffff" | "#000000"
): string | null {
  const lab = hexToOklab(preferred);
  if (!lab) {
    return null;
  }
  const [L0, C0, h] = oklabToOklch(lab);
  // High chroma + lower L often leaves sRGB gamut and clips back to a bright
  // color. Prefer reducing C when targeting white labels.
  const chromaSteps =
    onColor === "#ffffff"
      ? [
          C0,
          C0 * 0.85,
          C0 * 0.7,
          C0 * 0.55,
          Math.min(0.14, C0),
          0.12,
          0.1,
        ].filter((c, i, arr) => c > 0.04 && arr.indexOf(c) === i)
      : [C0, Math.min(0.18, C0 + 0.03), Math.min(0.14, Math.max(C0, 0.08))];
  let best: { color: string; delta: number; chroma: number } | null = null;

  for (const C of chromaSteps) {
    for (let step = 0; step <= 56; step += 1) {
      // Prefer darkening first when targeting white on-color (typical CTA).
      let signed: number[];
      if (step === 0) {
        signed = [0];
      } else if (onColor === "#ffffff") {
        signed = [-step * 0.01, step * 0.01];
      } else {
        signed = [step * 0.01, -step * 0.01];
      }
      for (const delta of signed) {
        const L = Math.min(0.92, Math.max(0.2, L0 + delta));
        const color = oklabToHex(oklchToOklab([L, C, h]));
        if (
          contrast(againstBackground, color) >= minBgContrast &&
          contrast(color, onColor) >= minOnContrast
        ) {
          // For white labels, prefer the brightest valid CTA (higher L).
          // For black labels, prefer closest to the source lightness.
          const score =
            onColor === "#ffffff"
              ? 1 - L + Math.abs(C - C0) * 0.15
              : Math.abs(L - L0) + Math.abs(C - C0) * 0.35;
          if (
            !best ||
            score < best.delta - 1e-6 ||
            (Math.abs(score - best.delta) < 1e-6 && C > best.chroma)
          ) {
            best = { color, delta: score, chroma: C };
          }
        }
      }
      if (best && onColor !== "#ffffff" && best.delta <= step * 0.01 + 1e-6) {
        break;
      }
    }
    if (best && onColor !== "#ffffff" && best.delta < 0.04) {
      return best.color;
    }
  }
  return readSearchCandidateColor(best);
}

function readSearchCandidateColor(
  value: { color: string; delta: number; chroma: number } | null
): string | null {
  return value === null ? null : value.color;
}

// 主题色优先严格保留 Shiki / Pierre 源值；只有关键 UI/终端组合低于最低对比度时才修正。
// 推导逻辑：先判断源色与背景是否达标；不达标时保持源色色相作为起点，按 5% 步长向
// 当前背景下更可读的黑/白方向混合，取第一个过线颜色，避免无条件替换导致主题失真。
// 注意：filled primary 请优先用 adjustOklchForContrasts，避免灰混发脏。
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
