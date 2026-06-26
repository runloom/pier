import { scheduleRevealDockviewTabByPanelId } from "./tab-visibility.ts";

export type WorkspacePanelKind = "terminal" | "web";
export type WorkspacePanelRevealPolicy = "always" | "never";

export interface WorkspacePanelActivationApi {
  panels: readonly WorkspacePanelActivationPanel[];
}

export interface WorkspacePanelActivationPanel {
  api: {
    setActive(): void;
  };
  id: string;
  view: {
    contentComponent: string;
  };
}

export type ActivateWorkspacePanelResult =
  | { ok: true }
  | {
      code: "not_found" | "kind_mismatch";
      message: string;
      ok: false;
    };

interface ActivateWorkspacePanelOptions {
  expectedKind?: WorkspacePanelKind;
  kindOfComponent?: (component: string) => WorkspacePanelKind;
  reveal: WorkspacePanelRevealPolicy;
  root?: ParentNode;
}

function defaultKindOfComponent(component: string): WorkspacePanelKind {
  return component === "terminal" ? "terminal" : "web";
}

export function activateWorkspacePanel(
  api: WorkspacePanelActivationApi,
  panelId: string,
  {
    expectedKind,
    kindOfComponent = defaultKindOfComponent,
    reveal,
    root,
  }: ActivateWorkspacePanelOptions
): ActivateWorkspacePanelResult {
  const panel = api.panels.find((candidate) => candidate.id === panelId);
  if (!panel) {
    return {
      code: "not_found",
      message: `panel not found: ${panelId}`,
      ok: false,
    };
  }

  const actualKind = kindOfComponent(panel.view.contentComponent);
  if (expectedKind && actualKind !== expectedKind) {
    return {
      code: "kind_mismatch",
      message: `panel is not ${expectedKind}: ${panelId}`,
      ok: false,
    };
  }

  panel.api.setActive();
  if (reveal === "always") {
    scheduleRevealDockviewTabByPanelId(panelId, root);
  }

  return { ok: true };
}
