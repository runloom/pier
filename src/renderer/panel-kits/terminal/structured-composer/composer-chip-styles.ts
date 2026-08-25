/**
 * Shared chrome for @ path / skill / attachment / review chips.
 * Horizontal gap: host ::before/::after in globals.css (caret hit-box).
 * Do not lock h-5 / arbitrary em / host 1.25rem. Label is `text-xs` (one step
 * below the editor `text-sm`). Pill height is `h-lh` + shared
 * `COMPOSER_LINE_LEADING_CLASS` so 1lh matches the editor line; `middle` on a
 * shorter box sits low next to CJK.
 *
 * Tone map — 3 valid families + 2 states:
 * - 引用 @ path     → status-info    (blue)
 * - 调用 cmd+skill  → status-success (green; SquareSlash vs Zap)
 * - 载荷 attachment → status-done    (purple)
 * - 失效 attach bad → status-warning (amber)
 * - 待处理 review   → destructive    (red)
 *
 * Do not use action-accent: it tracks --primary and reads as unhighlighted.
 */
export const COMPOSER_CHIP_HOST_CLASS = "composer-ref-chip-host";

/** Editor line-height token. Chip `h-lh` must use this same class. */
export const COMPOSER_LINE_LEADING_CLASS = "leading-5";

/** Visual capsule pill only; tone colors are applied by each node. */
export const COMPOSER_CHIP_CLASS = `composer-ref-chip inline-flex h-lh max-w-[16rem] items-center gap-0.5 rounded-full border px-1.5 select-none text-xs ${COMPOSER_LINE_LEADING_CLASS}`;

export const COMPOSER_CHIP_TONE_PATH =
  "border-status-info-border bg-status-info-bg text-status-info-fg";

/** 调用族：内建命令与技能同色。类型靠 SquareSlash / Zap。 */
export const COMPOSER_CHIP_TONE_INVOKE =
  "border-status-success-border bg-status-success-bg text-status-success-fg";

export const COMPOSER_CHIP_TONE_SKILL = COMPOSER_CHIP_TONE_INVOKE;
export const COMPOSER_CHIP_TONE_COMMAND = COMPOSER_CHIP_TONE_INVOKE;

export const COMPOSER_CHIP_TONE_ATTACHMENT =
  "border-status-done-border bg-status-done-bg text-status-done-fg";

export const COMPOSER_CHIP_TONE_ATTACHMENT_INVALID =
  "border-status-warning-border bg-status-warning-bg text-status-warning-fg";

/** Distinct from attachment-invalid (warning): review bundle is “needs handling”. */
export const COMPOSER_CHIP_TONE_REVIEW =
  "border-destructive/35 bg-destructive/10 text-destructive";
