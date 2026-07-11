/**
 * 原生窗口在 renderer 主题尚未同步前使用的兜底色。
 * 产品 UI 颜色由 renderer/app/globals.css 统一管理；终端 ANSI 色独立派生。
 */
export const NATIVE_CHROME_FALLBACK = {
  dark: "#1e1e1e",
  light: "#ffffff",
} as const;

export const TRANSPARENT_NATIVE_BACKGROUND = "#00000000";
