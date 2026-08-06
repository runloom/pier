/**
 * NCS agent 面板聚焦判定（纯函数，可单测）。
 * 只认 key 窗 + activeTerminalPanelId；不读 dockview 通用 active panel 字段，
 * 避免 presentation rAF 滞后或残留终端 id 造成 panel-unfocused 误静音。
 */
export function isTargetAgentPanelFocused(input: {
  activeTerminalPanelId: string | null;
  focusedElectronWindowId: string | null;
  ownerElectronWindowId: string;
  panelId: string;
}): boolean {
  if (
    !input.focusedElectronWindowId ||
    input.focusedElectronWindowId !== input.ownerElectronWindowId
  ) {
    return false;
  }
  return input.activeTerminalPanelId === input.panelId;
}
