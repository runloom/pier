import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app/globals.css";
import { initI18n } from "./i18n/index.ts";
import { registerCommandPaletteAction } from "./lib/actions/command-palette-action.ts";
import { registerConfigActions } from "./lib/actions/config-actions.ts";
import { registerPanelActions } from "./lib/actions/panel-actions.ts";
import { registerSettingsActions } from "./lib/actions/settings-actions.ts";
import { DEFAULT_KEYMAP } from "./lib/keybindings/defaults.ts";
import { keybindingRegistry } from "./lib/keybindings/registry.ts";
import { initFont } from "./stores/font.store.ts";
import { initLocale } from "./stores/locale.store.ts";
import { installDragWatcher } from "./stores/terminal-overlay.store.ts";
import { initTheme } from "./stores/theme.store.ts";

async function bootstrap() {
  try {
    await initI18n();
  } catch (err) {
    console.error("[pier] i18n init failed, falling back to keys:", err);
  }
  try {
    await Promise.all([initTheme(), initLocale(), initFont()]);
  } catch (err) {
    console.error("[pier] theme/locale init failed:", err);
  }

  window.pier?.terminal?.setup?.()?.catch(() => undefined);
  installDragWatcher();

  registerConfigActions();
  registerCommandPaletteAction();
  registerPanelActions();
  registerSettingsActions();
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

  const rootEl = document.getElementById("root");
  if (rootEl) {
    createRoot(rootEl).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
}

bootstrap().catch((err) => {
  console.error("[pier] bootstrap failed:", err);
});
