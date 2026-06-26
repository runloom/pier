export const APP_HANDLED_NATIVE_TERMINAL_COMMANDS = [
  "pier.panel.newTerminal",
  "pier.panel.closeActive",
  "pier.window.newWindow",
  "pier.commandPalette.toggle",
  "pier.panel.toggleMaximized",
  "pier.terminal.openDebugWindow",
  "pier.settings.open",
  "pier.view.zoomIn",
  "pier.view.zoomOut",
  "pier.view.resetZoom",
  "pier.panel.splitRight",
  "pier.panel.splitDown",
  "pier.panel.focusUp",
  "pier.panel.focusDown",
  "pier.panel.focusLeft",
  "pier.panel.focusRight",
] as const;

export type AppHandledNativeTerminalCommand =
  (typeof APP_HANDLED_NATIVE_TERMINAL_COMMANDS)[number];
