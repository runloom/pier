import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app/globals.css";
import {
  installTerminalInputRoutingBlurSuppressor,
  installTerminalInputRoutingDragWatcher,
  installTerminalInputRoutingPointerDownListener,
} from "@/stores/terminal-input-routing-slice.ts";
import { installBundledFontFaces } from "./app/fonts.ts";
import { TerminalDebugWindow } from "./components/common/terminal-debug-window.tsx";
import { initI18n } from "./i18n/index.ts";
import { registerCommandPaletteAction } from "./lib/actions/command-palette-action.ts";
import { registerCommandPaletteMruAction } from "./lib/actions/command-palette-mru-action.ts";
import { registerConfigActions } from "./lib/actions/config-actions.ts";
import { registerPanelActions } from "./lib/actions/panel-actions.ts";
import { registerRunActions } from "./lib/actions/run-actions.ts";
import { registerSettingsActions } from "./lib/actions/settings-actions.ts";
import { registerTerminalDebugActions } from "./lib/actions/terminal-debug-actions.ts";
import { registerViewActions } from "./lib/actions/view-actions.ts";
import { installCommandPaletteMenuRequest } from "./lib/command-palette/menu-request.ts";
import { DEFAULT_KEYMAP } from "./lib/keybindings/defaults.ts";
import { keybindingRegistry } from "./lib/keybindings/registry.ts";
import { bootstrapBuiltinPlugins } from "./lib/plugins/bootstrap.ts";
import { registerTerminalActions } from "./panel-kits/terminal/register-actions.ts";
import { initAgentAccounts } from "./stores/agent-accounts.store.ts";
import { initAgentDetection } from "./stores/agent-detect.store.ts";
import { initAgentPreferences } from "./stores/agent-preferences.store.ts";
import { initAppQuitPreferences } from "./stores/app-quit-preferences.store.ts";
import { initCommandPaletteMru } from "./stores/command-palette-mru.store.ts";
import { initFont } from "./stores/font.store.ts";
import { initKeybindingPreferences } from "./stores/keybinding-preferences.store.ts";
import { initLocalEnvironments } from "./stores/local-environments.store.ts";
import { initLocale } from "./stores/locale.store.ts";
import { initPluginSettingsStore } from "./stores/plugin-settings.store.ts";
import { initTerminalPreferences } from "./stores/terminal-preferences.store.ts";
import { initTerminalStatusBarPrefs } from "./stores/terminal-status-bar-prefs.store.ts";
import { initTheme } from "./stores/theme.store.ts";
import { initWorktreePreferences } from "./stores/worktree-preferences.store.ts";
import { initZoom } from "./stores/zoom.store.ts";

async function bootstrap() {
  installBundledFontFaces();
  const params = new URLSearchParams(window.location.search);
  const debugMode = params.get("pierDebug");
  const targetBrowserWindowId = Number(params.get("targetBrowserWindowId"));
  if (debugMode === "terminal" && Number.isFinite(targetBrowserWindowId)) {
    const rootEl = document.getElementById("root");
    if (rootEl) {
      createRoot(rootEl).render(
        <TerminalDebugWindow targetBrowserWindowId={targetBrowserWindowId} />
      );
    }
    return;
  }

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
      initZoom(),
      initTerminalPreferences(),
      initAppQuitPreferences(),
      initAgentPreferences(),
      initTerminalStatusBarPrefs(),
      initWorktreePreferences(),
      initLocalEnvironments(),
    ]);
  } catch (err) {
    console.error("[pier] theme/locale init failed:", err);
  }

  window.pier?.terminal?.setup?.()?.catch(() => undefined);
  initAgentDetection().catch((err) => {
    console.error("[pier] agent detection init failed:", err);
  });
  // blur 抑制器必须最先注册 (早于一切 window blur 监听, 含 Radix), 见其 doc comment
  installTerminalInputRoutingBlurSuppressor();
  installTerminalInputRoutingDragWatcher();
  installTerminalInputRoutingPointerDownListener();
  installCommandPaletteMenuRequest();
  initCommandPaletteMru().catch(() => undefined);
  initAgentAccounts().catch((err) => {
    console.error("[pier] agent accounts init failed:", err);
  });

  registerConfigActions();
  registerCommandPaletteAction();
  registerRunActions();
  registerPanelActions();
  registerSettingsActions();
  registerViewActions();
  registerCommandPaletteMruAction();
  registerTerminalDebugActions();
  registerTerminalActions();
  await initPluginSettingsStore();
  await bootstrapBuiltinPlugins();
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
  await initKeybindingPreferences();

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
