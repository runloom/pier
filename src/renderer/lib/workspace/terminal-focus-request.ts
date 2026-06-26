import {
  type ActivateWorkspacePanelResult,
  activateWorkspacePanel,
  type WorkspacePanelActivationApi,
  type WorkspacePanelKind,
} from "./panel-activation.ts";

export function activateTerminalPanelFromFocusRequest(
  api: WorkspacePanelActivationApi,
  panelId: string,
  options: {
    kindOfComponent?: (component: string) => WorkspacePanelKind;
  } = {}
): ActivateWorkspacePanelResult {
  return activateWorkspacePanel(api, panelId, {
    expectedKind: "terminal",
    ...(options.kindOfComponent && {
      kindOfComponent: options.kindOfComponent,
    }),
    reveal: "never",
  });
}
