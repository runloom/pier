// Pier 主题 → Ghostty 终端配色派生
//
// Shiki 主题用 VS Code 配色 dict, ANSI 16 色按 `terminal.ansi*` / `terminal.ansiBright*`
// 命名约定存在 colors map 里. 缺失键 (有些 minimal 主题不定义 ANSI) 回落到 hardcode
// 默认调色板 (light / dark 各一套, 取自 Ghostty 库 TerminalTheme+Defaults 的 IR_Black
// 风格), 保证任何主题都拿到 16 槽完整 palette.
//
// 输出 hex 经 opaqueOn → 6 字符 (#RRGGBB). 终端不接 alpha, 把 alpha 合成进 bg.

import type {
  AnsiPalette,
  TerminalColors,
} from "@shared/contracts/terminal.ts";
import { normalizeHex, opaqueOn, readableText, visibleColor } from "./oklch.ts";
import type { ShikiThemeLike } from "./preset-registry.ts";

// 缺 ANSI 键时的兜底 palette. 风格沿 Ghostty 内置 default (TerminalTheme+Defaults.swift).
// 不依赖任一具体 Shiki preset, 避免主题缺失时退化成无配色的纯文本.
const FALLBACK_PALETTE_DARK: AnsiPalette = [
  "#151515",
  "#ac4142",
  "#7e8e50",
  "#e4b567",
  "#6c99bb",
  "#9f4e86",
  "#7dd5cf",
  "#d0d0d0",
  "#505050",
  "#cc6666",
  "#a1b56c",
  "#f0c674",
  "#81a2be",
  "#b294bb",
  "#8abeb7",
  "#f5f5f5",
];

const FALLBACK_PALETTE_LIGHT: AnsiPalette = [
  "#000000",
  "#aa3731",
  "#448c27",
  "#cb8800",
  "#325cc0",
  "#7a3e9d",
  "#0083b2",
  "#a0a0a0",
  "#777777",
  "#f03e31",
  "#60cb00",
  "#bb8800",
  "#007acc",
  "#e64ce6",
  "#00aacb",
  "#f5f5f5",
];

const MIN_DIM_TEXT_CONTRAST = 3;

function pickHex(
  colors: Record<string, string>,
  key: string,
  bg: string
): string | undefined {
  const raw = colors[key];
  if (!raw) {
    return;
  }
  const norm = normalizeHex(raw);
  if (!norm) {
    return;
  }
  // opaqueOn 把 #rrggbbaa 合成进 bg → #rrggbb; 6 字符直接返回.
  return opaqueOn(norm, bg);
}

// tuple destructure: tsconfig 启 noUncheckedIndexedAccess 下 array index 都带
// undefined; 解构成 16 个变量 TS 才能推出 string. 顺序严格对齐 ANSI 0..15.
function derivePalette(
  colors: Record<string, string>,
  background: string,
  mode: "light" | "dark"
): AnsiPalette {
  const [
    fb0,
    fb1,
    fb2,
    fb3,
    fb4,
    fb5,
    fb6,
    fb7,
    fb8,
    fb9,
    fb10,
    fb11,
    fb12,
    fb13,
    fb14,
    fb15,
  ] = mode === "dark" ? FALLBACK_PALETTE_DARK : FALLBACK_PALETTE_LIGHT;
  return [
    pickHex(colors, "terminal.ansiBlack", background) ?? fb0,
    pickHex(colors, "terminal.ansiRed", background) ?? fb1,
    pickHex(colors, "terminal.ansiGreen", background) ?? fb2,
    pickHex(colors, "terminal.ansiYellow", background) ?? fb3,
    pickHex(colors, "terminal.ansiBlue", background) ?? fb4,
    pickHex(colors, "terminal.ansiMagenta", background) ?? fb5,
    pickHex(colors, "terminal.ansiCyan", background) ?? fb6,
    pickHex(colors, "terminal.ansiWhite", background) ?? fb7,
    visibleColor(
      background,
      pickHex(colors, "terminal.ansiBrightBlack", background) ?? fb8,
      MIN_DIM_TEXT_CONTRAST
    ),
    pickHex(colors, "terminal.ansiBrightRed", background) ?? fb9,
    pickHex(colors, "terminal.ansiBrightGreen", background) ?? fb10,
    pickHex(colors, "terminal.ansiBrightYellow", background) ?? fb11,
    pickHex(colors, "terminal.ansiBrightBlue", background) ?? fb12,
    pickHex(colors, "terminal.ansiBrightMagenta", background) ?? fb13,
    pickHex(colors, "terminal.ansiBrightCyan", background) ?? fb14,
    pickHex(colors, "terminal.ansiBrightWhite", background) ?? fb15,
  ];
}

export function deriveTerminalColors(
  theme: ShikiThemeLike,
  mode: "light" | "dark"
): TerminalColors {
  const colors = theme.colors ?? {};

  const bgFallback = mode === "dark" ? "#0a0a0a" : "#ffffff";
  const background =
    pickHex(colors, "editor.background", bgFallback) ?? bgFallback;

  const fgFallback = mode === "dark" ? "#fafafa" : "#0a0a0a";
  const foreground =
    pickHex(colors, "editor.foreground", background) ??
    pickHex(colors, "terminal.foreground", background) ??
    fgFallback;

  const cursor =
    pickHex(colors, "editorCursor.foreground", background) ??
    pickHex(colors, "terminalCursor.foreground", background);

  const selectionBackgroundSource =
    pickHex(colors, "terminal.selectionBackground", background) ??
    pickHex(colors, "editor.selectionBackground", background) ??
    (mode === "dark" ? "#264f78" : "#add6ff");
  const selectionBackground = visibleColor(
    background,
    selectionBackgroundSource,
    1.5
  );
  const selectionForegroundSource =
    pickHex(colors, "terminal.selectionForeground", selectionBackground) ??
    pickHex(colors, "editor.selectionForeground", selectionBackground) ??
    foreground;
  const selectionForeground = readableText(
    selectionBackground,
    selectionForegroundSource
  );

  return {
    background,
    cursor,
    foreground,
    palette: derivePalette(colors, background, mode),
    selectionBackground,
    selectionForeground,
  };
}
