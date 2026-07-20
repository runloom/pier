/**
 * AppKit virtual keycodes + Ghostty input mod bits used when injecting
 * synthetic key events into a terminal surface (bypass bracketed paste).
 *
 * Keycodes match `TerminalHardwareKeyRouter.appKitMap`.
 * Mods match `TerminalInputModifiers` / ghostty_input_mods_e
 * (shift=1<<0, ctrl=1<<1, alt=1<<2, super=1<<3).
 */

export const APPKIT_KEYCODE = {
  c: 0x08,
  escape: 0x35,
  return: 0x24,
  tab: 0x30,
  arrowLeft: 0x7b,
  arrowRight: 0x7c,
  arrowDown: 0x7d,
  arrowUp: 0x7e,
} as const;

export const GHOSTTY_MODS = {
  shift: 1,
  ctrl: 2,
  alt: 4,
  super: 8,
} as const;
