export const CORE_AGENT_STATUS_ITEM_ID = "core.agent-status";
export const CORE_TASK_STATUS_ITEM_ID = "core.task-status";

export const CORE_ACTIVITY_OVERVIEW_WIDGET_ID = "core.activity-overview";
export const CORE_SYSTEM_RESOURCES_WIDGET_ID = "core.system-resources";
export const CORE_CUSTOM_CARD_WIDGET_ID = "core.custom-card";
export const CORE_COST_OVERVIEW_WIDGET_ID = "core.cost-overview";

export const CORE_RESERVED_ACTION_IDS = [
  "pier.agent.new",
  "pier.agents.focusWaiting",
  "pier.agents.list",
  "pier.commandPalette.clearRecent",
  "pier.commandPalette.toggle",
  "pier.config.locale",
  "pier.config.stylePreset",
  "pier.config.theme",
  "pier.environment.open",
  "pier.panel.close",
  "pier.panel.closeActive",
  "pier.panel.closeOthers",
  "pier.panel.copySelection",
  "pier.panel.equalizeSplits",
  "pier.panel.focusDown",
  "pier.panel.focusLeft",
  "pier.panel.focusRight",
  "pier.panel.focusUp",
  "pier.panel.focusTab1",
  "pier.panel.focusTab2",
  "pier.panel.focusTab3",
  "pier.panel.focusTab4",
  "pier.panel.focusTab5",
  "pier.panel.focusTab6",
  "pier.panel.focusTab7",
  "pier.panel.focusTab8",
  "pier.panel.focusTab9",
  "pier.panel.newWorkbench",
  "pier.panel.newTab",
  "pier.panel.newTerminal",
  "pier.panel.openCreateMenu",
  "pier.panel.selectAll",
  "pier.panel.splitDown",
  "pier.panel.splitLeft",
  "pier.panel.splitRight",
  "pier.panel.splitUp",
  "pier.panel.toggleMaximized",
  "pier.run.rerunTask",
  "pier.run.stopTask",
  "pier.run.task",
  "pier.run.terminalList",
  "pier.settings.open",
  "pier.terminal.clearScreen",
  "pier.terminal.close",
  "pier.terminal.composerAttach",
  "pier.terminal.copy",
  "pier.terminal.openAgentComposer",
  "pier.terminal.openDebugWindow",
  "pier.terminal.paste",
  "pier.terminal.renameAgentSession",
  "pier.terminal.search",
  "pier.terminal.selectAll",
  "pier.view.resetZoom",
  "pier.view.zoomIn",
  "pier.view.zoomOut",
  "pier.window.newWindow",
  "pier.workspace.resetLayout",
] as const;

export const CORE_RESERVED_PANEL_IDS = [
  "dashboard",
  "mission-control",
  "workbench",
  "terminal",
  "welcome",
] as const;

export const CORE_RESERVED_TERMINAL_STATUS_ITEM_IDS = [
  CORE_AGENT_STATUS_ITEM_ID,
  CORE_TASK_STATUS_ITEM_ID,
] as const;

export const CORE_RESERVED_WORKBENCH_WIDGET_IDS = [
  CORE_ACTIVITY_OVERVIEW_WIDGET_ID,
  CORE_SYSTEM_RESOURCES_WIDGET_ID,
  CORE_CUSTOM_CARD_WIDGET_ID,
  CORE_COST_OVERVIEW_WIDGET_ID,
] as const;
