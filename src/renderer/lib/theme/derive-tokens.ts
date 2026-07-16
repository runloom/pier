// 派生引擎：Shiki 主题 → UI semantic token
import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import {
  adjustOklchForContrasts,
  chromaOf,
  contrast,
  mix,
  normalizeHex,
  opaqueOn,
  readableOnFilled,
  readableText,
  visibleColor,
} from "./oklch.ts";
import type { ShikiThemeLike } from "./preset-registry.ts";

export interface DerivedUITokens {
  accent: string;
  "accent-foreground": string;
  background: string;
  border: string;
  card: string;
  "card-foreground": string;
  "chart-1": string;
  "chart-2": string;
  "chart-3": string;
  "chart-4": string;
  "chart-5": string;
  foreground: string;
  input: string;
  muted: string;
  "muted-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  radius: string;
  ring: string;
  secondary: string;
  "secondary-foreground": string;
}

// 编辑器主题只派生 primary 和图表序列色。产品状态色由 globals.css 的稳定语义色板
// 管理，不再读取终端 ANSI 色，避免同一状态随代码主题改变含义和饱和度。
const FALLBACKS = {
  redDark: "#cd3131",
  redLight: "#cd3131",
  greenDark: "#10b981",
  greenLight: "#059669",
  yellowDark: "#e5e510",
  yellowLight: "#949800",
  // Ant Design / common brand blue: vivid enough for CTAs, still near AA white text.
  blueDark: "#1677ff",
  blueLight: "#1677ff",
  magenta: "#bc3fbc",
} as const;

type ColorGetter = (...keys: string[]) => string | undefined;

function makeGetter(
  colors: Record<string, string>,
  fallback: Record<string, string>
): ColorGetter {
  return (...keys: string[]) => {
    for (const key of keys) {
      const value = colors[key] ?? fallback[key];
      if (value) {
        return normalizeHex(value);
      }
    }
    return;
  };
}

function deriveBaseColors(
  get: ColorGetter,
  mode: "light" | "dark"
): { bg: string; fg: string } {
  const bg = opaqueOn(
    get("editor.background") ?? (mode === "dark" ? "#0a0a0a" : "#ffffff"),
    mode === "dark" ? "#0a0a0a" : "#ffffff"
  );
  const fg = readableText(
    bg,
    opaqueOn(
      get(
        "editor.foreground",
        "foreground",
        "terminal.foreground",
        "terminal.ansiWhite"
      ) ?? (mode === "dark" ? "#fafafa" : "#0a0a0a"),
      bg
    )
  );
  return { bg, fg };
}

// 优先从 indicator/chart 关键路径(R/G/B/Y/Blue 等)挑出色相饱和的源色,跳过
// "假源色"(主题作者用作 fg 的低饱和值)。典型坑:
//  - min-light: terminal.ansiBlue=#e0e0e0 (灰),终端基础色被设成 placeholder
//  - Solarized: terminal.ansiBrightBlue=#839496 (灰),BRIGHT 一族故意去饱和当 fg 用
// 用 chromaOf >= 0.1 阈值过滤,落入硬码 fallback 保底。
function pickSaturated(
  get: ColorGetter,
  keys: readonly string[],
  fallback: string
): string {
  for (const key of keys) {
    const v = get(key);
    if (v && chromaOf(v) >= 0.1) {
      return v;
    }
  }
  return fallback;
}

function isUsablePrimarySource(hex: string): boolean {
  // Primary is a filled brand surface. Skip grayish editor accents that only
  // barely clear the generic chroma floor used by charts/ANSI fallbacks.
  return chromaOf(hex) >= 0.22;
}

/**
 * Filled brand CTA contrast policy:
 * - Prefer white labels (industry default for primary buttons).
 * - Target ~4.0:1 on white — stricter than WCAG large-text 3:1, looser than
 *   body-text 4.5:1 — so blues stay vivid (Ant `#1677ff` ≈ 4.1) instead of
 *   being crushed to muddy navy just to clear 4.5.
 */
const FILLED_PRIMARY_ON_CONTRAST = 4;
const FILLED_PRIMARY_BG_CONTRAST = 3;

