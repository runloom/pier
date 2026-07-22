/**
 * Shared chrome for @ mention and attachment chips in Rich Input.
 *
 * Horizontal gap lives on the Lexical host via `.composer-ref-chip-host::before/::after`
 * in globals.css (not margin/padding alone — see that comment).
 */
export const COMPOSER_CHIP_HOST_CLASS = "composer-ref-chip-host";

/** Visual pill only; tone colors are applied by each node. */
export const COMPOSER_CHIP_CLASS =
  "composer-ref-chip inline-flex h-5 max-h-5 max-w-[16rem] items-center gap-0.5 rounded-sm border px-1.5 select-none font-mono text-[0.85em] leading-none";
