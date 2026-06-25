// 派生引擎：Shiki 主题 → UI semantic token
import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import {
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
  destructive: string;
  "destructive-foreground": string;
  foreground: string;
  info: string;
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
  success: string;
  warning: string;
  "warning-foreground": string;
}

// hardcode fallback 颜色：优先用饱和度更高的 Tailwind 调色板值，确保在低对比度主题
//（如 min-light）上 info/primary 不退化为灰色。green 改纯绿以防主题缺失 ansiGreen。
const FALLBACKS = {
  redDark: "#cd3131",
  redLight: "#cd3131",
  greenDark: "#10b981",
  greenLight: "#059669",
  yellowDark: "#e5e510",
  yellowLight: "#949800",
  blueDark: "#3b82f6",
  blueLight: "#2563eb",
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

function pickSaturatedOpaque(
  get: ColorGetter,
  keys: readonly string[],
  fallback: string,
  bg: string
): string {
  for (const key of keys) {
    const v = get(key);
    if (!v) {
      continue;
    }
    const opaque = opaqueOn(v, bg);
    if (chromaOf(opaque) >= 0.1) {
      return opaque;
    }
  }
  return opaqueOn(fallback, bg);
}

function readableFilledPrimary(surface: string): string {
  const foreground = readableOnFilled(surface);
  if (contrast(surface, foreground) >= 4.5) {
    return surface;
  }
  return visibleColor(foreground, surface, 4.5);
}

function derivePrimaryColor(
  get: ColorGetter,
  bg: string,
  mode: "light" | "dark"
): string {
  const source = pickSaturatedOpaque(
    get,
    [
      "button.background",
      "activityBar.activeBorder",
      "focusBorder",
      "charts.blue",
      "terminal.ansiBlue",
      "terminal.ansiBrightBlue",
    ],
    mode === "dark" ? FALLBACKS.blueDark : FALLBACKS.blueLight,
    bg
  );
  let primary = visibleColor(bg, source, 3);
  if (chromaOf(primary) < 0.1) {
    primary = visibleColor(
      bg,
      opaqueOn(mode === "dark" ? FALLBACKS.blueDark : FALLBACKS.blueLight, bg),
      3
    );
  }
  primary = readableFilledPrimary(primary);
  return contrast(bg, primary) >= 3 ? primary : visibleColor(bg, primary, 3);
}

function deriveIndicatorColors(
  get: ColorGetter,
  bg: string,
  mode: "light" | "dark"
): {
  destructive: string;
  info: string;
  success: string;
  warning: string;
} {
  // 注意: terminal.ansiRed 放 errorForeground 之前。某些 Shiki 主题(如 Solarized Dark)
  // 的 errorForeground 是 "error 文字色"(深背景上的浅粉),作者意图给文本用,不是 fill bg。
  // bay 把 destructive 用作 fill (如 SidebarMenuBadge),所以优先取饱和 ansiRed。
  const destructive = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["terminal.ansiRed", "errorForeground"],
        FALLBACKS.redDark
      ),
      bg
    ),
    3
  );
  const success = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["charts.green", "terminal.ansiGreen", "terminal.ansiBrightGreen"],
        mode === "dark" ? FALLBACKS.greenDark : FALLBACKS.greenLight
      ),
      bg
    ),
    3
  );
  const info = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["charts.blue", "terminal.ansiBlue", "terminal.ansiBrightBlue"],
        mode === "dark" ? FALLBACKS.blueDark : FALLBACKS.blueLight
      ),
      bg
    ),
    3
  );
  const warning = visibleColor(
    bg,
    opaqueOn(
      pickSaturated(
        get,
        ["charts.yellow", "terminal.ansiYellow", "terminal.ansiBrightYellow"],
        mode === "dark" ? FALLBACKS.yellowDark : FALLBACKS.yellowLight
      ),
      bg
    ),
    3
  );
  return { destructive, info, success, warning };
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
  const controlAmount = mode === "dark" ? 0.12 : 0.04;
  const borderAmount = mode === "dark" ? 0.14 : 0.12;
  const border = neutralSurface(bg, fg, borderAmount, 1.25);

  return {
    accent: neutralSurface(bg, fg, controlAmount, 1.05),
    border,
    input: border,
    muted: neutralSurface(bg, fg, surfaceAmount, 1.05),
    ring: neutralSurface(bg, fg, 0.44, 1.5),
    secondary: neutralSurface(bg, fg, controlAmount, 1.05),
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

  // popover / card = background — shadow/ring 表达 elevation，不从 chrome 色键派生偏离色（ADR-010）。
  const card = bg;
  const popover = bg;

  const { destructive, success, info, warning } = deriveIndicatorColors(
    get,
    bg,
    mode
  );
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
    "destructive-foreground": readableOnFilled(destructive),
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
    "warning-foreground": readableOnFilled(warning),
    accent: chrome.accent,
    background: bg,
    border: chrome.border,
    card,
    destructive,
    foreground: fg,
    info,
    input: chrome.input,
    muted: chrome.muted,
    popover,
    primary,
    radius: "0.625rem",
    ring: chrome.ring,
    secondary: chrome.secondary,
    success,
    warning,
  };
}
