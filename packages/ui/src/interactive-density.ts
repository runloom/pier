/**
 * Pier 桌面端单行交互控件的统一密度。
 *
 * 固定高度控件使用 28px；内容型选项使用最小 28px，单行时由
 * 20px 行高 + 4px 上下内边距组成，多行内容可自然增高。
 *
 * 纯图标按钮：
 * - hit 默认 28（CONTROL_ICON_SIZE_CLASS）；面板 chrome 用 24 compact
 * - glyph 默认 16（CONTROL_ICON_GLYPH_CLASS）；icon-xs 用 14 compact glyph
 * - 带文字的 xs 钮用 12px 小 glyph，与纯图标 icon-xs 分离
 * - 业务代码禁止再写 size-* 覆盖 Button 内图标
 */
export const CONTROL_HEIGHT_CLASS = "h-7";
/** 纯图标默认点击区 28×28。 */
export const CONTROL_ICON_SIZE_CLASS = "size-7";
/** 面板 header / diff chrome 紧凑点击区 24×24。 */
export const CONTROL_ICON_HIT_COMPACT_CLASS = "size-6";
/** 标准图标笔形 16px（icon / icon-sm 及默认文字钮）。 */
export const CONTROL_ICON_GLYPH_CLASS = "[&_svg:not([class*='size-'])]:size-4";
/** icon-xs 紧凑笔形 14px（24 hit 内略收，仍大于文字 xs 的 12）。 */
export const CONTROL_ICON_GLYPH_COMPACT_CLASS =
  "[&_svg:not([class*='size-'])]:size-3.5";
/** 仅用于带文字的 xs 按钮，不用于纯图标 icon-xs。 */
export const CONTROL_ICON_GLYPH_SM_CLASS =
  "[&_svg:not([class*='size-'])]:size-3";
export const MENU_ITEM_DENSITY_CLASS = "min-h-7 py-1 text-sm leading-5";