function makeFilledPrimary(bg: string, source: string): string | null {
  if (
    contrast(bg, source) >= FILLED_PRIMARY_BG_CONTRAST &&
    contrast(source, "#ffffff") >= FILLED_PRIMARY_ON_CONTRAST
  ) {
    return source;
  }
  return adjustOklchForContrasts(
    source,
    bg,
    FILLED_PRIMARY_BG_CONTRAST,
    FILLED_PRIMARY_ON_CONTRAST
  );
}

function derivePrimaryColor(
  get: ColorGetter,
  bg: string,
  mode: "light" | "dark"
): string {
  // Prefer real UI accent candidates; terminal ANSI is last-resort only.
  const keys = [
    "button.background",
    "activityBar.badge.background",
    "activityBar.activeBorder",
    "tab.activeBorderTop",
    "focusBorder",
    "charts.blue",
    "terminal.ansiBlue",
    "terminal.ansiBrightBlue",
  ] as const;

  const fallback = opaqueOn(
    mode === "dark" ? FALLBACKS.blueDark : FALLBACKS.blueLight,
    bg
  );
  let blackOnFallback: string | null = null;

  for (const key of keys) {
    const raw = get(key);
    if (!raw) {
      continue;
    }
    const source = opaqueOn(raw, bg);
    if (!isUsablePrimarySource(source)) {
      continue;
    }
    const primary = makeFilledPrimary(bg, source);
    if (!(primary && isUsablePrimarySource(primary))) {
      continue;
    }
    if (contrast(primary, "#ffffff") >= FILLED_PRIMARY_ON_CONTRAST) {
      return primary;
    }
    blackOnFallback ??= primary;
  }

  const fallbackStrict = makeFilledPrimary(bg, fallback);
  if (
    fallbackStrict &&
    isUsablePrimarySource(fallbackStrict) &&
    contrast(fallbackStrict, "#ffffff") >= FILLED_PRIMARY_ON_CONTRAST
  ) {
    return fallbackStrict;
  }
  const fallbackRelaxed = adjustOklchForContrasts(
    fallback,
    bg,
    2.6,
    FILLED_PRIMARY_ON_CONTRAST
  );
  if (
    fallbackRelaxed &&
    isUsablePrimarySource(fallbackRelaxed) &&
    contrast(fallbackRelaxed, "#ffffff") >= FILLED_PRIMARY_ON_CONTRAST &&
    contrast(bg, fallbackRelaxed) >= 2.6
  ) {
    return fallbackRelaxed;
  }

  return blackOnFallback ?? fallbackStrict ?? visibleColor(bg, fallback, 3);
}

function deriveChartColors(
  get: ColorGetter,
  bg: string,
  mode: "light" | "dark"
): {
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
} {
  const fb = FALLBACKS;
  const chart3base = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["charts.yellow", "terminal.ansiYellow", "terminal.ansiBrightYellow"],
        mode === "dark" ? fb.yellowDark : fb.yellowLight
      ),
      bg
    ),
    3
  );
  const chart5base = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["charts.purple", "terminal.ansiMagenta", "terminal.ansiBrightMagenta"],
        fb.magenta
      ),
      bg
    ),
    3
  );
  return {
    chart1: visibleColor(
      bg,
      opaqueOn(
        pickSaturated(
          get,
          ["charts.blue", "terminal.ansiBlue", "terminal.ansiBrightBlue"],
          mode === "dark" ? fb.blueDark : fb.blueLight
        ),
        bg
      ),
      3
    ),
    chart2: visibleColor(
      bg,
      opaqueOn(
        pickSaturated(
          get,
          ["charts.green", "terminal.ansiGreen", "terminal.ansiBrightGreen"],
          mode === "dark" ? fb.greenDark : fb.greenLight
        ),
        bg
      ),
      3
    ),
    chart3: chart3base,
    chart4: visibleColor(
      bg,
      opaqueOn(
        pickSaturated(
          get,
          ["charts.red", "terminal.ansiRed", "terminal.ansiBrightRed"],
          fb.redDark
        ),
        bg
      ),
      3
    ),
    chart5: chart5base,
  };
}

