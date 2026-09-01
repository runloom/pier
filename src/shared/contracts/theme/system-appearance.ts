/**
 * OS appearance snapshot from Electron `nativeTheme.updated`.
 * Renderer follows this when the theme preference is `system`.
 */
export interface ThemeSystemAppearancePayload {
  readonly shouldUseDarkColors: boolean;
}
