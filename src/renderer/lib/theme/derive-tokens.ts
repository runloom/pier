// 派生引擎：Shiki 主题 → UI semantic token
import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";
import {
  chromaOf,
  contrast,
  mix,
  normalizeHex,
  oklabLightness,
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
): { bg: string; fg: string; primary: string } {
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
  const primaryRaw =
    get(
      "button.background",
      "activityBar.activeBorder",
      "focusBorder",
      "terminal.ansiBlue"
    ) ?? "#009fff";
  // chroma guard 时序修复：先 opaqueOn 展开 alpha，再判 chroma。
  // material-dark 的 button.background=#80CBC420（alpha=0x20），chromaOf 原始 hex 返回 0.29（饱和），
  // 但展开后实际颜色 #31454a（chroma 仅 0.098，灰色）。原 guard 时序错导致 primary 退化为灰。
  const primaryOpaque = opaqueOn(primaryRaw, bg);
  const primarySource =
    chromaOf(primaryOpaque) >= 0.1 ? primaryOpaque : opaqueOn("#009fff", bg);
  let primary = visibleColor(bg, primarySource, 3);
  // Round 4 guard: visibleColor 可能把饱和度推低 (gruvbox 等)。如果 chroma 跌破 0.1, fallback 到 hardcode 蓝。
  if (chromaOf(primary) < 0.1) {
    primary = visibleColor(bg, opaqueOn("#009fff", bg), 3);
  }
  return { bg, fg, primary };
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

// border 不应与 primary 撞色（catppuccin 等主题把 border 键设成 accent 紫色）。
// 朝中性灰方向 push 直到 contrast(border, primary) ≥ 1.3；全程不达标则用 fallback。
function guardBorderVsPrimary(
  borderRaw: string,
  primary: string,
  neutralFallback: string
): string {
  if (contrast(borderRaw, primary) >= 1.3) {
    return borderRaw;
  }
  for (let amount = 0.1; amount <= 0.6; amount += 0.1) {
    const candidate = mix(borderRaw, neutralFallback, amount);
    if (contrast(candidate, primary) >= 1.3) {
      return candidate;
    }
  }
  return neutralFallback;
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

export function deriveAppStyleTokens(
  theme: ShikiThemeLike,
  mode: "light" | "dark"
): DerivedUITokens {
  const colors = theme.colors ?? {};
  const fallbackTheme = mode === "dark" ? pierreDark : pierreLight;
  const fallback = fallbackTheme.colors ?? {};

  const get = makeGetter(colors, fallback);
  const { bg, fg, primary } = deriveBaseColors(get, mode);

  // popover / card = background — shadow/ring 表达 elevation，不从 chrome 色键派生偏离色（ADR-010）。
  const card = bg;
  const popover = bg;

  const mutedRaw = opaqueOn(
    get(
      "editor.lineHighlightBackground",
      "list.hoverBackground",
      "list.inactiveSelectionBackground"
    ) ?? card,
    bg
  );
  // 兜底：muted 必须与 bg 有可感知层次 (contrast ≥ 1.1)；
  // 太接近时往相反方向 nudge 5%，确保 hover/selection 区域可见。
  const mutedContrasted =
    contrast(bg, mutedRaw) >= 1.1
      ? mutedRaw
      : mix(mutedRaw, mode === "dark" ? "#ffffff" : "#000000", 0.05);
  // 方向 guard: dark mode 下 muted 应比 bg 更亮（外壳层次哲学），
  // light mode 下应更暗。方向错误时朝期望方向 push 8%（material-dark 等极端深色侧栏）。
  const mutedShouldBeLighter = mode === "dark";
  const mutedIsLighter = oklabLightness(mutedContrasted) > oklabLightness(bg);
  const muted =
    mutedIsLighter === mutedShouldBeLighter
      ? mutedContrasted
      : mix(bg, mutedShouldBeLighter ? "#ffffff" : "#000000", 0.08);
  // fallback 到中性灰而非 primary，避免 catppuccin 等主题 border = primary 紫色。
  const borderFallback = mix(fg, bg, 0.6);
  const borderRaw = opaqueOn(
    get(
      "dropdown.border",
      "editorWidget.border",
      "panel.border",
      "input.border"
    ) ?? borderFallback,
    bg
  );
  // guard: border 不应与 primary 撞色，调用 guardBorderVsPrimary 朝中性灰 push。
  const border = guardBorderVsPrimary(borderRaw, primary, mix(fg, bg, 0.5));
  const selection = visibleColor(
    bg,
    opaqueOn(
      get("list.activeSelectionBackground", "editor.selectionBackground") ??
        primary,
      bg
    ),
    1.15
  );
  const secondary = opaqueOn(
    get("button.secondaryBackground", "list.inactiveSelectionBackground") ??
      muted,
    bg
  );
  const input = visibleColor(
    bg,
    opaqueOn(get("input.background", "dropdown.background") ?? card, bg),
    1.5
  );

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

  // muted-foreground: readableText(muted, preferred) 阈值 4.5(WCAG AA normal text)。
  // preferred = descriptionForeground / editorLineNumber.foreground 朝 fg 的 mix fallback。
  // 源色过 4.5 保留源色;不达标回落到 contrast 极值的黑/白。
  // 不用 visibleColor(...,3) + softenTowardBg 路径:那条用 WCAG Large Text 3:1 阈值会让
  // pierre 的 #737373(3.67:1)保留, 与黑白极值分叉。
  const mutedFg = readableText(
    muted,
    opaqueOn(
      get("descriptionForeground", "editorLineNumber.foreground") ??
        mix(fg, bg, mode === "dark" ? 0.45 : 0.5),
      muted
    )
  );

  return {
    "accent-foreground": readableText(selection, fg),
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
      secondary,
      opaqueOn(
        get("button.secondaryForeground", "list.inactiveSelectionForeground") ??
          fg,
        secondary
      )
    ),
    "warning-foreground": readableOnFilled(warning),
    accent: selection,
    background: bg,
    border: visibleColor(bg, border, 1.5),
    card,
    destructive,
    foreground: fg,
    info,
    input,
    muted,
    popover,
    primary,
    radius: "0.625rem",
    ring: visibleColor(
      bg,
      opaqueOn(
        get("focusBorder", "activityBar.activeBorder", "button.background") ??
          primary,
        bg
      ),
      1.5
    ),
    secondary,
    success,
    warning,
  };
}