function neutralSurface(
  bg: string,
  fg: string,
  initialAmount: number,
  minimumContrast: number
): string {
  for (let amount = initialAmount; amount <= 0.3; amount += 0.02) {
    const candidate = mix(bg, fg, amount);
    if (contrast(bg, candidate) >= minimumContrast) {
      return candidate;
    }
  }
  return mix(bg, fg, 0.3);
}

function neutralReadableText(bg: string, fg: string, surface: string): string {
  for (let amount = 0.58; amount >= 0.2; amount -= 0.01) {
    const candidate = mix(fg, bg, amount);
    if (contrast(bg, candidate) >= 4.5 && contrast(surface, candidate) >= 4.3) {
      return candidate;
    }
  }
  return readableText(surface, readableText(bg, fg));
}

function deriveNeutralChrome(
  bg: string,
  fg: string,
  mode: "light" | "dark"
): {
  accent: string;
  border: string;
  input: string;
  muted: string;
  ring: string;
  secondary: string;
} {
  const surfaceAmount = mode === "dark" ? 0.08 : 0.04;
  const accentAmount = mode === "dark" ? 0.12 : 0.04;
  const secondaryAmount = mode === "dark" ? 0.14 : 0.08;
  const borderAmount = mode === "dark" ? 0.14 : 0.12;
  const border = neutralSurface(bg, fg, borderAmount, 1.25);

  return {
    accent: neutralSurface(bg, fg, accentAmount, 1.05),
    border,
    input: border,
    muted: neutralSurface(bg, fg, surfaceAmount, 1.05),
    ring: neutralSurface(bg, fg, 0.44, 1.5),
    secondary: neutralSurface(bg, fg, secondaryAmount, 1.05),
  };
}

export function deriveAppStyleTokens(
  theme: ShikiThemeLike,
  mode: "light" | "dark"
): DerivedUITokens {
  const colors = theme.colors ?? {};
  const fallbackTheme = mode === "dark" ? pierreDark : pierreLight;
  const fallback = fallbackTheme.colors ?? {};

  const get = makeGetter(colors, fallback);
  const { bg, fg } = deriveBaseColors(get, mode);
  const chrome = deriveNeutralChrome(bg, fg, mode);
  const primary = derivePrimaryColor(get, bg, mode);

  // popover / card = background；浮层层级由 shadow/ring 表达，避免改弹窗内容底色。
  const card = bg;
  const popover = bg;

  const { chart1, chart2, chart3, chart4, chart5 } = deriveChartColors(
    get,
    bg,
    mode
  );

  const mutedFg = neutralReadableText(bg, fg, chrome.muted);

  return {
    "accent-foreground": readableText(chrome.accent, fg),
    "card-foreground": readableText(card, fg),
    "chart-1": chart1,
    "chart-2": chart2,
    "chart-3": chart3,
    "chart-4": chart4,
    "chart-5": chart5,
    "muted-foreground": mutedFg,
    "popover-foreground": readableText(popover, fg),
    // `--primary-foreground` 是 shadcn / Material 3 / Apple 的"on-primary"语义：落在 `bg-primary`
    // 色块上的字 / 图标 / switch thumb / checkbox 勾。按 OKLCH L pivot 把 primary 投到 {#000, #fff}
    // 二选一（感知一致），NOT shiki 主题的 `button.foreground`——主题作者写 button hint 是为 VSCode
    // dropdown（亮底深字）设计的，与本仓 shadcn 风格"饱和色块 + opposite-pole 文字"语义错位。
    "primary-foreground": readableOnFilled(primary),
    "secondary-foreground": readableText(
      chrome.secondary,
      opaqueOn(get("button.secondaryForeground") ?? fg, chrome.secondary)
    ),
    accent: chrome.accent,
    background: bg,
    border: chrome.border,
    card,
    foreground: fg,
    input: chrome.input,
    muted: chrome.muted,
    popover,
    primary,
    radius: "0.625rem",
    ring: chrome.ring,
    secondary: chrome.secondary,
  };
}
