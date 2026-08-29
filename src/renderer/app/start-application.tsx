import type { Root } from "react-dom/client";
import { installHangBreadcrumbRuntime } from "@/lib/diagnostics/hang-breadcrumb.ts";
import { installTerminalWebOwnerRetentionWatch } from "@/lib/terminal-debug/owner-retention-watch.ts";
import { installTerminalInputRoutingSashDragWatcher } from "@/stores/terminal-input-routing-drag.ts";
import {
  installTerminalInputRoutingBlurSuppressor,
  installTerminalInputRoutingPointerDownListener,
} from "@/stores/terminal-input-routing-slice.ts";
import { App } from "../App.tsx";
import { AppRuntimeErrorBoundary } from "../components/common/app-runtime-error-boundary.tsx";
import { TerminalDebugWindow } from "../components/common/terminal-debug/window.tsx";
import { installWorkspaceRendererCommandListener } from "../components/workspace/renderer-command-listener.ts";
import { initI18n } from "../i18n/index.ts";
import { registerAgentRuntimeActions } from "../lib/actions/agent-runtime-actions.ts";
import { registerAgentStartActions } from "../lib/actions/agent-start-actions.ts";
import { registerCommandPaletteAction } from "../lib/actions/command-palette-action.ts";
import { registerCommandPaletteMruAction } from "../lib/actions/command-palette-mru-action.ts";
import { registerConfigActions } from "../lib/actions/config-actions.ts";
import { registerNewAgentAction } from "../lib/actions/new-agent-action.ts";
import { registerNotificationCenterActions } from "../lib/actions/notification-center-actions.ts";
import { registerPanelActions } from "../lib/actions/panel-actions.ts";
import { registerRunActions } from "../lib/actions/run-actions.ts";
import { registerSettingsActions } from "../lib/actions/settings-actions.ts";
import { registerTerminalDebugActions } from "../lib/actions/terminal-debug-actions.ts";
import { registerViewActions } from "../lib/actions/view-actions.ts";
import {
  installCommandPaletteMenuRequest,
  installMenuCommandRequest,
} from "../lib/command-palette/menu-request.ts";
import { DEFAULT_KEYMAP } from "../lib/keybindings/defaults.ts";
import { keybindingRegistry } from "../lib/keybindings/registry.ts";
import { bootstrapBuiltinPlugins } from "../lib/plugins/bootstrap.ts";
import { installWindowFocusAttribute } from "../lib/window-focus-attribute.ts";
import { registerTerminalActions } from "../panel-kits/terminal/register-actions.ts";
import { registerTerminalPanelCloseGuard } from "../panel-kits/terminal/register-close-guard.ts";
import { initAgentAttentionPreferences } from "../stores/agent-attention-preferences.store.ts";
import { initAgentPreferences } from "../stores/agent-preferences.store.ts";
import { initAppQuitPreferences } from "../stores/app-quit-preferences.store.ts";
import { initAppUpdatePreferences } from "../stores/app-update-preferences.store.ts";
import { initCommandPaletteMru } from "../stores/command-palette-mru.store.ts";
import { initFont } from "../stores/font.store.ts";
import { initHostCatalog } from "../stores/host-catalog/store.ts";
import { initKeybindingPreferences } from "../stores/keybinding-preferences.store.ts";
import { initLocalEnvironments } from "../stores/local-environments.store.ts";
import { initLocale } from "../stores/locale.store.ts";
import { initLspPreferences } from "../stores/lsp-preferences.store.ts";
import { initPluginSettingsStore } from "../stores/plugin-settings.store.ts";
import { initShellEnvironmentStore } from "../stores/shell-environment.store.ts";
import { initTaskRunsStore } from "../stores/task-runs.store.ts";
import { initTerminalPreferences } from "../stores/terminal-preferences.store.ts";
import { initTerminalStatusBarPrefs } from "../stores/terminal-status-bar-prefs.store.ts";
import { initTheme } from "../stores/theme.store.ts";
import { initWorkspacePreferences } from "../stores/workspace-preferences.store.ts";
import { initWorktreePreferences } from "../stores/worktree-preferences.store.ts";
import { initZoom } from "../stores/zoom.store.ts";
import { RendererBootSignal } from "./boot-signal.tsx";

export async function startApplication(args: {
  debugMode: string | null;
  root: Root;
  targetBrowserWindowId: number;
}): Promise<void> {
  if (
    args.debugMode === "terminal" &&
    Number.isFinite(args.targetBrowserWindowId)
  ) {
    try {
      await initTheme();
    } catch (err) {
      console.error("[pier] terminal debug theme init failed:", err);
    }
    args.root.render(
      <>
        <RendererBootSignal key="terminal-debug" />
        <TerminalDebugWindow
          targetBrowserWindowId={args.targetBrowserWindowId}
        />
      </>
    );
    return;
  }

  installWorkspaceRendererCommandListener();

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
      initShellEnvironmentStore(),
      initAppQuitPreferences(),
      initAppUpdatePreferences(),
      initAgentPreferences(),
      initAgentAttentionPreferences(),
      initTerminalStatusBarPrefs(),
      initTaskRunsStore(),
      initWorktreePreferences(),
      initWorkspacePreferences(),
      initLspPreferences(),
      initLocalEnvironments(),
    ]);
  } catch (err) {
    console.error("[pier] theme/locale init failed:", err);
  }

  window.pier?.terminal?.setup?.()?.catch(() => undefined);
  initHostCatalog();
  // blur 抑制器必须最先注册 (早于一切 window blur 监听, 含 Radix), 见其 doc comment
  installTerminalInputRoutingBlurSuppressor();
  // OS key-window focus → data-window-focused (main broadcast; not DOM blur).
  installWindowFocusAttribute();
  installTerminalInputRoutingSashDragWatcher();
  installTerminalWebOwnerRetentionWatch();
  installTerminalInputRoutingPointerDownListener();
  // Always-on hang trail (batched JSONL + ring); post-mortem only.
  installHangBreadcrumbRuntime();
  installCommandPaletteMenuRequest();
  installMenuCommandRequest();
  initCommandPaletteMru().catch(() => undefined);

  registerConfigActions();
  registerCommandPaletteAction();
  registerNewAgentAction();
  registerAgentRuntimeActions();
  registerAgentStartActions();
  registerRunActions();
  registerPanelActions();
  registerNotificationCenterActions();
  registerSettingsActions();
  registerViewActions();
  registerCommandPaletteMruAction();
  registerTerminalDebugActions();
  registerTerminalActions();
  registerTerminalPanelCloseGuard();
  await initPluginSettingsStore();
  const pluginBootstrap = await bootstrapBuiltinPlugins();
  keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
  await initKeybindingPreferences();

  // 不包 StrictMode:Pier 终端 panel 是 web React tree + Ghostty native NSView
  // 协同, native terminal session 生命周期由 workspace 显式 close/reconcile
  // 管理. dev StrictMode 的诊断性 remount 对 native surface 没有业务含义,
  // 这里保持 dev/prod 行为一致, 避免给 reload 复用路径引入额外扰动.
  args.root.render(
    <>
      <RendererBootSignal key="application" />
      <AppRuntimeErrorBoundary>
        <App />
      </AppRuntimeErrorBoundary>
    </>
  );
  requestAnimationFrame(() => {
    setTimeout(() => pluginBootstrap.startExternal(), 0);
  });
}
