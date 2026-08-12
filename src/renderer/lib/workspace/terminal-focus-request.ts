import {
  type ActivateWorkspacePanelResult,
  activateWorkspacePanel,
  type WorkspacePanelActivationApi,
  type WorkspacePanelKind,
} from "./panel-activation.ts";
import { withSuppressedTabReveal } from "./tab-reveal-suppress.ts";

export function activateTerminalPanelFromFocusRequest(
  api: WorkspacePanelActivationApi,
  panelId: string,
  options: {
    kindOfComponent?: (component: string) => WorkspacePanelKind;
  } = {}
): ActivateWorkspacePanelResult {
  // Suppress host group-focus reveal for the same turn: setActive may fire
  // onDidActiveGroupChange when focusing another group's terminal surface.
  return withSuppressedTabReveal(() =>
    activateWorkspacePanel(api, panelId, {
      expectedKind: "terminal",
      ...(options.kindOfComponent && {
        kindOfComponent: options.kindOfComponent,
      }),
      reveal: "never",
    })
  );
}
