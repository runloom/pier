import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app/globals.css";
import { initI18n } from "./i18n/index.ts";
import { registerCommandPaletteAction } from "./lib/actions/command-palette-action.ts";
import { registerCommandPaletteMruAction } from "./lib/actions/command-palette-mru-action.ts";
import { registerConfigActions } from "./lib/actions/config-actions.ts";
import { registerPanelActions } from "./lib/actions/panel-actions.ts";
import { registerRunActions } from "./lib/actions/run-actions.ts";
import { registerSettingsActions } from "./lib/actions/settings-actions.ts";
import { DEFAULT_KEYMAP } from "./lib/keybindings/defaults.ts";
import { keybindingRegistry } from "./lib/keybindings/registry.ts";
import { registerTerminalActions } from "./panel-kits/terminal/register-actions.ts";
import { initCommandPaletteMru } from "./stores/command-palette-mru.store.ts";
import { initFont } from "./stores/font.store.ts";
import { initLocale } from "./stores/locale.store.ts";
import { installDragWatcher } from "./stores/terminal-overlay.store.ts";
import { initTerminalPreferences } from "./stores/terminal-preferences.store.ts";
import { initTheme } from "./stores/theme.store.ts";

async function bootstrap() {
  try {
    await initI18n();
  } catch (err) {
    console.error("[pier] i18n init failed, falling back to keys:", err);
  }
  try {
    await Promise.all([
      initTheme(),
      initLocale(),
      initFont(),
      initTerminalPreferences(),
    ]);
  } catch (err) {
    console.error("[pier] theme/locale init failed:", err);
  }

  window.pier?.terminal?.setup?.()?.catch(() => undefined);
  installDragWatcher();
  initCommandPaletteMru().catch(() => undefined);

  registerConfigActions();
  registerCommandPaletteAction();
  registerRunActions();
  registerPanelActions();
  registerSettingsActions();
  registerCommandPaletteMruAction();
  registerTerminalActions();
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

  const rootEl = document.getElementById("root");
  if (rootEl) {
    // 不包 StrictMode:Pier 终端 panel 是 web React tree + Ghostty native NSView
    // 协同, native terminal session 生命周期由 workspace 显式 close/reconcile
    // 管理. dev StrictMode 的诊断性 remount 对 native surface 没有业务含义,
    // 这里保持 dev/prod 行为一致, 避免给 reload 复用路径引入额外扰动.
    createRoot(rootEl).render(<App />);
  }
}

bootstrap().catch((err) => {
  console.error("[pier] bootstrap failed:", err);
});
