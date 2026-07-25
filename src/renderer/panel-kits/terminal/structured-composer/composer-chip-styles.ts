/**
 * Shared chrome for @ path / skill / attachment chips in Rich Input.
 *
 * Horizontal gap lives on the Lexical host via `.composer-ref-chip-host::before/::after`
 * in globals.css (not margin/padding alone — see that comment).
 *
 * Tone map (semantic tokens only — must stay distinct at a glance):
 * - @ path        → status-info   (blue)
 * - skill         → status-success (green)
 * - attachment OK → status-done   (purple / done)
 * - attachment bad→ status-warning (amber)
 *
 * Do not use action-accent here: --action-accent tracks --primary, which is
 * near-neutral in Pier themes and does not read as a highlighted chip.
 */
export const COMPOSER_CHIP_HOST_CLASS = "composer-ref-chip-host";

/** Visual pill only; tone colors are applied by each node. */
export const COMPOSER_CHIP_CLASS =
  "composer-ref-chip inline-flex h-5 max-h-5 max-w-[16rem] items-center gap-0.5 rounded-sm border px-1.5 select-none font-mono text-[0.85em] leading-none";

export const COMPOSER_CHIP_TONE_PATH =
  "border-status-info-border bg-status-info-bg text-status-info-fg";

export const COMPOSER_CHIP_TONE_SKILL =
  "border-status-success-border bg-status-success-bg text-status-success-fg";

export const COMPOSER_CHIP_TONE_ATTACHMENT =
  "border-status-done-border bg-status-done-bg text-status-done-fg";

export const COMPOSER_CHIP_TONE_ATTACHMENT_INVALID =
  "border-status-warning-border bg-status-warning-bg text-status-warning-fg";
