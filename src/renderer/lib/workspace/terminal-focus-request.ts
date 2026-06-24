interface TerminalFocusPanel {
  api: {
    setActive(): void;
  };
  id: string;
  view: {
    contentComponent: string;
  };
}

interface TerminalFocusDockviewApi {
  panels: readonly TerminalFocusPanel[];
}

export function activateTerminalPanelFromFocusRequest(
  api: TerminalFocusDockviewApi,
  panelId: string
): boolean {
  const panel = api.panels.find((p) => p.id === panelId);
  if (panel?.view.contentComponent !== "terminal") {
    return false;
  }
  panel.api.setActive();
  return true;
}
