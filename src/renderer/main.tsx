import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./app/globals.css";
import { initI18n } from "./i18n/index.ts";
import { registerCommandPaletteAction } from "./lib/actions/command-palette-action.ts";
import { registerCommandPaletteMruAction } from "./lib/actions/command-palette-mru-action.ts";
import { registerConfigActions } from "./lib/actions/config-actions.ts";
import { registerPanelActions } from "./lib/actions/panel-actions.ts";
import { registerSettingsActions } from "./lib/actions/settings-actions.ts";
import { DEFAULT_KEYMAP } from "./lib/keybindings/defaults.ts";
import { keybindingRegistry } from "./lib/keybindings/registry.ts";
import { registerTerminalActions } from "./panel-kits/terminal/register-actions.ts";
import { initCommandPaletteMru } from "./stores/command-palette-mru.store.ts";
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
  initCommandPaletteMru().catch(() => undefined);

  registerConfigActions();
  registerCommandPaletteAction();
  registerPanelActions();
  registerSettingsActions();
  registerCommandPaletteMruAction();
  registerTerminalActions();
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

  const rootEl = document.getElementById("root");
  if (rootEl) {
    // 不包 StrictMode:Pier 终端 panel 是 web React tree + Ghostty native NSView
    // 协同, useEffect cleanup 调 terminal.close IPC 销毁 NSView. StrictMode 在
    // dev 模式让组件双 mount/unmount, 会产生 close 多于 create 的孤儿调用,
    // 把 reload 后复用的 NSView 真销毁, 反而引入 dev-only 视觉/PTY 状态丢失.
    // 生产 build 没 StrictMode, C 方案的 createTerminal 复用 + reconcile 已经
    // 让 reload 零闪 + PTY 跨 reload 保留;关掉 dev StrictMode 让两个环境行为
    // 一致, 不影响其它 dev 检查能力 (Pier 没有依赖 StrictMode 暴露的具体反例).
    createRoot(rootEl).render(<App />);
  }
}

bootstrap().catch((err) => {
  console.error("[pier] bootstrap failed:", err);
});
