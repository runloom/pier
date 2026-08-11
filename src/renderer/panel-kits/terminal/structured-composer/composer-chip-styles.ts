/**
 * Shared chrome for @ path / skill / attachment / review chips in Rich Input.
 *
 * Horizontal gap lives on the Lexical host via `.composer-ref-chip-host::before/::after`
 * in globals.css (not margin/padding alone — see that comment).
 *
 * Tone map (semantic tokens only — must stay distinct at a glance):
 * - @ path        → status-info   (blue)
 * - skill         → status-success (green)
 * - builtin cmd   → status-neutral (muted; distinct from skill green)
 * - attachment OK → status-done   (purple / done)
 * - attachment bad→ status-warning (amber)
 * - review comments → destructive (red; action needed — distinct from invalid attach)
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

/** Documented slash commands (distinct from skill chips). */
export const COMPOSER_CHIP_TONE_COMMAND =
  "border-status-neutral-border bg-status-neutral-bg text-status-neutral-fg";

export const COMPOSER_CHIP_TONE_ATTACHMENT =
  "border-status-done-border bg-status-done-bg text-status-done-fg";

export const COMPOSER_CHIP_TONE_ATTACHMENT_INVALID =
  "border-status-warning-border bg-status-warning-bg text-status-warning-fg";

/** Distinct from attachment-invalid (warning): review bundle is “needs handling”. */
export const COMPOSER_CHIP_TONE_REVIEW =
  "border-destructive/35 bg-destructive/10 text-destructive";
