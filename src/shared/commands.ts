export const AGENT_START_COMMAND_PREFIX = "pier.agent.start.";

export const APP_HANDLED_NATIVE_TERMINAL_COMMANDS = [
  "pier.panel.newTerminal",
  "pier.panel.closeActive",
  "pier.panel.openCreateMenu",
  "pier.window.newWindow",
  "pier.commandPalette.toggle",
  "pier.agent.new",
  "pier.panel.toggleMaximized",
  "pier.terminal.openDebugWindow",
  "pier.terminal.search",
  "pier.terminal.openAgentComposer",
  "pier.settings.open",
  "pier.view.zoomIn",
  "pier.view.zoomOut",
  "pier.view.resetZoom",
  "pier.panel.focusTab1",
  "pier.panel.focusTab2",
  "pier.panel.focusTab3",
  "pier.panel.focusTab4",
  "pier.panel.focusTab5",
  "pier.panel.focusTab6",
  "pier.panel.focusTab7",
  "pier.panel.focusTab8",
  "pier.panel.focusTab9",
  "pier.panel.splitRight",
  "pier.panel.splitDown",
  "pier.panel.focusUp",
  "pier.panel.focusDown",
  "pier.panel.focusLeft",
  "pier.panel.focusRight",
  "pier.run.task",
  "pier.run.rerunTask",
  "pier.worktree.create",
] as const;

export type AppHandledNativeTerminalCommand =
  (typeof APP_HANDLED_NATIVE_TERMINAL_COMMANDS)[number];
